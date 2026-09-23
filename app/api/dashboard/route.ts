import { env } from "cloudflare:workers";

const DASHBOARD_CACHE_TTL_SECONDS = 31_536_000;

/** Keeps the Apps Script key on the Worker, never in a browser. */
export async function GET(request: Request) {
  const businessSourceUrl = env.DASHBOARD_SOURCE_URL;
  const walletSourceUrl = env.WALLET_SOURCE_URL;
  const platform = new URL(request.url).searchParams.get("platform");
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const read = async (url: string | undefined, timeout: number) => {
    if (!url) return null;
    const cache = caches.default;
    const cacheKey = new Request(url, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (!forceRefresh) {
      if (cached) return cached.json();
    }
    try {
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
      });
      if (!upstream.ok) return null;
      const payload = await upstream.json();
      await cache.put(cacheKey, Response.json(payload, {
        // Daily syncs replace this entry explicitly. Keeping the last verified
        // payload prevents visitors from falling back to the bundled snapshot
        // when Google Apps Script is temporarily slow.
        headers: { "Cache-Control": `public, max-age=${DASHBOARD_CACHE_TTL_SECONDS}` },
      }));
      return payload;
    } catch {
      // A failed refresh must not discard the last successfully published data.
      return cached ? cached.json() : null;
    }
  };

  // A selected platform is fetched on its own. This matters for Wallet: a
  // slow UP Business Apps Script must never delay or hide Wallet updates.
  const [legacyBusinessPayload, syncPayload] = await Promise.all([
    platform === "wallet" ? null : read(businessSourceUrl, 12_000) as Promise<{ business?: unknown; updatedAt?: string } | null>,
    read(walletSourceUrl, forceRefresh ? 300_000 : 55_000) as Promise<{ business?: unknown; wallet?: unknown; updatedAt?: string } | null>,
  ]);
  const dashboard = {
    updatedAt: syncPayload?.updatedAt ?? legacyBusinessPayload?.updatedAt ?? new Date().toISOString(),
    ...((syncPayload?.business ?? legacyBusinessPayload?.business) ? { business: syncPayload?.business ?? legacyBusinessPayload?.business } : {}),
    ...(syncPayload?.wallet ? { wallet: syncPayload.wallet } : {}),
  };

  if (!dashboard.business && !dashboard.wallet) {
    return Response.json({ error: "The dashboard sources are temporarily unavailable." }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }

  return Response.json(dashboard, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
