import { afterEach, describe, expect, it } from "vitest";
import { createOllamaProxy } from "../../deploy/ollama-proxy.mjs";
const servers = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});
async function start() {
  const server = createOllamaProxy("100.64.0.1");
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
describe("fixed-destination Ollama bridge", () => {
  it("rejects arbitrary destinations before opening a listener", () => {
    for (const host of [
      "127.0.0.1",
      "example.com",
      "100.64.0.1/path",
      "169.254.169.254",
    ])
      expect(() => createOllamaProxy(host)).toThrow("INVALID_OLLAMA_TAIL_HOST");
  });
  it("denies model mutation, query strings and arbitrary forwarding routes", async () => {
    const origin = await start();
    for (const [path, method] of [
      ["/api/pull", "POST"],
      ["/api/tags?target=external", "GET"],
      ["/", "GET"],
    ]) {
      const response = await fetch(origin + path, { method });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "OLLAMA_PROXY_ROUTE_DENIED",
      });
    }
  });
});
