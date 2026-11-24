import { Temporal } from "@js-temporal/polyfill";

/** Constrained query extraction. User text remains data, never a command or Gmail expression. */
export function readQuery(text: string, now = new Date()) {
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO("America/Los_Angeles")
    .toPlainDate();
  let date = today;
  if (/\btomorrow\b/i.test(text)) date = today.add({ days: 1 });
  else if (/\byesterday\b/i.test(text)) date = today.subtract({ days: 1 });
  const explicit = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
  if (explicit)
    date = Temporal.PlainDate.from(explicit, { overflow: "reject" });
  const weekday =
    /\b(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
      text,
    )?.[1];
  if (weekday && !explicit) {
    const day =
      [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ].indexOf(weekday.toLowerCase()) + 1;
    date = today.add({ days: (day - today.dayOfWeek + 7) % 7 || 7 });
  }
  const from =
    /\bfrom\s+(?!(?:today|tomorrow|yesterday|last|this|next|the|my|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)([a-z0-9_.+@-]{1,120})(?=\s|[?!,.]|$)/i
      .exec(text)?.[1]
      ?.replace(/\.+$/, "");
  const hasDate = Boolean(
    explicit || /\b(today|tomorrow|yesterday)\b/i.test(text) || weekday,
  );
  const after = hasDate || /\bnew\b/i.test(text) ? date.toString() : undefined;
  return {
    date: date.toString(),
    sender: from,
    after,
    unreadOnly: /\bunread\b/i.test(text),
    needsClarification:
      /\b(next week|last week|next month|last month|between)\b/i.test(text),
  };
}
