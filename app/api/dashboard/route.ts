import { env } from "cloudflare:workers";
import { createHash, timingSafeEqual } from "node:crypto";

/** Keeps the Apps Script key on the Worker, never in a browser. */
export async function GET(request: Request) {
  const isStaging = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "staging";
  const deploymentEnvironment = isStaging ? "staging" : "production";
  const businessSourceUrl = env.DASHBOARD_SOURCE_URL;
  const walletSourceUrl = env.WALLET_SOURCE_URL;
  const requestedPlatform = new URL(request.url).searchParams.get("platform");
  const platform = requestedPlatform === "wallet" || requestedPlatform === "business" ? requestedPlatform : null;
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const cacheOnly = new URL(request.url).searchParams.get("cacheOnly") === "1" && !forceRefresh;
  const snapshotStore = env.DASHBOARD_SNAPSHOTS;
  const snapshotKey = platform === "wallet" || platform === "business" ? `dashboard:${platform}:latest` : null;

  if (requestedPlatform && !platform) {
    return Response.json({ error: "Unsupported dashboard platform." }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }

  // Refreshes are for the trusted daily sync only. Reuse the API key already
  // held by that pipeline, but require it in a header rather than the URL.
  const sourceUrl = walletSourceUrl ?? businessSourceUrl;
  if (forceRefresh) {
    const expectedKey = sourceUrl ? new URL(sourceUrl).searchParams.get("key") : null;
    const suppliedKey = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    if (!expectedKey || !suppliedKey) {
      return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const fingerprint = (value: string) => createHash("sha256").update(value).digest();
    if (!timingSafeEqual(fingerprint(expectedKey), fingerprint(suppliedKey))) {
      return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
  }

  // Visitors read the last complete environment-specific publication from KV.
  // This avoids a cold, slow Google Apps Script request on each Cloudflare POP.
  if (snapshotStore && snapshotKey && !forceRefresh) {
    try {
      const published: unknown = await snapshotStore.get(snapshotKey, { type: "json" });
      if (isPublishedDashboard(published, platform!, deploymentEnvironment)) {
        return Response.json(published, {
          headers: { "Cache-Control": "no-store, max-age=0", "X-Dashboard-Refresh": "0" },
        });
      }
    } catch {
      // If the published copy is temporarily unavailable, a normal live read
      // remains the recovery path. A cache-only probe must stay fast instead.
    }
    if (cacheOnly) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  let refreshNeeded = false;
  const read = async (url: string | undefined, timeout: number) => {
    if (!url) return null;
    const cache = (caches as CacheStorage & { default: Cache }).default;
    // Keep one source-cache entry per requested platform. This avoids making
    // Wallet wait for, or download, the larger Business dashboard payload.
    const sourceRequestUrl = new URL(url);
    if (platform) sourceRequestUrl.searchParams.set("platform", platform);
    const cacheKey = new Request(sourceRequestUrl.toString(), { method: "GET" });
    if (!forceRefresh && !snapshotStore) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const payload = await cached.json() as { environment?: string; error?: string };
        if (payload.error) {
          await cache.delete(cacheKey);
        } else if (!isStaging || payload.environment === "staging") {
          const checkedAt = Number(cached.headers.get("X-Validated-At") || 0);
          const fresh = Date.now() - checkedAt < 60_000;
          if (cacheOnly || fresh) {
            refreshNeeded = !fresh;
            return payload;
          }
        }
      }
    }
    // Interactive startup probes never wait for a cold Google Apps Script read.
    // The browser keeps its last successful data and performs a live read separately.
    if (cacheOnly) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const upstream = await fetch(sourceRequestUrl.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(timeout),
        });
        if (!upstream.ok) continue;
        const payload = await upstream.json() as { environment?: string; error?: string };
        // Both deployments must fail closed if pointed at the other environment.
        if (payload.error || payload.environment !== deploymentEnvironment) continue;
        // Keep the last successful response for quick display for up to a day.
        // Live reads revalidate after 60 seconds; pipeline refresh always bypasses.
        if (!snapshotStore) {
          await cache.put(cacheKey, Response.json(payload, {
            headers: { "Cache-Control": "public, max-age=86400", "X-Validated-At": String(Date.now()) },
          }));
        }
        return payload;
      } catch {
        // Apps Script occasionally stalls while serving its redirected JSON body.
        // Retry once instead of making a transient first-read hiccup a 502.
      }
    }
    return null;
  };

  // The production UPB and UPW sync commands both write to the same WalletSync
  // Apps Script deployment, whose payload contains both datasets. Read that
  // canonical source for both platforms; only use the legacy dashboard script
  // if the combined endpoint has not been configured at all.
  // Cold production reads from the precomputed Sheet view have been observed to
  // take up to ~49s. Allow one such read to finish; subsequent visitor reads
  // can display the retained cache immediately through cacheOnly=1.
  const sourceTimeout = 60_000;
  const sourcePayload = await read(sourceUrl, sourceTimeout) as {
    business?: { periods?: unknown[] };
    wallet?: { periods?: unknown[] };
    updatedAt?: string;
    environment?: string;
  } | null;
  const business = sourcePayload?.business?.periods?.length ? sourcePayload.business : undefined;
  const wallet = sourcePayload?.wallet?.periods?.length ? sourcePayload.wallet : undefined;
  const updatedAt = sourcePayload?.updatedAt;

  // Include the environment so sync validation cannot mistake a production
  // response for staging (or vice versa).
  const dashboard = {
    environment: deploymentEnvironment,
    updatedAt: updatedAt ?? new Date().toISOString(),
    ...(platform !== "wallet" ? (business ? { business } : {}) : {}),
    ...(platform === "wallet" ? (wallet ? { wallet } : {}) : {}),
  };

  // The data pipeline calls this authenticated refresh after verifying the
  // Google Sheet write. Publish exactly that platform's complete snapshot.
  if (forceRefresh && snapshotStore && snapshotKey) {
    const published = platform === "wallet" ? wallet : business;
    if (!published) {
      return Response.json({ error: "The refreshed dashboard data is incomplete." }, {
        status: 502, headers: { "Cache-Control": "no-store" },
      });
    }
    await snapshotStore.put(snapshotKey, JSON.stringify({
      environment: deploymentEnvironment,
      updatedAt: dashboard.updatedAt,
      [platform!]: published,
    }));
  }

  if (!dashboard.business && !dashboard.wallet) {
    if (cacheOnly) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "The dashboard sources are temporarily unavailable." }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json(dashboard, {
    headers: { "Cache-Control": "no-store, max-age=0", "X-Dashboard-Refresh": refreshNeeded ? "1" : "0" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasPeriods(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.periods) && value.periods.length > 0;
}

function isPublishedDashboard(value: unknown, platform: "business" | "wallet", environment: string): boolean {
  return isRecord(value) && value.environment === environment && hasPeriods(value[platform]);
}
