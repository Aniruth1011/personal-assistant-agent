import { createServer, request } from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";

/** A fixed-destination loopback bridge; Node fetch never relies on global proxy env. */
export function createOllamaProxy(laptop) {
  if (!/^100\.(?:\d{1,3}\.){2}\d{1,3}$/.test(laptop ?? ""))
    throw Error("INVALID_OLLAMA_TAIL_HOST");
  const agent = new SocksProxyAgent("socks5h://127.0.0.1:1055");
  const allowed = new Set([
    "GET /api/tags",
    "GET /api/ps",
    "POST /api/chat",
    "POST /api/show",
  ]);
  return createServer((incoming, response) => {
    if (!allowed.has(`${incoming.method} ${incoming.url}`)) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end('{"error":"OLLAMA_PROXY_ROUTE_DENIED"}');
      return;
    }
    const upstream = request(
      {
        host: laptop,
        port: 11434,
        path: incoming.url,
        method: incoming.method,
        agent,
        headers: { "content-type": "application/json" },
      },
      (remote) => {
        if ((remote.statusCode ?? 500) >= 300) {
          response.writeHead(502);
          response.end('{"error":"OLLAMA_UPSTREAM_UNAVAILABLE"}');
          remote.destroy();
          return;
        }
        response.writeHead(remote.statusCode ?? 502, {
          "content-type": remote.headers["content-type"] ?? "application/json",
        });
        remote.pipe(response);
      },
    );
    const timeout = setTimeout(
      () => upstream.destroy(new Error("OLLAMA_UPSTREAM_TIMEOUT")),
      180000,
    );
    let bytes = 0;
    incoming.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        upstream.destroy();
        if (!response.headersSent) response.writeHead(413);
        response.end();
        incoming.destroy();
      }
    });
    incoming.on("error", () => upstream.destroy());
    response.on("close", () => {
      clearTimeout(timeout);
      upstream.destroy();
    });
    upstream.on("error", () => {
      clearTimeout(timeout);
      if (!response.headersSent)
        response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"OLLAMA_PATH_UNAVAILABLE"}');
    });
    incoming.pipe(upstream);
  });
}
