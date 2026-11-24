# Video recording — current verified preparation

This procedure supersedes the manual Clone/Once/date-calculation steps in earlier chat instructions. Those instructions are preserved in evidence/telegram-fix/video-runbook-before-automatic-preparation.md. The incorrect Video Briefing clone is paused; original recurring schedules remain intact.

## Before recording

1. Plug in the Mac and connect Tailscale. Leave `caffeinate -dims` running in a separate terminal.
2. Open and authenticate the dashboard https://applypilot-cloud.tail631b8f.ts.net and Telegram Desktop https://t.me/Apply599bot. Open USC Zoom https://usc.zoom.us and share the desktop. Do not record yet. Keep tokens, invitation links and login screens off-screen.
3. Have System Information → Hardware Overview → Hardware UUID ready. Keep the actual deployed OpenClaw version output ready in the cloud SSH terminal. Local terminal must be in the assignment folder.
4. Run `brew services start ollama`; confirm `ollama list` includes gemma4:e2b and `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status` shows port11434 forwarding.
5. Do not create another task or edit Automations. The saved human-created video task is already open. The one-time reminder reads it; it is deliberately independent of normal alert deduplication. It is a scheduled reminder, not a claim of a newly detected event.
6. When Zoom and the other windows are ready, run:

```sh
node scripts/operations/video-demo.mjs arm
```

The command checks local Gemma, the saved open task, and prepared job payloads; schedules and verifies the three one-time jobs; then prints an exact start time about one minute ahead. Only start recording if it prints READY. If it prints an error, stop and inspect it. Repeating arm while jobs are active preserves the existing schedule instead of duplicating it.

## Recording sequence

Start Zoom recording at the printed START ZOOM RECORDING time. Target about seven minutes. Provider calls can take additional time; do not hide failures or claim missing deliveries.

1. Show Hardware UUID first, then actual cloud OpenClaw version output.
2. Show `ollama list` and `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status`.
3. At approximately +1minute, show the scheduled briefing in Telegram; it may take another15seconds or longer to fetch providers. Say it is a scheduled demonstration outside normal morning timing. Show NWS as forecast fallback if that is the actual source.
4. Fresh Researcher/public-research dashboard session: `What is 12 times 9?` Wait for108.
5. Another fresh Researcher session: `Explain step by step why the sky is blue.` Wait for the full cloud answer. Leave model selection at default; router chooses.
6. Stop Ollama with `brew services stop ollama`. Check `curl -s -m 3 http://127.0.0.1:11434/api/tags || echo "Ollama is off"`. Keep Tailscale and cloud instance running; allow availability detection to settle.
7. In main/private agent chat: `This is confidential: remind me my locker code is on a sticky note.` Show held/unavailable result with no cloud inference.
8. Start Ollama with `brew services start ollama`; confirm `ollama list`, wait for recovery. In main/private chat: `This is confidential: say "back online" in three words.` Show actual reply. Do not claim exact word-count success if wording differs.
9. Run `node scripts/operations/show-video-routes.mjs --video`. It shows metadata from the current recording window, within the assignment's last30minutes. Show matching request IDs, decisions, served models and completed outcomes: local→cloud→held→local. If monitoring has not published the newest events, wait and rerun.
10. Immediately run `ollama ps` to show Gemma loaded.
11. Telegram: `Hi, what can you do?` Show real reply.
12. Show the scheduled deadline reminder, which runs at +4minutes30seconds. It reads the real saved open task; no `/todoadd` or manual alert request is needed. If it arrived during the routing demonstration, show its timestamp afterward.
13. Show the scheduled recap, which runs at +6minutes. It uses the existing recap script and real data. Label it simulated evening timing. No `/recap` command is required.
14. If time permits, show https://clawhub.ai/aniruth1011/skills/assistant-todo-triage version1.0.0. Security tests remain in the report.
15. Stop Zoom, end meeting, review converted MP4 fully, and name it Assignment3-CSCI599-USCusername.mp4. Main assignment says5–7minutes; Gemma supplement estimates7–10minutes. Aim about7while retaining all required scenes.

## Status, cancellation and retry

```sh
node scripts/operations/video-demo.mjs status
node scripts/operations/video-demo.mjs cancel
```

Cancel pauses only the three prepared recording jobs. It does not disable original daily jobs. If a recording is abandoned, cancel before arming another attempt. The saved task must remain open. A completed task produces no reminder; the arming command checks for that. Do not reset ordinary alert deduplication or fabricate a new task.

The three separate Video preflight jobs test actual scheduled execution/delivery and are not the recording jobs. One-time jobs are retained disabled after completion as evidence. Do not manually rerun them and call that scheduled delivery.

## Grader handoff

Submit the HTTPS agent URL, gateway credentials and reusable Tailscale agent-machine share link privately through Brightspace, not in the recording or source. Grader-account reachability remains a separate verification. Preserve the original48-hour evidence; this video preparation changes only separate one-time automation jobs and local recording utilities.
