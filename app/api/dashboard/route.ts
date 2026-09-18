import { env } from "cloudflare:workers";

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
    if (!forceRefresh) {
      const cached = await cache.match(cacheKey);
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
        headers: { "Cache-Control": "public, max-age=600" },
      }));
      return payload;
    } catch {
      return null;
    }
  };

  // A selected platform is fetched on its own. This matters for Wallet: a
  // slow UP Business Apps Script must never delay or hide Wallet updates.
  const [businessPayload, walletPayload] = await Promise.all([
    platform === "wallet" ? null : read(businessSourceUrl, 12_000) as Promise<{ business?: unknown; updatedAt?: string } | null>,
    platform === "business" ? null : read(walletSourceUrl, 55_000) as Promise<{ wallet?: unknown; updatedAt?: string } | null>,
  ]);
  const dashboard = {
    updatedAt: walletPayload?.updatedAt ?? businessPayload?.updatedAt ?? new Date().toISOString(),
    ...(businessPayload?.business ? { business: businessPayload.business } : {}),
    ...(walletPayload?.wallet ? { wallet: walletPayload.wallet } : {}),
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
