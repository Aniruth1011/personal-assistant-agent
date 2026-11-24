import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export function routingRows(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=1000");
    const rows = db
      .prepare(
        "SELECT event_json FROM route_events ORDER BY seq DESC LIMIT 1500",
      )
      .all();
    const byId = new Map<string, Record<string, unknown>>();
    for (const raw of rows) {
      const e = JSON.parse(String(raw.event_json));
      if (typeof e.id !== "string") continue;
      let row = byId.get(e.id);
      if (!row) {
        row = { id: e.id, at: e.at };
        byId.set(e.id, row);
      }
      if (e.kind === "decision" && row.route === undefined)
        Object.assign(row, {
          route: e.target,
          reason: e.reason,
          privacy: e.privacy,
          selectedModel: e.selectedModel,
        });
      if (e.kind === "served" && row.servedModel === undefined)
        Object.assign(row, {
          servedModel: `${e.provider}/${e.model}`,
          servedAt: e.at,
        });
      if (e.kind === "outcome" && row.outcome === undefined)
        Object.assign(row, { outcome: e.outcome, durationMs: e.durationMs });
    }
    return [...byId.values()].slice(0, 100);
  } finally {
    db.close();
  }
}
export function registerRoutingUi(api: OpenClawPluginApi) {
  const path = api.pluginConfig?.assistantStatePath;
  if (typeof path !== "string") return;
  api.session.controls.registerControlUiDescriptor({
    id: "routing",
    surface: "tab",
    label: "Routing",
    description: "Policy and actual model receipts",
    path: "/plugins/applypilot/routing",
    slug: "routing",
    requiredScopes: ["operator.read"],
    order: 20,
  });
  api.registerHttpRoute({
    path: "/plugins/applypilot/routing",
    auth: "gateway",
    match: "prefix",
    handler: (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/plugins/applypilot/routing/events") {
        res.setHeader("Content-Type", "application/json");
        // Native Control UI plugin frames are sandboxed opaque origins, authenticated by a scoped HttpOnly grant.
        if (req.headers.origin === "null") {
          res.setHeader("Access-Control-Allow-Origin", "null");
          res.setHeader("Access-Control-Allow-Credentials", "true");
        }
        try {
          res.end(
            JSON.stringify({
              asOf: new Date().toISOString(),
              rows: routingRows(path),
            }),
          );
        } catch {
          res.statusCode = 503;
          res.end('{"error":"ROUTING_EVIDENCE_UNAVAILABLE"}');
        }
        return;
      }
      if (pathname !== "/plugins/applypilot/routing") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const nonce = randomBytes(18).toString("base64");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'`,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ApplyPilot routing</title>
<style nonce="${nonce}">body{font:16px system-ui;margin:0;background:#101722;color:#edf3fc}main{max-width:1250px;margin:auto;padding:32px}a{color:#9dc9ff}h1{margin-bottom:8px}.muted{color:#a9b8cb}section{background:#1b2738;padding:20px;border-radius:14px;margin:24px 0}li{margin:10px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #354156}td{overflow-wrap:anywhere}button{padding:10px 18px;border:0;border-radius:8px;cursor:pointer}.scroll{overflow:auto}.local{color:#92e6b0}.cloud{color:#9dc9ff}.held{color:#ffd187}code{font-size:12px}</style>
<main><a href="/">← Open chat</a><h1>How your requests are routed</h1><p class="muted">Decisions and actual model receipts from this deployment. No message content is displayed.</p>
<section><ol><li><strong>Private request or private session:</strong> local Gemma only. If unavailable, hold safely.</li><li><strong>Public reasoning or web research:</strong> cloud when eligible; local fallback on supported cloud failures.</li><li><strong>Short public request:</strong> local when available, otherwise cloud.</li><li><strong>No eligible model:</strong> hold. A selected model is not proof it answered.</li></ol></section>
<button id="refresh">Refresh</button> <span id="status" role="status">Loading…</span>
<div class="scroll"><table><thead><tr><th>UTC / request</th><th>Decision</th><th>Reason</th><th>Selected</th><th>Actually served</th><th>Outcome</th></tr></thead><tbody id="rows"></tbody></table></div>
<p class="muted">Updates every 10 seconds. Missing model receipts mean inference is not verified. An error followed by a local served model may be a fallback; inspect the outcome. This page is protected by Gateway authentication.</p></main>
<script nonce="${nonce}">
const status=document.getElementById('status'), rows=document.getElementById('rows');
async function refresh(){try{const r=await fetch('/plugins/applypilot/routing/events',{credentials:'include',cache:'no-store'});if(!r.ok)throw Error(r.status===401?'Your authenticated Gateway session is required. Reconnect through the dashboard.':'Evidence temporarily unavailable.');const d=await r.json();rows.replaceChildren();for(const x of d.rows){const tr=document.createElement('tr');for(const value of [x.at+' / '+x.id,x.route||'—',x.reason||'—',x.selectedModel||'—',x.servedModel||'Not verified',x.outcome||(x.route==='held'?'Held':'Pending')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}rows.append(tr);}status.textContent='Updated '+d.asOf+(d.rows.length?'':' — no routing records yet');}catch(e){status.textContent=e.message;}}
document.getElementById('refresh').onclick=refresh;refresh();setInterval(refresh,10000);
</script></html>`);
    },
  });
}
