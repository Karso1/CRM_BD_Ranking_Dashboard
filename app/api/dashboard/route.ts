import { env } from "cloudflare:workers";

/** Keeps the Apps Script key on the Worker, never in a browser. */
export async function GET() {
  const businessSourceUrl = env.DASHBOARD_SOURCE_URL;
  const walletSourceUrl = env.WALLET_SOURCE_URL;
  const read = async (url?: string) => {
    if (!url) return null;
    try {
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
        cf: { cacheTtl: 0, cacheEverything: false },
        signal: AbortSignal.timeout(12_000),
      });
      return upstream.ok ? await upstream.json() : null;
    } catch {
      return null;
    }
  };

  // Each platform has its own data source. Read them concurrently so a slow
  // Apps Script on one platform can never hide fresh data from the other.
  const [businessPayload, walletPayload] = await Promise.all([
    read(businessSourceUrl) as Promise<{ business?: unknown; updatedAt?: string } | null>,
    read(walletSourceUrl) as Promise<{ wallet?: unknown; updatedAt?: string } | null>,
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
