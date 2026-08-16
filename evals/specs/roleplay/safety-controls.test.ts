import { describe, expect, test } from "vitest";

import {
  MAX_HARD_LIMITS,
  MAX_SCENE_INTENSITY,
  MIN_SCENE_INTENSITY,
  SCENE_INTENSITY_LEVELS,
  normalizeHardLimits,
  type RoleplayCharacterRecord,
} from "../../../packages/types/src/roleplay.ts";
import {
  DEFAULT_SCENE_INTENSITY,
  resolveSessionSettings,
} from "../../../apps/app/src/app/roleplay/session-settings.ts";
import {
  HARD_LIMITS_FRAMING,
  PROMPT_COMPOSITION_ORDER,
  SCENE_INTENSITY_INSTRUCTIONS,
  compilePrompt,
} from "../../../apps/app/src/app/roleplay/compile-prompt.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";
import {
  hiddenCharacterCount,
  resolveSafeMode,
  visibleCharacters,
  workspaceHasAdultCharacter,
} from "../../../apps/app/src/app/roleplay/safe-mode.ts";

const card = {
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
};
const persona = { name: "Wren", description: "A courier." };

describe("the intensity dial", () => {
  test("an untouched dial resolves to the app's default, not to zero", () => {
    expect(resolveSessionSettings(undefined).intensity).toBe(DEFAULT_SCENE_INTENSITY);
    expect(resolveSessionSettings({ disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" }).intensity).toBe(
      DEFAULT_SCENE_INTENSITY,
    );
  });

  test("the default is not the top of the range", () => {
    expect(DEFAULT_SCENE_INTENSITY).toBeLessThan(MAX_SCENE_INTENSITY);
  });

  test("out-of-range values clamp to the ends rather than failing a send", () => {
    const at = (intensity: number) =>
      resolveSessionSettings({ disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", intensity }).intensity;

    expect(at(-4)).toBe(MIN_SCENE_INTENSITY);
    expect(at(99)).toBe(MAX_SCENE_INTENSITY);
    expect(at(1.6)).toBe(2);
    expect(at(Number.NaN)).toBe(DEFAULT_SCENE_INTENSITY);
  });

  test("every level has an instruction, and the arrays cannot drift apart", () => {
    expect(SCENE_INTENSITY_INSTRUCTIONS).toHaveLength(SCENE_INTENSITY_LEVELS.length);
    for (const instruction of SCENE_INTENSITY_INSTRUCTIONS) expect(instruction.trim()).not.toBe("");
  });

  test("the dial reaches the prompt for an adult character", () => {
    const turn = buildRoleplayTurn({
      card,
      persona,
      nsfw: true,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", intensity: 3 },
      envContext: null,
    });

    expect(turn.composed.system).toContain("# Scene Direction");
    expect(turn.composed.system).toContain(SCENE_INTENSITY_INSTRUCTIONS[3]);
  });

  test("and stays out of an ordinary character's prompt entirely", () => {
    const turn = buildRoleplayTurn({
      card,
      persona,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", intensity: 3 },
      envContext: null,
    });

    expect(turn.composed.system).not.toContain("# Scene Direction");
    for (const instruction of SCENE_INTENSITY_INSTRUCTIONS) {
      expect(turn.composed.system).not.toContain(instruction);
    }
  });
});

describe("hard limits reach every prompt", () => {
  test("they are compiled with their framing, above the character", () => {
    const compiled = compilePrompt(card, persona, { hardLimits: ["no violence", "nothing involving blood"] });

    expect(compiled).toContain("# Hard Limits");
    expect(compiled).toContain(HARD_LIMITS_FRAMING);
    expect(compiled).toContain("- no violence");
    expect(compiled.indexOf("# Hard Limits")).toBeLessThan(compiled.indexOf(`# ${card.data.name}`));
  });

  test("the section sits second in the composition order, next to the instruction it outranks", () => {
    expect(PROMPT_COMPOSITION_ORDER[0]).toBe("system_prompt");
    expect(PROMPT_COMPOSITION_ORDER[1]).toBe("hard_limits");
  });

  test("a character with no limits gains no empty section", () => {
    expect(compilePrompt(card, persona, { hardLimits: [] })).not.toContain("# Hard Limits");
    expect(compilePrompt(card, persona, { hardLimits: ["   "] })).not.toContain("# Hard Limits");
  });

  test("they survive a budget that evicts everything else", () => {
    // The property the whole design turns on. A limit dropped because the
    // lorebook grew is worse than no limit at all: the user believes it is in
    // force and nothing on screen says otherwise.
    const compiled = compilePrompt(card, persona, {
      hardLimits: ["no violence"],
      budgetChars: 0,
      memories: [{ text: "Wren once lied about the flood.", priority: 0 }],
      lorebook: [{ text: "The library sank in the second winter.", priority: 0 }],
    });

    expect(compiled).toContain("- no violence");
    expect(compiled).not.toContain("Wren once lied");
  });

  test("they are macro-expanded, so a limit can name the person it protects", () => {
    expect(compilePrompt(card, persona, { hardLimits: ["never harm {{user}}"] })).toContain("- never harm Wren");
  });

  test("a de-escalated turn keeps them, because they are not part of the scene", () => {
    const turn = buildRoleplayTurn({
      card,
      persona,
      nsfw: true,
      hardLimits: ["no violence"],
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", deEscalated: true },
      envContext: null,
    });

    expect(turn.composed.system).toContain("- no violence");
  });

  test("the editor's list and an imported card's list are bounded identically", () => {
    // Same function on both paths. A ceiling enforced only on import would let a
    // hand-typed list of 300 entries into the prompt that a card of 300 cannot
    // reach — and the prompt does not care which one wrote them.
    const typed = normalizeHardLimits(Array.from({ length: 200 }, (_unused, index) => `${index} no violence`));

    expect(typed).toHaveLength(MAX_HARD_LIMITS);
  });
});

describe("safe mode hides and never deletes", () => {
  const character = (id: string, nsfw: boolean, deletedAt?: number): RoleplayCharacterRecord =>
    ({ id, nsfw, deletedAt, card, hardLimits: [], sceneRecords: [] }) as unknown as RoleplayCharacterRecord;

  test("with no choice made, a workspace that has never enabled this is protected", () => {
    expect(resolveSafeMode(null, [character("a", false)])).toBe(true);
    expect(resolveSafeMode(null, [])).toBe(true);
  });

  test("with no choice made, a workspace already using it is not hidden by an upgrade", () => {
    expect(resolveSafeMode(null, [character("a", false), character("b", true)])).toBe(false);
  });

  test("a deleted adult character does not count as enabling anything", () => {
    expect(workspaceHasAdultCharacter([character("a", true, 1_700_000_000)])).toBe(false);
    expect(resolveSafeMode(null, [character("a", true, 1_700_000_000)])).toBe(true);
  });

  test("an explicit choice wins in both directions", () => {
    expect(resolveSafeMode(true, [character("a", true)])).toBe(true);
    expect(resolveSafeMode(false, [character("a", false)])).toBe(false);
  });

  test("filtering hides adult characters and reports how many", () => {
    const all = [character("a", false), character("b", true), character("c", true)];

    expect(visibleCharacters(all, true).map((entry) => entry.id)).toEqual(["a"]);
    expect(hiddenCharacterCount(all, true)).toBe(2);
    expect(visibleCharacters(all, false)).toHaveLength(3);
    expect(hiddenCharacterCount(all, false)).toBe(0);
  });

  test("the records themselves are untouched by the filter", () => {
    const adult = character("b", true);
    visibleCharacters([adult], true);

    expect(adult.nsfw).toBe(true);
  });
});
