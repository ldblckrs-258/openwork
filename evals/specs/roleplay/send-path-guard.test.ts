import { describe, expect, test } from "vitest";
import { buildOpenworkRuntimeConfigObjectFromSnapshot } from "../../../apps/server/src/openwork-runtime-config.ts";
import {
  ROLEPLAY_AGENT,
  roleplayPromptOptions,
  toolMapGrantsAccess,
} from "../../../apps/app/src/app/roleplay/prompt-options.ts";

/**
 * The tool-denial boundary, asserted without an engine.
 *
 * Its end-to-end proof lives in `tool-denial.slow.test.ts`, which drives a real
 * `opencode` binary — and is therefore excluded from the fast lane and skipped
 * entirely when that binary is absent. Those are exactly the conditions under
 * which a refactor could silently remove the boundary, so the parts that can be
 * checked without an engine are checked here, where they always run.
 */

describe("send-path guard", () => {
  test("roleplayPromptOptions pins the agent and denies every tool", () => {
    const options = roleplayPromptOptions("compiled card");

    expect(options.agent).toBe("roleplay");
    expect(options.tools).toEqual({ "*": false });
    expect(options.system).toBe("compiled card");
  });

  test("the denial map is a wildcard, never an enumeration", () => {
    // Enumerating tool ids is enabled-by-default for whatever the list forgets:
    // the engine advertises more ids than it offers and MCP servers add more at
    // runtime. Proven in reports/tool-denial-spike.md.
    expect(Object.keys(roleplayPromptOptions("x").tools)).toEqual(["*"]);
  });

  test("callers cannot mutate the shared denial constant through the returned map", () => {
    const first = roleplayPromptOptions("a");
    first.tools.read = true;

    expect(roleplayPromptOptions("b").tools).toEqual({ "*": false });
  });

  test("toolMapGrantsAccess rejects every shape that would expose a tool", () => {
    // `{}` is the important one: the spike proved an empty map is a no-op, not a
    // deny-all, and it is the shape a reader is most likely to assume is safe.
    expect(toolMapGrantsAccess(undefined)).toBe(true);
    expect(toolMapGrantsAccess({})).toBe(true);
    expect(toolMapGrantsAccess({ read: true })).toBe(true);
    expect(toolMapGrantsAccess({ "*": true })).toBe(true);
    expect(toolMapGrantsAccess({ "*": false, read: true })).toBe(true);
    expect(toolMapGrantsAccess({ bash: false })).toBe(true);

    expect(toolMapGrantsAccess({ "*": false })).toBe(false);
  });
});

describe("roleplay agent registration", () => {
  const config = buildOpenworkRuntimeConfigObjectFromSnapshot({}) as {
    agent: Record<string, { tools?: Record<string, boolean>; permission?: Record<string, string>; temperature?: number; hidden?: boolean }>;
  };

  test("the shipped agent denies with a wildcard on both mechanisms", () => {
    const roleplay = config.agent[ROLEPLAY_AGENT];

    expect(roleplay?.tools).toEqual({ "*": false });
    expect(roleplay?.permission).toEqual({ "*": "deny" });
    expect(roleplay?.temperature).toBe(0.95);
  });

  test("the roleplay agent stays out of the general agent picker", () => {
    // The picker lists every non-hidden primary agent. Chosen for an ordinary
    // coding session this agent has no tools at all and would just look broken.
    expect(config.agent[ROLEPLAY_AGENT]?.hidden).toBe(true);
  });

  test("registering it leaves the default openwork agent untouched", () => {
    expect(config.agent.openwork?.temperature).toBe(0.2);
    expect(config.agent.openwork?.tools).toBeUndefined();
    expect(config.agent.openwork?.permission).toHaveProperty("skill");
  });
});
