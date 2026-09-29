import handler from "vinext/server/fetch-handler";
import { accessResponse, privateResponse } from "./lib/site-access";
import { sessionPrincipal } from "./lib/site-access";
import { scopedDashboard } from "./lib/bd-scope";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const response = await accessResponse(request, env);
    if (response) return response;
    const principal = sessionPrincipal(request, env);
    if (principal?.role === "bd") {
      const url = new URL(request.url);
      if (url.pathname === "/api/dashboard") {
        const platform = url.searchParams.get("platform");
        if (platform !== "business" && platform !== "wallet") return privateResponse(Response.json({ error: "Invalid platform." }, { status: 400 }));
        try {
          const published: unknown = await env.DASHBOARD_SNAPSHOTS.get(`dashboard:${platform}:latest`, { type: "json" });
          const scoped = scopedDashboard(published, platform, principal.owner);
          if (!scoped || scoped.environment !== process.env.NEXT_PUBLIC_DEPLOYMENT_ENV) return privateResponse(Response.json({ error: "Data unavailable." }, { status: 503 }));
          return privateResponse(Response.json(scoped));
        } catch { return privateResponse(Response.json({ error: "Data unavailable." }, { status: 503 })); }
      }
      if (url.pathname === "/" || url.pathname === "/upay-logo.png" || url.pathname.startsWith("/_next/") || url.pathname === "/vinext-client-entry-manifest.json") {
        if (url.pathname !== "/") {
          const asset = await env.ASSETS.fetch(request);
          if (asset.status !== 404) return privateResponse(asset);
        }
        return privateResponse(await handler.fetch(request, env, ctx));
      }
      return privateResponse(Response.json({ error: "Forbidden." }, { status: 403 }));
    }
    // Vite assets (including bundled fallback data) must pass the same gate.
    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return privateResponse(asset);
    }
    return privateResponse(await handler.fetch(request, env, ctx));
  },
};
