import { describe, expect, test } from "vitest";
import { buildOpenworkRuntimeConfigObjectFromSnapshot } from "../../../apps/server/src/openwork-runtime-config.ts";
import {
  ROLEPLAY_AGENT,
  ROLEPLAY_STATE_TOOL,
  roleplayPromptOptions,
  roleplayTurnPromptOptions,
  toolMapGrantsAccess,
  toolMapGrantsOnly,
} from "../../../apps/app/src/app/roleplay/prompt-options.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";

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
    // runtime.
    expect(Object.keys(roleplayPromptOptions("x").tools)).toEqual(["*"]);
  });

  test("callers cannot mutate the shared denial constant through the returned map", () => {
    const first = roleplayPromptOptions("a");
    first.tools.read = true;

    expect(roleplayPromptOptions("b").tools).toEqual({ "*": false });
  });

  test("toolMapGrantsAccess rejects every shape that would expose a tool", () => {
    // `{}` is the important one: an empty map is a no-op, not a deny-all, and it
    // is the shape a reader is most likely to assume is safe.
    expect(toolMapGrantsAccess(undefined)).toBe(true);
    expect(toolMapGrantsAccess({})).toBe(true);
    expect(toolMapGrantsAccess({ read: true })).toBe(true);
    expect(toolMapGrantsAccess({ "*": true })).toBe(true);
    expect(toolMapGrantsAccess({ "*": false, read: true })).toBe(true);
    expect(toolMapGrantsAccess({ bash: false })).toBe(true);

    expect(toolMapGrantsAccess({ "*": false })).toBe(false);
  });

  test("toolMapGrantsOnly holds the turn path to an exact set, not a count", () => {
    // The turn path can no longer be asserted with "grants nothing", so this is
    // what makes a second tool arriving one day a failure rather than a silent
    // widening.
    expect(toolMapGrantsOnly({ "*": false, [ROLEPLAY_STATE_TOOL]: true }, [ROLEPLAY_STATE_TOOL])).toBe(true);
    expect(toolMapGrantsOnly({ "*": false }, [])).toBe(true);

    expect(toolMapGrantsOnly({ "*": false, [ROLEPLAY_STATE_TOOL]: true, read: true }, [ROLEPLAY_STATE_TOOL])).toBe(false);
    expect(toolMapGrantsOnly({ "*": true, [ROLEPLAY_STATE_TOOL]: true }, [ROLEPLAY_STATE_TOOL])).toBe(false);
    expect(toolMapGrantsOnly({ [ROLEPLAY_STATE_TOOL]: true }, [ROLEPLAY_STATE_TOOL])).toBe(false);
    expect(toolMapGrantsOnly(undefined, [])).toBe(false);
    expect(toolMapGrantsOnly({}, [])).toBe(false);
  });
});

describe("the turn path is the only one that carries a tool", () => {
  const card = () => ({
    spec: "chara_card_v2" as const,
    spec_version: "2.0",
    data: {
      name: "Aria",
      description: "The archivist of a drowned library.",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      character_version: "",
      tags: [],
      creator: "",
      extensions: {},
    },
  });

  test("a roleplay turn carries exactly the scene-state tool", () => {
    const turn = buildRoleplayTurn({ card: card(), persona: { name: "Wren", description: "A courier." }, envContext: null });

    expect(turn.prompt.agent).toBe(ROLEPLAY_AGENT);
    expect(toolMapGrantsOnly(turn.prompt.tools, [ROLEPLAY_STATE_TOOL])).toBe(true);
  });

  test("the shared options function still grants nothing, which is what the other five callers use", () => {
    // Greeting, memory extraction, both generation prompts, and revise all
    // process untrusted card text and model output. Their own specs assert this
    // too; it is restated here because widening the shared constant in place is
    // the single change that would arm all five at once.
    expect(toolMapGrantsAccess(roleplayPromptOptions("x").tools)).toBe(false);
  });

  test("the turn path can be narrowed to deny-all, and there is no way to widen it", () => {
    expect(roleplayTurnPromptOptions("x", { denyTools: true }).tools).toEqual({ "*": false });
    expect(toolMapGrantsAccess(roleplayTurnPromptOptions("x", { denyTools: true }).tools)).toBe(false);
  });

  test("mutating a returned turn map cannot reach the frozen constant behind it", () => {
    const first = roleplayTurnPromptOptions("a");
    first.tools.read = true;
    first.tools["*"] = true;

    expect(roleplayTurnPromptOptions("b").tools).toEqual({ "*": false, [ROLEPLAY_STATE_TOOL]: true });
  });
});

describe("roleplay agent registration", () => {
  const config = buildOpenworkRuntimeConfigObjectFromSnapshot({}) as {
    agent: Record<string, { tools?: Record<string, boolean>; permission?: Record<string, string>; temperature?: number; hidden?: boolean }>;
  };

  test("the shipped agent denies with a wildcard, and allows exactly one tool beside it", () => {
    // The wildcard must stay: it refuses every other tool at execution.
    const roleplay = config.agent[ROLEPLAY_AGENT];

    expect(roleplay?.tools).toEqual({ "*": false });
    expect(roleplay?.permission).toEqual({ "*": "deny", [ROLEPLAY_STATE_TOOL]: "allow" });
    expect(Object.keys(roleplay?.permission ?? {})[0]).toBe("*");
    expect(roleplay?.temperature).toBe(0.95);
  });

  test("the default openwork agent is denied the roleplay tool the engine-wide plugin advertises to it", () => {
    // Defence in depth rather than the control: `plugin[]` is engine-wide, so
    // the tool is advertised to ordinary coding sessions. The controls are the
    // tool's own agent check and its route 404ing an unbound session; this is
    // what keeps it off the wire in the first place.
    expect(config.agent.openwork?.permission?.[ROLEPLAY_STATE_TOOL]).toBe("deny");
  });

  test("the roleplay state plugin is registered in the engine-wide plugin list", () => {
    // A plugin missing here is a tool that never loads, which looks exactly like
    // working denial from the outside.
    const plugins = (buildOpenworkRuntimeConfigObjectFromSnapshot({}) as { plugin: string[] }).plugin;

    expect(plugins.some((entry) => entry.includes("openwork-roleplay-state"))).toBe(true);
  });

  test("the roleplay agent stays out of the general agent picker", () => {
    expect(config.agent[ROLEPLAY_AGENT]?.hidden).toBe(true);
  });

  test("registering it leaves the default openwork agent untouched", () => {
    expect(config.agent.openwork?.temperature).toBe(0.2);
    expect(config.agent.openwork?.tools).toBeUndefined();
    expect(config.agent.openwork?.permission).toHaveProperty("skill");
  });
});
