import { describe, expect, test } from "vitest";
import {
  characterCardV2Schema,
  roleplaySessionBindingSchema,
  type RoleplayLorebookRecord,
  type RoleplayMemoryRecord,
} from "../../../packages/types/src/roleplay.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";
import {
  activeLorebooks,
  MAX_SESSION_SYSTEM_PROMPT_CHARS,
  MAX_SOURCE_BUDGET_CHARS,
  resolveSessionSettings,
} from "../../../apps/app/src/app/roleplay/session-settings.ts";
import { LOREBOOK_BUDGET_CHARS } from "../../../apps/app/src/app/roleplay/lorebook.ts";
import { MEMORY_BUDGET_CHARS } from "../../../apps/app/src/app/roleplay/memory.ts";

const CARD = characterCardV2Schema.parse({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "The archivist of a drowned library.",
    first_mes: "You're late.",
  },
});

const PERSONA = { name: "Wren", description: "A courier." };

function book(id: string, overrides: Partial<RoleplayLorebookRecord> = {}): RoleplayLorebookRecord {
  return {
    id,
    name: `Book ${id}`,
    description: "",
    entries: [],
    characterIds: ["chr_1"],
    source: "authored",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function entry(uid: string, keys: string[], content: string) {
  return { uid, keys, content, extensions: {}, enabled: true, insertion_order: 0 };
}

function memory(id: string, text: string): RoleplayMemoryRecord {
  return { id, characterId: "chr_1", text, source: "user", createdAt: 1, updatedAt: 1 };
}

describe("resolving a conversation's settings", () => {
  test("an untouched setting resolves to the app's default rather than a stored copy", () => {
    const resolved = resolveSessionSettings({ disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" });

    expect(resolved.memoryBudgetChars).toBe(MEMORY_BUDGET_CHARS);
    expect(resolved.lorebookBudgetChars).toBe(LOREBOOK_BUDGET_CHARS);
    expect(resolved.scanDepth).toBeUndefined();
    expect(resolved.colorSegments).toBe(true);
  });

  test("a budget outside the range snaps to the edge instead of failing a send", () => {
    const high = resolveSessionSettings({
      memoryBudgetChars: MAX_SOURCE_BUDGET_CHARS + 50_000,
      disabledLorebookIds: [],
      disabledSkillNames: [],
      systemPrompt: "",
    });
    const low = resolveSessionSettings({
      lorebookBudgetChars: -1,
      disabledLorebookIds: [],
      disabledSkillNames: [],
      systemPrompt: "",
    });

    expect(high.memoryBudgetChars).toBe(MAX_SOURCE_BUDGET_CHARS);
    expect(low.lorebookBudgetChars).toBe(0);
  });

  test("an over-long system prompt is cut rather than allowed to crowd the card", () => {
    const resolved = resolveSessionSettings({
      systemPrompt: "x".repeat(MAX_SESSION_SYSTEM_PROMPT_CHARS + 500),
      disabledLorebookIds: [], disabledSkillNames: [],
    });

    expect(resolved.systemPrompt.length).toBe(MAX_SESSION_SYSTEM_PROMPT_CHARS);
  });

  test("a binding stored before settings existed still parses", () => {
    const legacy = roleplaySessionBindingSchema.parse({
      sessionId: "ses_1",
      characterId: "chr_1",
      personaId: "per_1",
      storySoFar: "",
      greeting: "",
      boundAt: 1,
    });

    expect(legacy.settings.disabledLorebookIds).toEqual([]);
    expect(resolveSessionSettings(legacy.settings).colorSegments).toBe(true);
  });

  test("a book attached after the conversation started is live by default", () => {
    const books = [book("lore_1"), book("lore_2")];

    expect(activeLorebooks(books, ["lore_1"]).map((record) => record.id)).toEqual(["lore_2"]);
    expect(activeLorebooks(books, []).map((record) => record.id)).toEqual(["lore_1", "lore_2"]);
  });
});

describe("what the settings change about a turn", () => {
  test("a book switched off for this conversation is not scanned", () => {
    const books = [
      book("lore_1", { entries: [entry("a", ["harbour"], "HARBOUR-FACT")] }),
      book("lore_2", { entries: [entry("b", ["harbour"], "OTHER-FACT")] }),
    ];
    const turn = buildRoleplayTurn({
      card: CARD,
      persona: PERSONA,
      lorebooks: books,
      scanMessages: [{ role: "user", text: "meet me at the harbour" }],
      settings: { disabledLorebookIds: ["lore_1"], disabledSkillNames: [], systemPrompt: "" },
      envContext: null,
    });

    expect(turn.prompt.system).not.toContain("HARBOUR-FACT");
    expect(turn.prompt.system).toContain("OTHER-FACT");
    expect(turn.lorebook.trace.some((line) => line.bookId === "lore_1")).toBe(false);
  });

  test("the scan depth override reaches entries the default depth would miss", () => {
    const books = [book("lore_1", { entries: [entry("a", ["harbour"], "HARBOUR-FACT")] })];
    const messages = [
      { role: "user" as const, text: "meet me at the harbour" },
      ...Array.from({ length: 8 }, (_, index) => ({ role: "assistant" as const, text: `filler ${index}` })),
    ];

    const shallow = buildRoleplayTurn({
      card: CARD,
      persona: PERSONA,
      lorebooks: books,
      scanMessages: messages,
      settings: { disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" },
      envContext: null,
    });
    const deep = buildRoleplayTurn({
      card: CARD,
      persona: PERSONA,
      lorebooks: books,
      scanMessages: messages,
      settings: { scanDepth: 20, disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" },
      envContext: null,
    });

    expect(shallow.prompt.system).not.toContain("HARBOUR-FACT");
    expect(deep.prompt.system).toContain("HARBOUR-FACT");
  });

  test("the two budgets no longer compete: a large memory allowance evicts no lore", () => {
    const books = [book("lore_1", { entries: [entry("a", ["harbour"], "HARBOUR-FACT")] })];
    const memories = Array.from({ length: 40 }, (_, index) =>
      memory(`mem_${index}`, `Remembered detail ${index} `.padEnd(300, "x")),
    );

    const turn = buildRoleplayTurn({
      card: CARD,
      persona: PERSONA,
      memories,
      lorebooks: books,
      scanMessages: [{ role: "user", text: "meet me at the harbour" }],
      settings: { memoryBudgetChars: 12_000, disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" },
      envContext: null,
    });

    expect(turn.prompt.system).toContain("HARBOUR-FACT");
    expect(turn.prompt.system).toContain("Remembered detail 0");
  });

  test("a tightened lorebook budget evicts, and says the budget did it", () => {
    const books = [
      book("lore_1", {
        entries: [entry("a", ["harbour"], "HARBOUR-FACT-".padEnd(400, "x"))],
      }),
    ];
    const turn = buildRoleplayTurn({
      card: CARD,
      persona: PERSONA,
      lorebooks: books,
      scanMessages: [{ role: "user", text: "meet me at the harbour" }],
      settings: { lorebookBudgetChars: 10, disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" },
      envContext: null,
    });

    expect(turn.prompt.system).not.toContain("HARBOUR-FACT");
    expect(turn.lorebook.trace.find((line) => line.uid === "a")?.reason).toBe("budget");
  });

  test("the session's system prompt replaces the card's, and can keep the app's", () => {
    const carded = characterCardV2Schema.parse({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Aria", description: "The archivist.", system_prompt: "CARD-INSTRUCTION" },
    });

    const overridden = buildRoleplayTurn({
      card: carded,
      persona: PERSONA,
      settings: { systemPrompt: "SESSION-INSTRUCTION", disabledLorebookIds: [], disabledSkillNames: [] },
      envContext: null,
    });
    const kept = buildRoleplayTurn({
      card: carded,
      persona: PERSONA,
      settings: { systemPrompt: "", disabledLorebookIds: [], disabledSkillNames: [] },
      envContext: null,
    });
    const withOriginal = buildRoleplayTurn({
      card: carded,
      persona: PERSONA,
      settings: { systemPrompt: "{{original}} Also stay terse.", disabledLorebookIds: [], disabledSkillNames: [] },
      envContext: null,
    });

    expect(overridden.prompt.system).toContain("SESSION-INSTRUCTION");
    expect(overridden.prompt.system).not.toContain("CARD-INSTRUCTION");
    expect(kept.prompt.system).toContain("CARD-INSTRUCTION");
    expect(withOriginal.prompt.system).toContain("Stay in character at all times.");
    expect(withOriginal.prompt.system).toContain("Also stay terse.");
  });

  test("the turn stays a pure function of its settings, which is what a regenerate replays", () => {
    const input = {
      card: CARD,
      persona: PERSONA,
      lorebooks: [book("lore_1", { entries: [entry("a", ["harbour"], "HARBOUR-FACT")] })],
      scanMessages: [{ role: "user" as const, text: "meet me at the harbour" }],
      settings: { lorebookBudgetChars: 2_000, disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" },
      envContext: null,
    };

    expect(buildRoleplayTurn(input).prompt.system).toBe(buildRoleplayTurn(input).prompt.system);
  });
});
