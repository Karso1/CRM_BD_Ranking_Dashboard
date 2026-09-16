import { env } from "cloudflare:workers";

/** Keeps the Apps Script key on the Worker, never in a browser. */
export async function GET() {
  const businessSourceUrl = env.DASHBOARD_SOURCE_URL;
  const walletSourceUrl = env.WALLET_SOURCE_URL;
  if (!businessSourceUrl) {
    return Response.json(
      { error: "Dashboard data source has not been configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const businessUpstream = await fetch(businessSourceUrl, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const businessBody = await businessUpstream.text();
    if (!businessUpstream.ok) {
      return Response.json(
        { error: "The dashboard source is temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const dashboard = JSON.parse(businessBody);

    // Wallet is now calculated from backend raw exports and synced to its own
    // Google Sheet tab. Keep Business on the existing source while allowing a
    // safe fallback if the Wallet automation is temporarily unavailable.
    if (walletSourceUrl) {
      const walletUpstream = await fetch(walletSourceUrl, {
        headers: { Accept: "application/json" },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      if (walletUpstream.ok) {
        const walletPayload = await walletUpstream.json() as { wallet?: unknown };
        if (walletPayload.wallet) dashboard.wallet = walletPayload.wallet;
      }
    }

    return Response.json(dashboard, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return Response.json(
      { error: "The dashboard source could not be reached." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
