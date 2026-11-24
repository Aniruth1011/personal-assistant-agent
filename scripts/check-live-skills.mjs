import { readFileSync, writeFileSync } from "node:fs";
const config = JSON.parse(readFileSync(".runtime/state/openclaw.json", "utf8"));
const results = [];
async function invoke(tool, args) {
  const response = await fetch("http://127.0.0.1:19877/tools/invoke", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.gateway.auth.token}`,
    },
    body: JSON.stringify({ tool, args }),
  });
  const body = await response.json();
  const data = body.result?.details;
  const item = {
    tool,
    http: response.status,
    status: data?.status,
    errorCode: data?.error?.code ?? body.error?.code,
    dataKeys: Object.keys(data?.data ?? {}),
    contentBlocks: body.result?.content?.length ?? 0,
  };
  if (tool === "list_test_events") item.eventCount = data?.data?.events?.length;
  if (tool === "list_test_emails")
    item.threadCount = data?.data?.threads?.length;
  if (tool === "web_search") {
    item.resultCount = data?.results?.length;
    item.sources = data?.results?.map((r) => r.url);
  }
  if (tool === "classify_assistant_email")
    item.deduplication = data?.data?.deduplication?.status;
  if (tool === "draft_email_reply") item.notSent = data?.data?.notSent;
  results.push(item);
  console.log(JSON.stringify(item));
  return data;
}
await invoke("list_todos", { status: "all" });
await invoke("list_test_events", {
  requestId: "runtime-calendar-check",
  from: "2026-11-12T00:00:00-08:00",
  to: "2026-11-19T00:00:00-08:00",
  timeZone: "America/Los_Angeles",
  maxResults: 10,
});
const emailList = await invoke("list_test_emails", {
  requestId: "runtime-email-check",
  maxResults: 5,
});
const threadId = emailList?.data?.threads?.[0]?.threadId;
if (threadId) {
  for (const tool of [
    "get_test_email",
    "classify_assistant_email",
    "draft_email_reply",
  ])
    await invoke(tool, { requestId: `runtime-${tool}-check`, threadId });
  await invoke("classify_assistant_email", {
    requestId: "runtime-classify-replay",
    threadId,
  });
}
await invoke("web_search", {
  query: "OpenClaw official documentation plugin tools",
  count: 3,
});
await invoke("send_approved_email", { requestId: "unauthorized-send-probe" });
writeFileSync(
  "evidence/g6-live-skills.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      kind: "Actual Gateway tool RPC; not model-directed or Telegram skill test",
      results,
    },
    null,
    2,
  ) + "\n",
);

const failed = results.filter((r) =>
  r.tool === "send_approved_email"
    ? r.http !== 404
    : r.http !== 200 || (r.tool !== "web_search" && r.status !== "success"),
);
if (failed.length) {
  console.error(
    `${failed.length} live skill probes failed; inspect sanitized evidence.`,
  );
  process.exitCode = 1;
}
