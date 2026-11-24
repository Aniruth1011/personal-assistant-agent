import type { TestCalendarEvent } from "../integrations/gogcli-calendar.js";
import type { KnowledgeFact } from "../knowledge/store.js";
import type { Todo } from "../tasks/store.js";

export const projectIds = (text: string) => [
  ...new Set(
    [...text.matchAll(/\[project:([a-z][a-z0-9-]{1,40})\]/g)].map((m) => m[1]!),
  ),
];
export type EmailContext = {
  messageId: string;
  threadId: string;
  summary: string;
  projectIds: string[];
  needsReview: boolean;
  handledAt: string;
};
export function meetingContext(
  event: TestCalendarEvent,
  facts: KnowledgeFact[],
  emails: EmailContext[],
) {
  const ids = projectIds(event.summary + " " + (event.description ?? ""));
  return {
    eventId: event.eventId,
    sources: [
      ...facts
        .filter((f) => f.kind === "project" && ids.includes(f.key))
        .map((f) => ({
          source: `KNOWLEDGE.md:${f.kind}:${f.key}@${f.revision}`,
          text: f.value,
        })),
      ...emails
        .filter(
          (e) => !e.needsReview && e.projectIds.some((id) => ids.includes(id)),
        )
        .slice(0, 3)
        .map((e) => ({
          source: `gmail-message:${e.messageId}`,
          text: e.summary,
        })),
    ],
    association: "explicit_project_tag" as const,
  };
}
/** Sequential suggestions consume gaps and respect explicit task duration/date; no events are written. */
export function planTaskSlots(
  tasks: Todo[],
  gaps: { start: string; end: string }[],
  date: string,
  now: Date,
  defaultMinutes: number,
) {
  const remaining = gaps.map((g) => ({
    start: Math.max(
      Date.parse(g.start),
      Math.ceil(now.getTime() / 60000) * 60000,
    ),
    end: Date.parse(g.end),
  }));
  return tasks
    .filter((t) => t.status === "open")
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    )
    .slice(0, 10)
    .map((task) => {
      const match = /\[duration:(\d{1,3})m\]/.exec(task.title);
      const duration = match ? Number(match[1]) : defaultMinutes;
      if (duration < 5 || duration > 240)
        return {
          taskId: task.id,
          title: task.title,
          reason: "unsupported_duration",
          durationMinutes: duration,
        };
      if (task.dueDate && task.dueDate < date)
        return {
          taskId: task.id,
          title: task.title,
          reason: "overdue_requires_replanning",
          durationMinutes: duration,
        };
      const gap = remaining.find((g) => g.end - g.start >= duration * 60000);
      if (!gap)
        return {
          taskId: task.id,
          title: task.title,
          reason: "no_fitting_gap",
          durationMinutes: duration,
        };
      const start = new Date(gap.start).toISOString();
      gap.start += duration * 60000;
      return {
        taskId: task.id,
        title: task.title,
        durationMinutes: duration,
        start,
        end: new Date(gap.start).toISOString(),
        reason: match
          ? "explicit_task_duration"
          : "preference_default_duration",
      };
    });
}
