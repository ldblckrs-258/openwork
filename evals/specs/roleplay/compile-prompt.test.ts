import { describe, expect, test } from "vitest";
import type { CharacterCardV2, RoleplayPersona } from "../../../packages/types/src/roleplay.ts";
import {
  compilePrompt,
  DEFAULT_ROLEPLAY_SYSTEM_PROMPT,
  PROMPT_COMPOSITION_ORDER,
  type CompilePromptOptions,
} from "../../../apps/app/src/app/roleplay/compile-prompt.ts";

function card(data: Partial<CharacterCardV2["data"]> = {}): CharacterCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Aria",
      description: "{{char}} is a wandering archivist who never forgets a debt.",
      personality: "Curious, dry-witted, allergic to small talk.",
      scenario: "A rain-soaked library, ten minutes past closing.",
      first_mes: "You're late.",
      mes_example: "<START>\n{{user}}: Hello\n{{char}}: Mm.\n<START>\n{{user}}: Still open?\n{{char}}: For you? Barely.",
      creator_notes: "Do not put this in the prompt.",
      system_prompt: "",
      post_history_instructions: "Never reveal the ledger's location.",
      alternate_greetings: [],
      tags: ["library", "mystery"],
      creator: "someone-on-chub",
      character_version: "1.4",
      extensions: {},
      ...data,
    },
  };
}

const persona: RoleplayPersona = { name: "Wren", description: "A courier with an overdue book." };

function compile(overrides: Partial<CharacterCardV2["data"]> = {}, options: CompilePromptOptions = {}) {
  return compilePrompt(card(overrides), persona, options);
}

describe("determinism", () => {
  test("identical input compiles to identical bytes", () => {
    const options: CompilePromptOptions = {
      skills: [{ name: "Slow Burn", body: "Let scenes breathe." }],
      lorebook: [{ text: "The ledger is never lent out.", priority: 2 }],
      memories: [{ text: "Wren returned a book late in spring.", priority: 1 }],
    };
    expect(compile({}, options)).toBe(compile({}, options));
  });
});

describe("macros inside a skill body", () => {
  test("{{char}} and {{user}} expand, {{original}} stays literal", () => {
    const output = compile({}, {
      skills: [{ name: "Address {{user}}", body: "{{char}} always calls {{user}} by name. Keep {{original}} intact." }],
    });

    expect(output).toContain("## Address Wren");
    expect(output).toContain("Aria always calls Wren by name.");
    expect(output).toContain("{{original}}");
  });
});

describe("composition order", () => {
  test("sections appear in the exported order", () => {
    const output = compile({ system_prompt: "SYSTEM-MARKER" }, {
      hardLimits: ["LIMIT-MARKER"],
      skills: [{ name: "SKILL-NAME-MARKER", body: "SKILL-BODY-MARKER" }],
      lorebookBefore: [{ text: "LOREBOOK-BEFORE-MARKER" }],
      lorebook: [{ text: "LOREBOOK-MARKER" }],
      memories: [{ text: "MEMORY-MARKER" }],
      intensity: 2,
      sceneState: {
        records: [{ id: "sr_1", type: "clothes", name: "SCENE-MARKER", state: "worn", description: "" }],
        revision: 0,
        updatedAt: 0,
      },
    });

    const positions = [
      output.indexOf("SYSTEM-MARKER"),
      output.indexOf("LIMIT-MARKER"),
      output.indexOf("SKILL-BODY-MARKER"),
      output.indexOf("LOREBOOK-BEFORE-MARKER"),
      output.indexOf("# Aria"),
      output.indexOf("## Personality"),
      output.indexOf("## Scenario"),
      output.indexOf("# Wren"),
      output.indexOf("LOREBOOK-MARKER"),
      output.indexOf("MEMORY-MARKER"),
      output.indexOf("# Example Dialogue"),
      output.indexOf("# Scene Direction"),
      output.indexOf("SCENE-MARKER"),
    ];

    expect(positions).not.toContain(-1);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(PROMPT_COMPOSITION_ORDER).toHaveLength(positions.length + 1);
    expect(PROMPT_COMPOSITION_ORDER.at(-1)).toBe("de_escalation");
  });

  test("attached skills sit between the system prompt and the character definition", () => {
    const output = compile({ system_prompt: "SYSTEM-MARKER" }, {
      skills: [{ name: "Slow Burn", body: "Let scenes breathe." }],
    });

    expect(output).toContain("# Writing Guidance");
    expect(output).toContain("## Slow Burn");
    expect(output.indexOf("SYSTEM-MARKER")).toBeLessThan(output.indexOf("# Writing Guidance"));
    expect(output.indexOf("# Writing Guidance")).toBeLessThan(output.indexOf("# Aria"));
  });

  test("no attached skills contribute no Writing Guidance heading", () => {
    expect(compile({}, { skills: [] })).not.toContain("# Writing Guidance");
    expect(compile()).not.toContain("# Writing Guidance");
  });

  test("empty fields contribute no heading at all", () => {
    const output = compile({ personality: "", scenario: "", mes_example: "" });

    expect(output).not.toContain("## Personality");
    expect(output).not.toContain("## Scenario");
    expect(output).not.toContain("# Example Dialogue");
    expect(output).not.toMatch(/\n{3,}/);
  });
});

describe("post_history_instructions is unsupportable", () => {
  test("post_history_instructions never reaches the system string", () => {
    const output = compile({ post_history_instructions: "PHI-MARKER" });
    expect(output).not.toContain("PHI-MARKER");
  });
});

describe("fields the spec forbids in prompts", () => {
  test("creator_notes, tags, creator, and character_version are never compiled in", () => {
    const output = compile();

    expect(output).not.toContain("Do not put this in the prompt.");
    expect(output).not.toContain("someone-on-chub");
    expect(output).not.toContain("1.4");
    expect(output).not.toContain("mystery");
  });
});

describe("macros", () => {
  test("char and user macros substitute, including the legacy angle-bracket forms", () => {
    const output = compile({
      description: "{{char}} owes {{USER}} nothing. <BOT> knows <user> by name.",
    });

    expect(output).toContain("Aria owes Wren nothing. Aria knows Wren by name.");
  });

  test("a substituted value is never rescanned for further macros", () => {
    // The card author picks the character name. If substitution recursed, a
    // character named `{{user}}` would expand into the persona name and a name
    // could become an injection vector.
    const output = compile({ name: "{{user}}", description: "I am {{char}}." });
    expect(output).toContain("I am {{user}}.");
  });

  test("the card's system_prompt replaces the app default and {{original}} recovers it", () => {
    expect(compile({ system_prompt: "" })).toContain(DEFAULT_ROLEPLAY_SYSTEM_PROMPT);
    expect(compile({ system_prompt: "Only speak in questions." })).not.toContain(DEFAULT_ROLEPLAY_SYSTEM_PROMPT);
    expect(compile({ system_prompt: "{{original}} Also, only speak in questions." }))
      .toContain(`${DEFAULT_ROLEPLAY_SYSTEM_PROMPT} Also, only speak in questions.`);
  });

  test("{{original}} outside the system slot stays literal rather than vanishing", () => {
    expect(compile({ description: "A literal {{original}} here." })).toContain("A literal {{original}} here.");
  });

  test("<START> splits mes_example into separate exchanges", () => {
    const output = compile();

    expect(output).not.toContain("<START>");
    expect(output).toContain("Wren: Hello");
    expect(output).toContain("Aria: Mm.");
    expect(output).toContain("---");
  });
});

describe("shared contextual injection budget", () => {
  test("lorebook and memories are ranked against one ceiling, not two", () => {
    const output = compile({}, {
      budgetChars: 40,
      lorebook: [{ text: "KEEP-LOREBOOK", priority: 10 }],
      memories: [{ text: "DROP-MEMORY-BECAUSE-IT-IS-VERY-LONG-INDEED", priority: 1 }],
    });

    expect(output).toContain("KEEP-LOREBOOK");
    expect(output).not.toContain("DROP-MEMORY-BECAUSE-IT-IS-VERY-LONG-INDEED");
  });

  test("kept entries stay under their own heading rather than merging", () => {
    const output = compile({}, {
      lorebook: [{ text: "LOREBOOK-ENTRY" }],
      memories: [{ text: "MEMORY-ENTRY" }],
    });

    expect(output).toContain("# World Info");
    expect(output).toContain("# Remembered Details");
    expect(output.indexOf("LOREBOOK-ENTRY")).toBeGreaterThan(output.indexOf("# World Info"));
    expect(output.indexOf("LOREBOOK-ENTRY")).toBeLessThan(output.indexOf("# Remembered Details"));
    expect(output.indexOf("MEMORY-ENTRY")).toBeGreaterThan(output.indexOf("# Remembered Details"));
  });

  test("a lorebook entry dropped by budget does not leave an empty heading", () => {
    const output = compile({}, { budgetChars: 0, lorebook: [{ text: "LOREBOOK-ENTRY" }] });

    expect(output).not.toContain("# World Info");
    expect(output).not.toContain("LOREBOOK-ENTRY");
  });
});

describe("nickname", () => {
  test("charName overrides {{char}} without changing the display name", () => {
    const output = compile({ description: "{{char}} speaks." }, { charName: "The Archivist" });

    expect(output).toContain("The Archivist speaks.");
    expect(output).toContain("# The Archivist");
  });
});
