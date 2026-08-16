import { describe, expect, test } from "vitest";

import { DEFAULT_SAFEWORD, MAX_SAFEWORD_CHARS } from "../../../packages/types/src/roleplay.ts";
import { containsSafeword, sendCarriesSafeword } from "../../../apps/app/src/app/roleplay/safeword.ts";
import { resolveSafeword, resolveSessionSettings } from "../../../apps/app/src/app/roleplay/session-settings.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";
import { toolMapGrantsAccess, toolMapGrantsOnly } from "../../../apps/app/src/app/roleplay/prompt-options.ts";
import { ROLEPLAY_STATE_TOOL } from "../../../packages/types/src/roleplay.ts";
import { DE_ESCALATION_INSTRUCTION } from "../../../apps/app/src/app/roleplay/compile-prompt.ts";

/**
 * The safeword is the one control here where a miss is not a bug.
 *
 * Every test below is a way someone actually types the word: mid-sentence, in
 * the wrong case, against punctuation, inside a quoted line, in an aside. A
 * detector that only fires on a message consisting solely of the safeword would
 * pass a naive spec and fail every real use.
 */

describe("a safeword is found wherever it is typed", () => {
  test("on its own, and that is the easy case", () => {
    expect(containsSafeword("!!stop", "!!stop")).toBe(true);
  });

  test("mid-sentence, which is how it is actually used", () => {
    expect(containsSafeword("wait no !!stop I don't want this", "!!stop")).toBe(true);
  });

  test("in any case", () => {
    expect(containsSafeword("RED", "red")).toBe(true);
    expect(containsSafeword("Red.", "red")).toBe(true);
  });

  test("against punctuation on either side", () => {
    for (const message of ["red.", "(red)", "red!", "—red—", "red,", "…red"]) {
      expect(containsSafeword(message, "red")).toBe(true);
    }
  });

  test("inside a quoted line, because a scene is mostly quoted lines", () => {
    expect(containsSafeword('"red," she says, stepping back.', "red")).toBe(true);
  });

  test("with no left boundary at all, when the word starts with punctuation", () => {
    // The app's default begins with `!`, so requiring a word boundary on the
    // left would miss it whenever it lands against the previous word.
    expect(containsSafeword("no wait!!stop", "!!stop")).toBe(true);
  });

  test("not as a fragment of a longer word", () => {
    // The one place the rule is allowed to be strict: a safeword of "red" firing
    // on "bored" or "credential" would stop scenes constantly and teach the user
    // to distrust the control.
    expect(containsSafeword("she looked bored", "red")).toBe(false);
    expect(containsSafeword("credentials", "red")).toBe(false);
    expect(containsSafeword("redress", "red")).toBe(false);
  });

  test("a safeword with regex characters is matched literally", () => {
    expect(containsSafeword("stop (now)", "(now)")).toBe(true);
    expect(containsSafeword("stop anow", "(now)")).toBe(false);
  });

  test("an empty safeword matches nothing rather than everything", () => {
    // A `new RegExp("")` matches every string. Without this guard a session that
    // somehow reached an empty safeword would de-escalate on its next message,
    // permanently, with no way to see why.
    expect(containsSafeword("an ordinary message", "")).toBe(false);
    expect(containsSafeword("an ordinary message", "   ")).toBe(false);
  });
});

describe("both halves of a composed message are checked", () => {
  test("the message text", () => {
    expect(sendCarriesSafeword({ text: "!!stop", directorText: "" }, "!!stop")).toBe(true);
  });

  test("the out-of-character aside, which the composer has already split out", () => {
    // By the time a send has a draft, the block parser has moved anything the
    // user wrote as an aside into its own field. A safeword typed there is still
    // a safeword, and it is a very likely place to type one.
    expect(sendCarriesSafeword({ text: "she steps closer", directorText: "!!stop" }, "!!stop")).toBe(true);
  });

  test("neither, when the word is absent", () => {
    expect(sendCarriesSafeword({ text: "she steps closer", directorText: "slower" }, "!!stop")).toBe(false);
  });
});

describe("resolving the safeword", () => {
  test("an unset word is the app's, never none", () => {
    expect(resolveSafeword(undefined)).toBe(DEFAULT_SAFEWORD);
    expect(resolveSafeword("")).toBe(DEFAULT_SAFEWORD);
    expect(resolveSafeword("   ")).toBe(DEFAULT_SAFEWORD);
  });

  test("the app's default is not a word that occurs in prose", () => {
    // The whole detector fires on prose, so a default of "red" or "stop" would
    // end scenes nobody asked to end — the failure that teaches a user to stop
    // trusting this.
    expect(containsSafeword("she stopped, red-faced, and said no more", DEFAULT_SAFEWORD)).toBe(false);
  });

  test("a chosen word is trimmed and capped", () => {
    expect(resolveSafeword("  pineapple  ")).toBe("pineapple");
    expect(resolveSafeword("x".repeat(MAX_SAFEWORD_CHARS + 40))).toHaveLength(MAX_SAFEWORD_CHARS);
  });
});

describe("what a de-escalated turn puts on the wire", () => {
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
  const sceneState = {
    records: [{ id: "sr_1", type: "clothes", name: "silk blouse", state: "worn", description: "" }],
    revision: 3,
    updatedAt: 1,
  };

  test("an ordinary turn carries the scene and the one tool", () => {
    const turn = buildRoleplayTurn({ card, persona, sceneState, nsfw: true, envContext: null });

    expect(turn.composed.system).toContain("# Scene State");
    expect(toolMapGrantsOnly(turn.prompt.tools, [ROLEPLAY_STATE_TOOL])).toBe(true);
  });

  test("a de-escalated turn carries no tools at all", () => {
    // The instruction asks the model to stop. This is what stops it whatever it
    // decides about the instruction — the same narrowing `prompt-options.ts` was
    // built to allow, and the reason the freeze is stored rather than per-send.
    const turn = buildRoleplayTurn({
      card,
      persona,
      sceneState,
      nsfw: true,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", deEscalated: true },
      envContext: null,
    });

    expect(toolMapGrantsAccess(turn.prompt.tools)).toBe(false);
  });

  test("a de-escalated turn replaces the scene rather than adding to it", () => {
    const turn = buildRoleplayTurn({
      card,
      persona,
      sceneState,
      nsfw: true,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", intensity: 3, deEscalated: true },
      envContext: null,
    });

    expect(turn.composed.system).toContain(DE_ESCALATION_INSTRUCTION);
    // Both scene sections go. Leaving the state in would have the model reading
    // an inventory of the scene it was just told to stop, and leaving the
    // intensity line in would have it reading how explicit to be at the same time.
    expect(turn.composed.system).not.toContain("# Scene State");
    expect(turn.composed.system).not.toContain("# Scene Direction");
    expect(turn.composed.system).not.toContain("silk blouse");
  });

  test("the diagnostics report the scene as costing nothing while it is paused", () => {
    const turn = buildRoleplayTurn({
      card,
      persona,
      sceneState,
      nsfw: true,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", deEscalated: true },
      envContext: null,
    });

    expect(turn.sceneState).toEqual({ chars: 0, recordCount: 0 });
  });

  test("the freeze is a stored setting, so the send after it is frozen too", () => {
    // The point of the whole design. `deEscalated` is read from the session's
    // settings on every turn, so nothing has to remember that a safeword was
    // used one message ago — and a model that ignored the instruction cannot
    // regain the tool by simply being asked again.
    const settings = { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", deEscalated: true };

    expect(resolveSessionSettings(settings).deEscalated).toBe(true);
    for (const message of ["are you okay?", "let's talk about something else"]) {
      const turn = buildRoleplayTurn({ card, persona, sceneState, nsfw: true, settings, directorText: message, envContext: null });
      expect(toolMapGrantsAccess(turn.prompt.tools)).toBe(false);
      expect(turn.composed.system).toContain(DE_ESCALATION_INSTRUCTION);
    }
  });

  test("clearing the flag restores the scene and the tool", () => {
    const turn = buildRoleplayTurn({
      card,
      persona,
      sceneState,
      nsfw: true,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "", deEscalated: false },
      envContext: null,
    });

    expect(turn.composed.system).toContain("# Scene State");
    expect(toolMapGrantsOnly(turn.prompt.tools, [ROLEPLAY_STATE_TOOL])).toBe(true);
  });
});
