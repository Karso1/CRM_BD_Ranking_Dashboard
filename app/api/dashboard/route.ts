import { env } from "cloudflare:workers";

/** Keeps the Apps Script key on the Worker, never in a browser. */
export async function GET() {
  const sourceUrl = env.DASHBOARD_SOURCE_URL;
  if (!sourceUrl) {
    return Response.json(
      { error: "Dashboard data source has not been configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const upstream = await fetch(sourceUrl, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      return Response.json(
        { error: "The dashboard source is temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
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
