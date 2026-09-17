import { env } from "cloudflare:workers";

/** Keeps the Apps Script key on the Worker, never in a browser. */
export async function GET(request: Request) {
  const businessSourceUrl = env.DASHBOARD_SOURCE_URL;
  const walletSourceUrl = env.WALLET_SOURCE_URL;
  const platform = new URL(request.url).searchParams.get("platform");
  const read = async (url: string | undefined, timeout: number) => {
    if (!url) return null;
    try {
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
        cf: { cacheTtl: 0, cacheEverything: false },
        signal: AbortSignal.timeout(timeout),
      });
      return upstream.ok ? await upstream.json() : null;
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
