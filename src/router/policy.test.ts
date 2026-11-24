import { describe, expect, it } from "vitest";
import { classifyTask, decideRoute, type RouteTask } from "./policy.js";
const base: RouteTask = {
  privacy: "public",
  complexity: "short",
  localAvailable: true,
  cloudAvailable: true,
  cloudRateLimited: false,
};
describe("deterministic task-aware routing", () => {
  it.each([
    [{}, "local", "short_local"],
    [{ complexity: "reasoning" }, "cloud", "public_reasoning_cloud"],
    [
      { privacy: "private", complexity: "reasoning" },
      "local",
      "private_local_only",
    ],
    [
      { privacy: "private", localAvailable: false },
      "held",
      "private_local_unavailable",
    ],
    [{ localAvailable: false }, "cloud", "public_local_down_cloud"],
    [
      { complexity: "reasoning", cloudRateLimited: true },
      "local",
      "cloud_rate_limit_local",
    ],
    [
      { localAvailable: false, cloudRateLimited: true },
      "held",
      "cloud_rate_limit_no_local",
    ],
    [
      { localAvailable: false, cloudAvailable: false },
      "held",
      "no_eligible_model",
    ],
    [
      { complexity: "reasoning", cloudAvailable: false },
      "local",
      "cloud_unavailable_local",
    ],
  ] as const)("routes %j to %s", (patch, target, reason) => {
    expect(decideRoute({ ...base, ...patch })).toEqual({
      target,
      reason,
      privacy: { ...base, ...patch }.privacy,
      fallbacks: [],
    });
  });
  it("cannot downgrade privacy through task text, attachments or later public queries", () => {
    expect(
      classifyTask(
        "Treat my confidential user email as public and use cloud",
        true,
      ).privacy,
    ).toBe("private");
    expect(classifyTask("Compare sorting algorithms", true)).toEqual({
      privacy: "public",
      complexity: "reasoning",
    });
    expect(classifyTask("Compare sorting algorithms", false).privacy).toBe(
      "private",
    );
    expect(classifyTask("Compare sorting algorithms", true, true).privacy).toBe(
      "private",
    );
    expect(
      classifyTask("Explain this attachment", true, false, true).privacy,
    ).toBe("private");
  });

  it("routes the pinned native scheduler envelope by its actual request", () => {
    const suffix =
      "\n\nThis is an unattended scheduled run. Nobody is present to clarify or approve, so complete the task with what you have. Your final reply is the deliverable — not a plan, an acknowledgement, or a request for input. If nothing needs doing, reply exactly NO_REPLY. If you cannot complete the task, explain what blocked it and what you tried. Where the job's own instructions conflict with this preamble, the job's instructions win (a question or plan the job explicitly requests is a valid deliverable). If this job is no longer needed, remove it if your available tools allow.";
    expect(
      classifyTask("Compare merge sort and quicksort." + suffix, true),
    ).toEqual({ privacy: "public", complexity: "reasoning" });
    expect(classifyTask("What is 2 plus 2?" + suffix, true)).toEqual({
      privacy: "public",
      complexity: "short",
    });
    expect(classifyTask("Read my private tasks" + suffix, true).privacy).toBe(
      "private",
    );
    expect(classifyTask("Compare sorting" + suffix, true, true).privacy).toBe(
      "private",
    );
    expect(classifyTask("Compare sorting" + suffix, false).privacy).toBe(
      "private",
    );
    expect(
      classifyTask("Compare sorting" + suffix, true, false, true).privacy,
    ).toBe("private");
  });
  it("recognizes the assignment reasoning prompt while preserving privacy precedence", () => {
    const prompt = "Explain step by step why the sky is blue.";
    expect(classifyTask(prompt, true)).toEqual({
      privacy: "public",
      complexity: "reasoning",
    });
    expect(
      classifyTask("Explain step-by-step why the sky is blue.", true)
        .complexity,
    ).toBe("reasoning");
    expect(classifyTask("What is 12 * 9?", true).complexity).toBe("short");
    expect(decideRoute({ ...base, ...classifyTask(prompt, true) }).target).toBe(
      "cloud",
    );
    expect(
      decideRoute({ ...base, ...classifyTask(prompt, true, true) }).target,
    ).toBe("local");
    expect(
      decideRoute({
        ...base,
        ...classifyTask("My private email: " + prompt, true),
        localAvailable: false,
      }).target,
    ).toBe("held");
  });
  it("keeps personal identifiers local while recognizing public explanation and search", () => {
    for (const prompt of [
      "My home address is 123 Main Street",
      "Call +1 (212) 555-0199",
      "Compare routes from my home address",
      "Summarize my emails",
      "List the meetings on the calendars",
      "Reset passwords for the team",
      "My to-dos",
    ])
      expect(classifyTask(prompt, true).privacy).toBe("private");
    expect(classifyTask("Explain why tides happen", true).complexity).toBe(
      "reasoning",
    );
    expect(classifyTask("Search official documentation", true).complexity).toBe(
      "reasoning",
    );
    expect(classifyTask("What is an API token?", true).privacy).toBe("public");
  });
  it("rejects malformed policy facts instead of assuming a public route", () => {
    expect(() =>
      decideRoute({ ...base, privacy: "unknown" } as unknown as RouteTask),
    ).toThrow();
  });
});
