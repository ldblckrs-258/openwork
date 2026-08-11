import { describe, expect, test } from "vitest";
import { characterCardV2Schema } from "../../../packages/types/src/roleplay.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";
import { composeSystem, COMBINED_SYSTEM_BUDGET_CHARS, SYSTEM_SECTION_DELIMITER } from "../../../apps/app/src/app/roleplay/compose-system.ts";
import { ROLEPLAY_AGENT, toolMapGrantsAccess } from "../../../apps/app/src/app/roleplay/prompt-options.ts";

const ENV_CONTEXT = "<openwork-env>workspace: /tmp/demo</openwork-env>";

function card(overrides: Record<string, unknown> = {}) {
  return characterCardV2Schema.parse({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Aria",
      description: "The archivist of a drowned library.",
      first_mes: "You're late, {{user}}.",
      ...overrides,
    },
  });
}

const persona = { name: "Wren", description: "A courier with a forged pass." };

describe("system composition", () => {
  test("the environment context is composed onto, never replaced", () => {
    // Every send in the app carries this string, and it is built outside the
    // roleplay compiler — replacing it would strip context the rest of the app
    // assumes is present.
    const turn = buildRoleplayTurn({ card: card(), persona, envContext: ENV_CONTEXT });

    expect(turn.prompt.system).toContain(ENV_CONTEXT);
    expect(turn.prompt.system).toContain("The archivist of a drowned library.");
    expect(turn.composed.dropped).toEqual([]);
  });

  test("a send with no environment context still compiles a character prompt", () => {
    const turn = buildRoleplayTurn({ card: card(), persona, envContext: null });

    expect(turn.prompt.system).toContain("# Aria");
    expect(turn.prompt.system.startsWith(SYSTEM_SECTION_DELIMITER)).toBe(false);
  });

  test("director text lands in system, last, and nowhere near the message", () => {
    // The engine puts the whole `system` string ahead of all chat history, so
    // "last within system" is the closest to the conversation it can get.
    const turn = buildRoleplayTurn({
      card: card(),
      persona,
      directorText: "keep her evasive",
      envContext: ENV_CONTEXT,
    });

    expect(turn.prompt.system.endsWith("keep her evasive")).toBe(true);
  });

  test("the combined ceiling drops the environment context before the character", () => {
    // A roleplay send denies every tool, so the workspace description cannot be
    // acted on; losing the character prompt would lose the character.
    // Sized so the character prompt fits alone but not alongside the
    // environment context, which is exactly the case the priority decides.
    const huge = "x".repeat(COMBINED_SYSTEM_BUDGET_CHARS - 40);
    const composed = composeSystem({ envContext: ENV_CONTEXT, characterPrompt: huge, directorText: "be brief" });

    expect(composed.dropped).toEqual(["envContext"]);
    expect(composed.system).not.toContain(ENV_CONTEXT);
    expect(composed.system).toContain("be brief");
    expect(composed.chars).toBeLessThanOrEqual(COMBINED_SYSTEM_BUDGET_CHARS);
  });

  test("a character prompt that alone exceeds the ceiling is truncated, not sent whole", () => {
    // Without a combined check here nothing enforces a ceiling at all: the
    // compiler's own budget never sees the environment string.
    const composed = composeSystem({
      envContext: null,
      characterPrompt: "y".repeat(COMBINED_SYSTEM_BUDGET_CHARS * 2),
      directorText: "stay in scene",
    });

    expect(composed.truncated).toBe(true);
    expect(composed.chars).toBeLessThanOrEqual(COMBINED_SYSTEM_BUDGET_CHARS);
    expect(composed.system.endsWith("stay in scene")).toBe(true);
  });
});

describe("the denial boundary on the send path", () => {
  test("every roleplay turn pins the agent and denies every tool", () => {
    const turn = buildRoleplayTurn({ card: card(), persona, envContext: ENV_CONTEXT });

    expect(turn.prompt.agent).toBe(ROLEPLAY_AGENT);
    expect(toolMapGrantsAccess(turn.prompt.tools)).toBe(false);
  });

  test("the pin is unconditional, so a saved agent preference cannot reach the wire", () => {
    // The preference is global and persisted. A user whose saved agent is
    // `build` would otherwise run untrusted card text against a fully
    // tool-enabled agent, and no amount of manual testing by a developer with
    // `roleplay` selected would reproduce it.
    const turn = buildRoleplayTurn({ card: card(), persona, envContext: ENV_CONTEXT });
    // Mirrors the call site, which spreads the roleplay options last so nothing
    // downstream can reintroduce an unpinned agent.
    const wire: { agent?: string } = { agent: "build" };
    Object.assign(wire, turn.prompt);

    expect(wire.agent).toBe(ROLEPLAY_AGENT);
  });
});

describe("the greeting", () => {
  test("the compiled prompt tells the model what it opened with", () => {
    // The engine cannot store an assistant message, so the greeting is rendered
    // by the client. Without this the model has no record of having spoken and
    // the first reply reads as if the scene had not started.
    const turn = buildRoleplayTurn({
      card: card(),
      persona,
      greeting: "You're late, {{user}}.",
      envContext: null,
    });

    expect(turn.prompt.system).toContain("You opened the scene with:");
    expect(turn.prompt.system).toContain("You're late, Wren.");
  });

  test("a character with no greeting adds no opening-line section", () => {
    const turn = buildRoleplayTurn({ card: card(), persona, greeting: "", envContext: null });

    expect(turn.prompt.system).not.toContain("Opening Line");
  });
});
