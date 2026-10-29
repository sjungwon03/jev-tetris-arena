import { api, type ServerEnv } from "./api";
import assets from "virtual:assets";
/** Single Worker deployment: browser assets plus the server-only model proxy. */
export default {
  async fetch(request: Request, env: ServerEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return api(request, env);
    const asset = assets[path];
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(asset.body, {
      headers: {
        "Content-Type": asset.type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
