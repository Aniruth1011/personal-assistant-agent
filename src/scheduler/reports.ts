import { AlertDelivery } from "./alert-delivery.js";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { readQuery } from "./read-query.js";
import { KnowledgeStore } from "../knowledge/store.js";
import { summarizeEmail } from "../integrations/email-intelligence.js";
import { meetingContext, planTaskSlots } from "./context.js";
import { TodoStore } from "../tasks/store.js";
import { z } from "zod";
import { EmailEventStore } from "../persistence/email-event-store.js";
import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { dailyCalendar } from "./calendar-intelligence.js";
import { AssistantState } from "./assistant-state.js";
import {
  listTestCalendarEvents,
  type TestCalendarEvent,
} from "../integrations/gogcli-calendar.js";
import {
  listTestEmailThreads,
  getTestEmailThread,
} from "../integrations/gogcli-email.js";
import { classifyAssistantEmail } from "../integrations/email-classifier.js";
import { draftEmailReply } from "../integrations/email-reply-draft.js";
import { demoWeather } from "../integrations/weather.js";

export type ReportConfig = {
  assistantStatePath?: string;
  testGmailAccount?: string;
  testCalendarId?: string;
  query?: string;
};
export type ReportKind =
  | "briefing"
  | "recap"
  | "alerts"
  | "calendar"
  | "knowledge"
  | "email"
  | "unread_email";
export const clean = (s: string) =>
  Array.from(
    s
      .replace(/<<<(?:END_)?EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "")
      .replace(/^\s*Source: google_api\s*---\s*/, ""),
    (char) => (char.charCodeAt(0) < 32 ? " " : char),
  )
    .join("")
    .slice(0, 180);
export async function assistantReport(
  kind: ReportKind,
  config: ReportConfig,
  dependencies = {
    calendar: listTestCalendarEvents,
    listMail: listTestEmailThreads,
    getMail: getTestEmailThread,
    weather: demoWeather,
  },
  now = new Date(),
) {
  z.enum([
    "briefing",
    "recap",
    "alerts",
    "calendar",
    "knowledge",
    "email",
    "unread_email",
  ]).parse(kind);
  if (!config.assistantStatePath)
    throw new Error("ASSISTANT_STATE_NOT_CONFIGURED");
  const store = new AssistantState(config.assistantStatePath);
  const mailbox =
    kind === "alerts" && config.testGmailAccount
      ? new EmailEventStore(config.assistantStatePath)
      : undefined;
  const acknowledged: string[] = [];
  try {
    const prefs = store.preferences();
    const knowledge = new KnowledgeStore(config.assistantStatePath);
    const facts = knowledge.list();
    knowledge.close();
    const detailed = facts.some(
      (f) =>
        f.kind === "style" &&
        f.key === "communication" &&
        f.value === "detailed",
    );
    if (kind === "knowledge")
      return {
        status: "success",
        text: `Fictional preferences: ${prefs.timeZone}; ${prefs.meetingMinutes}-minute meetings; protect weekday 09:00–11:00 focus time: ${prefs.protectFocusTime}. Source: ${prefs.source}.\n${facts.map((f) => `${f.kind}:${f.key} (v${f.revision}): ${f.value}`).join("\n")}`,
        facts,
        preferences: prefs,
        alerts: [],
      };
    const today = Temporal.Instant.from(now.toISOString())
      .toZonedDateTimeISO(prefs.timeZone)
      .toPlainDate();
    const query = readQuery(config.query ?? "", now);
    if (query.needsClarification)
      return {
        status: "partial",
        text: "Please specify one date (YYYY-MM-DD), today, tomorrow or a weekday. Date ranges are not yet supported by this report.",
        issues: ["DATE_RANGE_NEEDS_CLARIFICATION"],
        alerts: [],
      };
    const date =
      kind === "recap"
        ? today.add({ days: 1 })
        : kind === "calendar"
          ? Temporal.PlainDate.from(query.date)
          : today;
    const from = date.toZonedDateTime({
      timeZone: prefs.timeZone,
      plainTime: "00:00",
    });
    const to = from.add({ days: kind === "alerts" ? 2 : 1 });
    const emailOnly = kind === "email" || kind === "unread_email";
    const calendar = emailOnly
      ? {
          status: "success" as const,
          data: { events: [] as TestCalendarEvent[] },
        }
      : await dependencies.calendar(
          {
            from: from.toInstant().toString(),
            to: to.toInstant().toString(),
            timeZone: prefs.timeZone,
            maxResults: 50,
          },
          {
            configuredAccount: config.testGmailAccount,
            configuredCalendarId: config.testCalendarId,
          },
        );
    const lines = [
      `ApplyPilot ${kind} — ${kind === "recap" ? today : date} (${prefs.timeZone})`,
    ];
    if (kind === "recap") lines.push(`Tomorrow’s calendar: ${date}`);
    const issues: string[] = [];
    const alerts: { key: string; text: string }[] = [];
    let analysis: ReturnType<typeof dailyCalendar> | undefined;
    const events = calendar.status === "success" ? calendar.data.events : [];
    if (emailOnly) {
      lines.push(
        "Dedicated synthetic mailbox only; last 30 days. Thread-level search; latest matching message per thread, not a full conversation transcript.",
      );
    } else if (calendar.status !== "success") {
      issues.push(calendar.error.code);
      lines.push(
        "Calendar unavailable: availability and conflicts are unknown.",
      );
    } else if (calendar.data.events.length >= 50) {
      issues.push("CALENDAR_POSSIBLY_TRUNCATED");
      lines.push(
        "Calendar result limit reached; no free-time claim until full data is available.",
      );
    } else {
      const events = calendar.data.events;
      const blocks: TestCalendarEvent[] = [];
      if (prefs.protectFocusTime && date.dayOfWeek <= 5)
        blocks.push({
          eventId: "synthetic-focus-preference",
          summary: "Reserved focus time",
          allDay: false,
          contentTrust: "untrusted_external_content",
          start: date
            .toZonedDateTime({ timeZone: prefs.timeZone, plainTime: "09:00" })
            .toInstant()
            .toString(),
          end: date
            .toZonedDateTime({ timeZone: prefs.timeZone, plainTime: "11:00" })
            .toInstant()
            .toString(),
        });
      analysis = dailyCalendar([...events, ...blocks], {
        date: date.toString(),
        timeZone: prefs.timeZone,
        durationMinutes: prefs.meetingMinutes,
      });
      analysis.suggestedSlots = analysis.gaps.flatMap((gap) => {
        const start = Math.max(
          Date.parse(gap.start),
          Math.ceil(now.getTime() / 60_000) * 60_000,
        );
        const end = start + prefs.meetingMinutes * 60_000;
        return end <= Date.parse(gap.end)
          ? [
              {
                start: new Date(start).toISOString(),
                end: new Date(end).toISOString(),
              },
            ]
          : [];
      });
      for (const event of events) {
        lines.push(
          `Event [${event.eventId}]: ${clean(event.summary)}; ${event.start} → ${event.end}`,
        );
        if (
          !event.allDay &&
          Date.parse(event.start) >= now.getTime() &&
          Date.parse(event.start) - now.getTime() <= 24 * 3600000
        )
          alerts.push({
            key: `calendar:${event.eventId}:${event.start}`,
            text: `Upcoming test event: ${clean(event.summary)} at ${event.start}`,
          });
      }
      lines.push(
        `Calendar conflicts: ${analysis.conflicts.length}. Dedicated test calendar only.`,
      );
      for (const conflict of analysis.conflicts)
        lines.push(
          `Conflict ${conflict.eventIds.join(" / ")}: ${conflict.start} → ${conflict.end}`,
        );
      lines.push(
        `Working-time gaps: ${analysis.gaps.map((g) => `${g.start} → ${g.end}`).join("; ") || "none"}`,
      );
      lines.push(
        `Suggested ${prefs.meetingMinutes}-minute slots: ${analysis.suggestedSlots.map((g) => `${g.start} → ${g.end}`).join("; ") || "none"}`,
      );
    }
    if (kind !== "calendar") {
      const account = config.testGmailAccount ?? "";
      const pending = mailbox?.pendingMailboxThreads(account, 10) ?? [];
      let listed = pending.length
        ? {
            status: "success" as const,
            data: {
              threads: pending.map((threadId) => ({ threadId })),
              nextCursor: undefined,
            },
          }
        : await dependencies.listMail(
            {
              maxResults: 10,
              briefing: kind === "briefing",
              unreadOnly: kind === "unread_email" || query.unreadOnly,
              sender: query.sender,
              after: query.after,
              ...(mailbox ? { cursor: mailbox.mailboxCursor(account) } : {}),
            },
            { configuredAccount: config.testGmailAccount },
          );
      if (emailOnly && listed.status === "success") {
        const threads = [...listed.data.threads];
        const cursors = new Set<string>();
        for (let page = 1; page < 3 && listed.data.nextCursor; page++) {
          const cursor = listed.data.nextCursor;
          if (cursors.has(cursor)) {
            issues.push("EMAIL_PAGINATION_LOOP");
            break;
          }
          cursors.add(cursor);
          const next = await dependencies.listMail(
            {
              maxResults: 10,
              cursor,
              unreadOnly: kind === "unread_email" || query.unreadOnly,
              sender: query.sender,
              after: query.after,
            },
            { configuredAccount: config.testGmailAccount },
          );
          if (next.status !== "success") {
            issues.push(next.error.code);
            break;
          }
          threads.push(...next.data.threads);
          listed = next;
        }
        listed = {
          status: "success",
          data: {
            threads: [...new Map(threads.map((t) => [t.threadId, t])).values()],
            nextCursor: listed.data.nextCursor,
          },
        };
      }
      if (listed.status !== "success") {
        issues.push(listed.error.code);
        lines.push("Project email unavailable; no empty-inbox claim.");
      } else {
        if (mailbox && !pending.length)
          mailbox.commitMailboxPage({
            accountId: account,
            threadIds: listed.data.threads.map((t) => t.threadId),
            nextCursor: listed.data.nextCursor,
          });
        if (query.sender || query.after)
          lines.push(
            `Search filters: sender ${query.sender ?? "any"}; received after ${query.after ?? "last 30 days"}.`,
          );
        if (listed.data.nextCursor)
          lines.push(
            "Email summary reached its bounded page budget; additional messages remain.",
          );
        if (kind === "unread_email" && !listed.data.threads.length)
          lines.push(
            "No unread synthetic project emails matched the current provider query (last 30 days). This does not describe other mail.",
          );
        const fetched = new Map<
          string,
          Awaited<ReturnType<typeof dependencies.getMail>>
        >();
        for (let i = 0; i < listed.data.threads.length; i += 5) {
          await Promise.all(
            listed.data.threads.slice(i, i + 5).map(async (thread) => {
              const mail = await dependencies.getMail(
                {
                  threadId: thread.threadId,
                  unreadOnly: kind === "unread_email" || query.unreadOnly,
                  sender: query.sender,
                  after: query.after,
                },
                { configuredAccount: config.testGmailAccount },
              );
              fetched.set(thread.threadId, mail);
            }),
          );
        }
        for (const thread of listed.data.threads) {
          const mail = fetched.get(thread.threadId)!;
          if (mail.status !== "success") {
            issues.push(mail.error.code);
            continue;
          }
          acknowledged.push(thread.threadId);
          const m = mail.data.message;
          if (!/synthetic/i.test(m.subject)) continue;
          const c = classifyAssistantEmail(m);
          const summary = summarizeEmail(m);
          store.recordEmail({
            messageId: m.messageId,
            threadId: thread.threadId,
            summary: summary.summary,
            projectIds: summary.projectIds,
            needsReview: summary.needsHumanReview || c.needsHumanReview,
            handledAt: now.toISOString(),
          });
          mailbox?.record({
            accountId: account,
            messageId: m.messageId,
            classification: c,
          });
          lines.push(
            `Email [${m.messageId}]: ${clean(m.subject)} — ${clean(summary.summary)} [${c.primaryCategory}]${c.deadlineText ? `; deadline (unverified text): ${clean(c.deadlineText)}` : ""}${c.needsHumanReview || summary.needsHumanReview ? "; needs clarification" : ""}.`,
          );
          if (
            summary.urgent ||
            c.deadlineText ||
            c.categories.includes("assignment")
          )
            alerts.push({
              key: `email:${m.messageId}`,
              text: `Project attention: ${clean(m.subject)}${c.deadlineText ? `; deadline text: ${clean(c.deadlineText)}` : ""}. Review source; no time inferred.`,
            });
          if (summary.urgent)
            lines.push(
              `URGENT email [${m.messageId}]: review source before acting.`,
            );
          if (detailed)
            for (const action of summary.actions)
              lines.push(`Requested action [${m.messageId}]: ${clean(action)}`);
          const draft = draftEmailReply(c, m);
          if (draft)
            lines.push(
              `Draft available for review: /reviewemail ${thread.threadId} (not sent).`,
            );
        }
      }
    }
    for (const event of events) {
      const context = meetingContext(event, facts, store.emailContext());
      lines.push(
        `Meeting preparation [${event.eventId}]: ${context.sources.length ? context.sources.map((s) => `${clean(s.text)} [${s.source}]`).join("; ") : "No explicitly linked source context available."}`,
      );
      for (const alert of alerts)
        if (
          alert.key === `calendar:${event.eventId}:${event.start}` &&
          context.sources.length
        )
          alert.text += `; preparation: ${clean(context.sources[0]!.text)} [${context.sources[0]!.source}]`;
    }
    if (kind === "briefing") {
      const weather = await dependencies.weather();
      lines.push(
        weather.status === "success"
          ? `Weather — ${weather.city}: ${weather.temperatureC} °C, WMO code ${weather.weatherCode}; observed ${weather.observedAt}; ${weather.source}; forecast: ${weather.forecast.map((f) => `${f.date}: ${f.lowC}–${f.highC} °C, rain ${f.rainProbability}%, WMO ${f.weatherCode}`).join("; ")}`
          : weather.status === "forecast_only"
            ? `Weather — ${weather.city}; current observations unavailable; NWS forecast: ${weather.periods.map((p) => `${p.name} (${p.startTime} → ${p.endTime}): ${p.temperatureC} °C, ${clean(p.shortForecast)}, rain ${p.probabilityOfPrecipitation.value === null ? "unknown" : p.probabilityOfPrecipitation.value + "%"}`).join("; ")}; generated ${weather.generatedAt}; ${weather.source}`
            : weather.reason,
      );
      if (weather.status === "unavailable") issues.push("WEATHER_UNAVAILABLE");
    }
    if (!emailOnly) {
      const tasks = new TodoStore(config.assistantStatePath);
      try {
        const all = tasks.list("all");
        const open = all.filter((t) => t.status === "open");
        lines.push(`Open tasks: ${open.length}.`);
        if (analysis)
          for (const slot of planTaskSlots(
            open,
            analysis.gaps,
            date.toString(),
            now,
            prefs.meetingMinutes,
          ))
            lines.push(
              `Task plan [${slot.taskId}]: ${clean(slot.title)}; ${slot.durationMinutes} minutes; ${slot.start ? `${slot.start} → ${slot.end}` : "no slot"}; ${slot.reason}. Suggestion only, not booked.`,
            );
        for (const task of open) {
          lines.push(
            `Task [${task.id}]: ${clean(task.title)}; P${task.priority}; due ${task.dueDate ?? "none"}`,
          );
          if (task.dueDate && task.dueDate <= today.add({ days: 1 }).toString())
            alerts.push({
              key: `todo:${task.id}:${task.dueDate}`,
              text: `Task due ${task.dueDate}: ${clean(task.title)} (P${task.priority})`,
            });
        }
        if (kind === "recap") {
          const completed = all.filter(
            (t) =>
              t.completedAt &&
              Temporal.Instant.from(t.completedAt)
                .toZonedDateTimeISO(prefs.timeZone)
                .toPlainDate()
                .equals(today),
          );
          lines.push(`Tasks completed today: ${completed.length}.`);
          for (const task of completed)
            lines.push(`Completed: ${clean(task.title)} [${task.id}]`);
          const begin = today
            .toZonedDateTime({ timeZone: prefs.timeZone, plainTime: "00:00" })
            .toInstant()
            .toString();
          const activity = store.activity(begin, now.toISOString());
          lines.push(
            `Activity today: ${activity.messages} unique messages processed; ${activity.sent} confirmed email sends; ${activity.reports} reports generated (delivery tracked separately).`,
          );
          for (const item of activity.pending)
            lines.push(
              `Needs your decision: email draft ${item.id}; ${item.status}; expiry ${item.expires_at}. Review before approval; do not retry ambiguous sends.`,
            );
          for (const item of store.emailContext().filter((e) => e.needsReview))
            lines.push(
              `Needs clarification: email ${item.messageId}; /reviewemail ${item.threadId}.`,
            );
          for (const task of open.filter(
            (t) => t.dueDate && t.dueDate <= today.add({ days: 1 }).toString(),
          ))
            lines.push(
              `Upcoming/overdue deadline: ${clean(task.title)} — ${task.dueDate}`,
            );
        }
      } finally {
        tasks.close();
      }
    }
    for (const issue of issues)
      alerts.push({
        key: `provider:${today}:${issue}`,
        text: `Assistant needs attention: ${issue}. No missing data was substituted.`,
      });
    // Reserve before delivery. Ambiguous delivery stays held, never silently resent.
    const fresh =
      kind === "alerts"
        ? alerts.filter((a) =>
            store.reserveAlert(
              createHash("sha256").update(a.key).digest("hex"),
              now.toISOString(),
            ),
          )
        : [];
    for (const threadId of acknowledged)
      mailbox?.acknowledgeMailboxThread(
        config.testGmailAccount ?? "",
        threadId,
      );
    store.recordReport(kind, now);
    let alertText = fresh.length
      ? `ApplyPilot alerts\n${fresh.map((a) => a.text).join("\n")}`
      : "";
    const delivery = new AlertDelivery(config.assistantStatePath);
    try {
      const nativePath = join(
        dirname(config.assistantStatePath),
        "state/openclaw.sqlite",
      );
      if (existsSync(nativePath)) {
        try {
          delivery.reconcileNative(nativePath);
        } catch {
          issues.push("ALERT_RECEIPT_RECONCILIATION_UNAVAILABLE");
        }
      }
      if (alertText)
        alertText = delivery.prepare(
          fresh.map((a) => createHash("sha256").update(a.key).digest("hex")),
          alertText,
          now,
        ).text;
      if (kind === "recap")
        for (const batch of delivery.pending())
          lines.push(
            `Alert delivery needs review: ${batch.id} (${batch.state}). Check scheduler receipts; do not resend uncertain deliveries.`,
          );
    } finally {
      delivery.close();
    }
    return {
      status: issues.length ? "partial" : "success",
      text: kind === "alerts" ? alertText : lines.join("\n"),
      issues,
      analysis,
      alerts: fresh,
      delivery: "not_attempted; scheduler delivery history is authoritative",
    };
  } finally {
    mailbox?.close();
    store.close();
  }
}
