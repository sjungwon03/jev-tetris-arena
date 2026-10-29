import http from "node:http";
import { createServer } from "vite";
import { api } from "./api";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "spa",
});
const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/")) {
    vite.middlewares(req, res);
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16000) {
        res.writeHead(413);
        res.end("Request too large");
        return;
      }
      chunks.push(chunk);
    }
    const url = new URL(req.url, "http://" + req.headers.host),
      request = new Request(url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        ...(["GET", "HEAD"].includes(req.method || "GET")
          ? {}
          : { body: Buffer.concat(chunks) }),
      });
    const response = await api(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Internal server error");
  }
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Local: http://localhost:" + (process.env.PORT || 3000)),
);
function shutdown() {
  server.close();
  void vite.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
