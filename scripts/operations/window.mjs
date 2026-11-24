import { z } from "zod";
export const Readiness = z.strictObject(
  Object.fromEntries(
    [
      "https",
      "memoryRecovery",
      "freshAlert",
      "localModel",
      "cloudModel",
      "securityAudit",
      "routingFailurePolicy",
    ].map((key) => [key, z.literal(true)]),
  ),
);
export function makeWindow({
  readiness,
  sample,
  image,
  now = Date.now(),
  authorization = "User explicitly authorized start after readiness audit (2026-11-13).",
}) {
  Readiness.parse(readiness);
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(image))
    throw Error("PINNED_IMAGE_REQUIRED");
  if (
    !sample.health?.gateway?.ok ||
    !sample.health?.application?.ok ||
    !sample.health?.localModelListed?.ok ||
    sample.issues?.length
  )
    throw Error("LATEST_SAMPLE_NOT_READY");
  const age = now - Date.parse(sample.at);
  if (!Number.isFinite(age) || age < 0 || age > 180000)
    throw Error("FRESH_SAMPLE_REQUIRED");
  if (!/^[a-f0-9]{64}$/.test(sample.configHash ?? ""))
    throw Error("CONFIG_HASH_REQUIRED");
  const start = new Date(now).toISOString();
  return {
    version: 1,
    id: start.replace(/[:.]/g, "-"),
    start,
    end: new Date(now + 48 * 3600000).toISOString(),
    image,
    configHash: sample.configHash,
    baselineBootId: sample.bootId,
    timeZone: "America/Los_Angeles",
    expectedSampleIntervalSeconds: 60,
    maxUnreviewedGapSeconds: 180,
    readiness,
    authorization,
    status: "RUNNING_NOT_YET_EVALUATED",
  };
}
export function assessWindow(manifest, samples, now = Date.now()) {
  const start = Date.parse(manifest.start),
    end = Date.parse(manifest.end);
  if (!Number.isFinite(start) || end - start < 48 * 3600000)
    throw Error("FULL_48H_MANIFEST_REQUIRED");
  const until = Math.min(now, end);
  const ordered = samples
    .filter((s) => Date.parse(s.at) >= start && Date.parse(s.at) <= until)
    .sort((a, b) => a.at.localeCompare(b.at));
  const stamps = [start, ...ordered.map((s) => Date.parse(s.at)), until];
  const gaps = stamps
    .slice(1)
    .map((t, i) => ({
      from: new Date(stamps[i]).toISOString(),
      to: new Date(t).toISOString(),
      seconds: (t - stamps[i]) / 1000,
    }))
    .filter((g) => g.seconds > 180);
  const unhealthy = ordered
    .filter(
      (s) =>
        !s.health?.gateway?.ok ||
        !s.health?.application?.ok ||
        !s.health?.localModelListed?.ok ||
        s.issues?.length,
    )
    .map((s) => s.at);
  const drift = ordered
    .filter((s) => s.configHash !== manifest.configHash)
    .map((s) => s.at);
  const bootIds = [...new Set(ordered.map((s) => s.bootId))];
  const completeTime = now >= end;
  return {
    version: 1,
    windowId: manifest.id,
    observedThrough: new Date(until).toISOString(),
    completeTime,
    sampleCount: ordered.length,
    gaps,
    unhealthy,
    configDrift: drift,
    bootIds,
    restartReviewRequired:
      bootIds.length > 1 ||
      bootIds.some((id) => id !== manifest.baselineBootId),
    status: !completeTime
      ? "IN_PROGRESS"
      : !ordered.length ||
          gaps.length ||
          unhealthy.length ||
          drift.length ||
          bootIds.length !== 1 ||
          bootIds[0] !== manifest.baselineBootId
        ? "REQUIRES_REVIEW"
        : "COVERAGE_COMPLETE_SCHEDULE_AND_INCIDENT_REVIEW_REQUIRED",
  };
}
