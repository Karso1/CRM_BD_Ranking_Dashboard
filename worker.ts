import handler from "vinext/server/fetch-handler";
import { accessResponse, privateResponse } from "./lib/site-access";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const response = await accessResponse(request, env);
    if (response) return response;
    // Vite assets (including bundled fallback data) must pass the same gate.
    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return privateResponse(asset);
    }
    return privateResponse(await handler.fetch(request, env, ctx));
  },
};
