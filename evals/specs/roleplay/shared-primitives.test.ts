import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { parseLlmJson } from "../../../apps/app/src/app/roleplay/parse-llm-json.ts";
import {
  applyContextualInjectionBudget,
  CONTEXTUAL_INJECTION_BUDGET_CHARS,
} from "../../../apps/app/src/app/roleplay/injection-budget.ts";

const roleplayDir = fileURLToPath(new URL("../../../apps/app/src/app/roleplay/", import.meta.url));

const cardIdea = z.object({ name: z.string(), traits: z.array(z.string()) });

describe("parseLlmJson", () => {
  test("clean JSON parses without a repair round", () => {
    const result = parseLlmJson('{"name":"Aria","traits":["wry"]}', cardIdea);

    expect(result).toEqual({ ok: true, value: { name: "Aria", traits: ["wry"] }, repaired: false });
  });

  test("a fenced code block is unwrapped", () => {
    const result = parseLlmJson('```json\n{"name":"Aria","traits":["wry"]}\n```', cardIdea);

    expect(result.ok && result.value.name).toBe("Aria");
    expect(result.ok && result.repaired).toBe(true);
  });

  test("prose either side of the object is discarded", () => {
    const result = parseLlmJson('Sure! Here is the card:\n{"name":"Aria","traits":["wry"]}\nHope that helps.', cardIdea);

    expect(result.ok && result.value.name).toBe("Aria");
  });

  test("a trailing comma is repaired", () => {
    const result = parseLlmJson('{"name":"Aria","traits":["wry",],}', cardIdea);

    expect(result.ok && result.value.traits).toEqual(["wry"]);
  });

  test("output that does not match the schema fails rather than being coerced", () => {
    const result = parseLlmJson('{"name":"Aria","traits":"wry"}', cardIdea);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("traits");
    expect(!result.ok && result.raw).toBe('{"name":"Aria","traits":"wry"}');
  });

  test("repair is bounded to a single round and then gives up", () => {
    const result = parseLlmJson("I could not produce JSON, sorry.", cardIdea);

    expect(result.ok).toBe(false);
  });

  test("the payload is never evaluated as code", () => {
    const result = parseLlmJson('{"name":"${process.env.HOME}","traits":["`whoami`"]}', cardIdea);

    expect(result.ok && result.value.name).toBe("${process.env.HOME}");
    expect(result.ok && result.value.traits).toEqual(["`whoami`"]);
  });
});

describe("contextual injection budget", () => {
  test("everything fitting the ceiling is kept in the caller's order", () => {
    const result = applyContextualInjectionBudget([{ text: "one" }, { text: "two" }, { text: "three" }]);

    expect(result.kept).toEqual(["one", "two", "three"]);
    expect(result.keptIndices).toEqual([0, 1, 2]);
    expect(result.dropped).toBe(0);
  });

  test("lowest priority is discarded first when the ceiling binds", () => {
    const result = applyContextualInjectionBudget(
      [
        { text: "low-priority-entry", priority: 1 },
        { text: "high", priority: 9 },
      ],
      10,
    );

    expect(result.kept).toEqual(["high"]);
    expect(result.keptIndices).toEqual([1]);
    expect(result.dropped).toBe(1);
  });

  test("surviving entries keep their original relative order, not their priority order", () => {
    const result = applyContextualInjectionBudget([
      { text: "first", priority: 1 },
      { text: "second", priority: 9 },
    ]);

    expect(result.kept).toEqual(["first", "second"]);
  });

  test("a single entry larger than the whole ceiling is dropped rather than truncated", () => {
    const result = applyContextualInjectionBudget([{ text: "x".repeat(CONTEXTUAL_INJECTION_BUDGET_CHARS + 1) }]);

    expect(result.kept).toEqual([]);
    expect(result.dropped).toBe(1);
  });
});

describe("framework-free layer", () => {
  test("no module under app/roleplay imports React", async () => {
    const entries = await readdir(roleplayDir);
    const sources = entries.filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"));
    expect(sources.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const entry of sources) {
      const contents = await readFile(join(roleplayDir, entry), "utf8");
      if (/from\s+["']react(-dom)?(\/[^"']*)?["']/.test(contents)) offenders.push(entry);
    }

    expect(offenders).toEqual([]);
  });
});
