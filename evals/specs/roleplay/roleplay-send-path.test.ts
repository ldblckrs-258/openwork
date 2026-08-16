import { describe, expect, test } from "vitest";
import { characterCardV2Schema } from "../../../packages/types/src/roleplay.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";
import { composeSystem, COMBINED_SYSTEM_BUDGET_CHARS, SYSTEM_SECTION_DELIMITER } from "../../../apps/app/src/app/roleplay/compose-system.ts";
import { ROLEPLAY_AGENT, ROLEPLAY_STATE_TOOL, toolMapGrantsOnly } from "../../../apps/app/src/app/roleplay/prompt-options.ts";

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
    const huge = "x".repeat(COMBINED_SYSTEM_BUDGET_CHARS - 40);
    const composed = composeSystem({ envContext: ENV_CONTEXT, characterPrompt: huge, directorText: "be brief" });

    expect(composed.dropped).toEqual(["envContext"]);
    expect(composed.system).not.toContain(ENV_CONTEXT);
    expect(composed.system).toContain("be brief");
    expect(composed.chars).toBeLessThanOrEqual(COMBINED_SYSTEM_BUDGET_CHARS);
  });

  test("a character prompt that alone exceeds the ceiling is truncated, not sent whole", () => {
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
  test("every roleplay turn pins the agent and carries exactly the scene-state tool", () => {
    const turn = buildRoleplayTurn({ card: card(), persona, envContext: ENV_CONTEXT });

    expect(turn.prompt.agent).toBe(ROLEPLAY_AGENT);
    expect(toolMapGrantsOnly(turn.prompt.tools, [ROLEPLAY_STATE_TOOL])).toBe(true);
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

  test("attaching skills injects text and grants no extra tool", () => {
    // "Attach a skill" reads like "the character can now use skills". It cannot:
    // this is context injection, and the `skill` tool stays denied. Adding
    // `skill: true` to the tool map as an obvious completion has to fail a test
    // rather than pass review — which is why this asserts the exact set rather
    // than a count, now that the turn legitimately carries one tool.
    const turn = buildRoleplayTurn({
      card: card(),
      persona,
      skills: [{ name: "slow-burn", scope: "project", body: "Let scenes breathe." }],
      envContext: ENV_CONTEXT,
    });

    expect(turn.prompt.system).toContain("Let scenes breathe.");
    expect(turn.prompt.agent).toBe(ROLEPLAY_AGENT);
    expect(toolMapGrantsOnly(turn.prompt.tools, [ROLEPLAY_STATE_TOOL])).toBe(true);
  });
});

describe("attached skills on a turn", () => {
  test("a skill switched off for this conversation leaves the prompt but stays attached", () => {
    const skills = [
      { name: "slow-burn", scope: "project" as const, body: "Let scenes breathe." },
      { name: "terse", scope: "project" as const, body: "Keep replies short." },
    ];
    const turn = buildRoleplayTurn({
      card: card(),
      persona,
      skills,
      settings: { disabledLorebookIds: [], disabledSkillNames: ["terse"], systemPrompt: "" },
      envContext: null,
    });

    expect(turn.prompt.system).toContain("Let scenes breathe.");
    expect(turn.prompt.system).not.toContain("Keep replies short.");
    expect(skills).toHaveLength(2);
  });

  test("everything dropped, truncated, unresolved, or shadowed reaches the turn", () => {
    const turn = buildRoleplayTurn({
      card: card(),
      persona,
      skills: [
        { name: "gone", scope: "project", body: "", status: "missing" },
        { name: "narration", scope: "global", body: "", status: "shadowed" },
        { name: "huge", scope: "project", body: "x".repeat(9_000) },
      ],
      envContext: null,
    });

    expect(turn.skills.unresolved).toEqual(["gone"]);
    expect(turn.skills.shadowed).toEqual(["narration"]);
    expect(turn.skills.truncated).toEqual(["huge"]);
  });
});

describe("the greeting", () => {
  test("the compiled prompt tells the model what it opened with", () => {
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
