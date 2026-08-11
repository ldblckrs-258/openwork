import { describe, expect, test } from "vitest";
import type { RoleplayLorebookEntry, RoleplayLorebookRecord } from "../../../packages/types/src/roleplay.ts";
import { characterCardV2Schema, roleplayLorebookRecordSchema } from "../../../packages/types/src/roleplay.ts";
import {
  CHARS_PER_TOKEN,
  LOREBOOK_BUDGET_CHARS,
  MAX_RECURSION_ROUNDS,
  lorebooksForCharacter,
  selectLorebookEntries,
  toScanMessages,
  type LorebookScanMessage,
} from "../../../apps/app/src/app/roleplay/lorebook.ts";
import { CONTEXTUAL_INJECTION_BUDGET_CHARS } from "../../../apps/app/src/app/roleplay/injection-budget.ts";
import { MEMORY_BUDGET_CHARS } from "../../../apps/app/src/app/roleplay/memory.ts";
import { compilePrompt } from "../../../apps/app/src/app/roleplay/compile-prompt.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";

let nextUid = 0;

function entry(overrides: Partial<RoleplayLorebookEntry> = {}): RoleplayLorebookEntry {
  nextUid += 1;
  return {
    uid: `lbe_${nextUid}`,
    keys: [],
    content: "",
    extensions: {},
    enabled: true,
    insertion_order: 0,
    ...overrides,
  };
}

function book(overrides: Partial<RoleplayLorebookRecord> = {}): RoleplayLorebookRecord {
  return {
    id: "lore_1",
    name: "Ashfell",
    description: "",
    entries: [],
    characterIds: [],
    source: "authored",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function said(text: string, role: "user" | "assistant" = "user"): LorebookScanMessage {
  return { role, text };
}

const CARD = characterCardV2Schema.parse({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: { name: "Aria", description: "The archivist.", first_mes: "You're late." },
});
const PERSONA = { name: "Wren", description: "A courier." };

describe("key matching", () => {
  test("an entry keyed on a term injects only when that term appears", () => {
    const books = [
      book({
        entries: [entry({ keys: ["harbour"], content: "The harbour freezes in winter." })],
      }),
    ];

    const miss = selectLorebookEntries(books, [said("Tell me about the mountains.")]);
    const hit = selectLorebookEntries(books, [said("I walked down to the harbour.")]);

    expect(miss.matches).toHaveLength(0);
    expect(hit.matches.map((match) => match.text)).toEqual(["The harbour freezes in winter."]);
  });

  test("matching ignores case unless the entry asks for it", () => {
    const insensitive = book({ entries: [entry({ keys: ["Harbour"], content: "loose" })] });
    const sensitive = book({
      id: "lore_2",
      entries: [entry({ keys: ["Harbour"], content: "strict", case_sensitive: true })],
    });

    const messages = [said("down at the harbour")];

    expect(selectLorebookEntries([insensitive], messages).matches).toHaveLength(1);
    expect(selectLorebookEntries([sensitive], messages).matches).toHaveLength(0);
  });

  test("a regex key matches as a pattern, and a broken one falls back to a literal", () => {
    // Falling back rather than dropping is deliberate: an entry that silently
    // stops firing is the failure the trace exists to make visible.
    const books = [
      book({
        entries: [
          entry({ keys: ["ash(fell|ford)"], content: "pattern", use_regex: true }),
          entry({ keys: ["(unclosed"], content: "broken", use_regex: true }),
        ],
      }),
    ];

    const matched = selectLorebookEntries(books, [said("we rode to ashford at dawn")]);
    const literal = selectLorebookEntries(books, [said("she typed (unclosed by mistake")]);

    expect(matched.matches.map((match) => match.text)).toEqual(["pattern"]);
    expect(literal.matches.map((match) => match.text)).toEqual(["broken"]);
  });

  test("both sides of the conversation are scanned", () => {
    // A place the character itself introduced is exactly what a lorebook entry
    // exists to expand on.
    const books = [book({ entries: [entry({ keys: ["Ashfell"], content: "A mining town." })] })];

    const selection = selectLorebookEntries(books, [said("Where are we?"), said("Ashfell, and it's cold.", "assistant")]);

    expect(selection.matches).toHaveLength(1);
  });

  test("only the most recent messages are scanned", () => {
    const books = [book({ scanDepth: 2, entries: [entry({ keys: ["harbour"], content: "lore" })] })];
    const messages = [said("the harbour"), said("a"), said("b"), said("c")];

    expect(selectLorebookEntries(books, messages).matches).toHaveLength(0);
    expect(selectLorebookEntries(books, messages, { scanDepth: 4 }).matches).toHaveLength(1);
  });
});

describe("activation rules", () => {
  test("constant entries always inject", () => {
    const books = [book({ entries: [entry({ keys: ["never-said"], content: "always", constant: true })] })];

    const selection = selectLorebookEntries(books, [said("nothing relevant")]);

    expect(selection.matches.map((match) => match.reason)).toEqual(["constant"]);
  });

  test("a disabled entry never injects, and says so in the trace", () => {
    const books = [book({ entries: [entry({ keys: ["harbour"], content: "lore", enabled: false })] })];

    const selection = selectLorebookEntries(books, [said("the harbour")]);

    expect(selection.matches).toHaveLength(0);
    expect(selection.trace[0]).toMatchObject({ included: false, reason: "disabled" });
  });

  test("a selective entry needs a key from both lists", () => {
    const books = [
      book({
        entries: [
          entry({
            keys: ["harbour"],
            secondary_keys: ["storm"],
            selective: true,
            content: "The harbour closes in a storm.",
          }),
        ],
      }),
    ];

    const primaryOnly = selectLorebookEntries(books, [said("down at the harbour")]);
    const both = selectLorebookEntries(books, [said("down at the harbour in a storm")]);

    expect(primaryOnly.matches).toHaveLength(0);
    expect(primaryOnly.trace[0]).toMatchObject({ included: false, reason: "selective_unmet" });
    expect(both.matches).toHaveLength(1);
  });

  test("an empty entry is never injected", () => {
    const books = [book({ entries: [entry({ keys: ["harbour"], content: "   " })] })];

    expect(selectLorebookEntries(books, [said("the harbour")]).trace[0]).toMatchObject({ reason: "empty" });
  });
});

describe("recursive scanning", () => {
  test("an injected entry can trigger another when the book allows it", () => {
    const entries = [
      entry({ keys: ["harbour"], content: "The harbour is watched by the Wardens." }),
      entry({ keys: ["Wardens"], content: "The Wardens answer to nobody." }),
    ];

    const off = selectLorebookEntries([book({ entries })], [said("the harbour")]);
    const on = selectLorebookEntries([book({ recursiveScanning: true, entries })], [said("the harbour")]);

    expect(off.matches).toHaveLength(1);
    expect(on.matches).toHaveLength(2);
    expect(on.matches[1]?.reason).toBe("recursive");
  });

  test("a constant entry can trigger a keyed one recursively", () => {
    const books = [
      book({
        recursiveScanning: true,
        entries: [
          entry({ content: "The Wardens hold the pass.", constant: true }),
          entry({ keys: ["Wardens"], content: "They answer to nobody." }),
        ],
      }),
    ];

    expect(selectLorebookEntries(books, [said("nothing relevant")]).matches).toHaveLength(2);
  });

  test("a self-referential book terminates at the round cap", () => {
    // Two entries that name each other activate forever by construction. The cap
    // is what makes this return at all; the budget would not, since a cycle of
    // small entries never fills it.
    const chain = Array.from({ length: 10 }, (_, index) =>
      entry({ keys: [`link${index}`], content: `mentions link${index + 1}` }),
    );
    const books = [book({ recursiveScanning: true, entries: chain })];

    const selection = selectLorebookEntries(books, [said("link0")]);

    expect(selection.matches.length).toBe(MAX_RECURSION_ROUNDS + 1);
  });
});

describe("ordering and placement", () => {
  test("entries are ordered by insertion_order, lowest first", () => {
    const books = [
      book({
        entries: [
          entry({ keys: ["a"], content: "third", insertion_order: 30 }),
          entry({ keys: ["a"], content: "first", insertion_order: 10 }),
          entry({ keys: ["a"], content: "second", insertion_order: 20 }),
        ],
      }),
    ];

    expect(selectLorebookEntries(books, [said("a")]).matches.map((match) => match.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("position splits entries either side of the character definition", () => {
    const books = [
      book({
        entries: [
          entry({ keys: ["a"], content: "ahead", position: "before_char" }),
          entry({ keys: ["a"], content: "behind", position: "after_char" }),
          entry({ keys: ["a"], content: "unset" }),
        ],
      }),
    ];

    const selection = selectLorebookEntries(books, [said("a")]);

    expect(selection.before.map((injection) => injection.text)).toEqual(["ahead"]);
    // An unset position is the spec's default, which is after the definition.
    expect(selection.after.map((injection) => injection.text)).toEqual(["behind", "unset"]);
  });

  test("a before_char entry compiles ahead of the description", () => {
    const compiled = compilePrompt(CARD, PERSONA, {
      lorebookBefore: [{ text: "AHEAD" }],
      lorebook: [{ text: "BEHIND" }],
    });

    expect(compiled.indexOf("AHEAD")).toBeLessThan(compiled.indexOf("The archivist."));
    expect(compiled.indexOf("BEHIND")).toBeGreaterThan(compiled.indexOf("The archivist."));
  });
});

describe("budget", () => {
  test("the budget is never exceeded however many entries match", () => {
    const entries = Array.from({ length: 200 }, (_, index) =>
      entry({ keys: ["a"], content: `${index}`.padEnd(500, "x") }),
    );

    const selection = selectLorebookEntries([book({ entries })], [said("a")]);

    expect(selection.charsUsed).toBeLessThanOrEqual(LOREBOOK_BUDGET_CHARS);
    expect(selection.dropped).toBeGreaterThan(0);
  });

  test("eviction discards the lowest priority first, per the spec", () => {
    const entries = [
      entry({ keys: ["a"], content: "L".repeat(600), priority: 1, insertion_order: 1 }),
      entry({ keys: ["a"], content: "H".repeat(600), priority: 9, insertion_order: 2 }),
    ];

    const selection = selectLorebookEntries([book({ entries })], [said("a")], { budgetChars: 700 });

    expect(selection.matches.map((match) => match.text[0])).toEqual(["H"]);
    expect(selection.trace.find((line) => line.reason === "budget")).toBeDefined();
  });

  test("a book's own token budget lowers its share but cannot raise it", () => {
    const small = book({ tokenBudget: 100, entries: [entry({ keys: ["a"], content: "x".repeat(600) })] });
    const greedy = book({
      id: "lore_2",
      tokenBudget: 1_000_000,
      entries: [entry({ keys: ["a"], content: "y".repeat(600) })],
    });

    // 100 tokens is 400 characters here, so the 600-character entry does not fit.
    expect(selectLorebookEntries([small], [said("a")]).matches).toHaveLength(0);
    expect(100 * CHARS_PER_TOKEN).toBeLessThan(600);
    expect(selectLorebookEntries([greedy], [said("a")], { budgetChars: 100 }).matches).toHaveLength(0);
  });

  test("lorebook and memory together respect the shared ceiling", () => {
    // Two individually reasonable budgets that sum past the ceiling would leave
    // no room for the character, which is why they are ranked together.
    expect(LOREBOOK_BUDGET_CHARS + MEMORY_BUDGET_CHARS).toBeLessThanOrEqual(CONTEXTUAL_INJECTION_BUDGET_CHARS);

    const compiled = compilePrompt(CARD, PERSONA, {
      lorebook: Array.from({ length: 20 }, () => ({ text: "L".repeat(500), priority: 2 })),
      memories: Array.from({ length: 20 }, () => ({ text: "M".repeat(500), priority: 1 })),
    });

    const injected = (compiled.match(/[LM]{500}/g) ?? []).join("").length;
    expect(injected).toBeLessThanOrEqual(CONTEXTUAL_INJECTION_BUDGET_CHARS);
  });

  test("constant entries outrank memories for the shared ceiling", () => {
    const selection = selectLorebookEntries(
      [book({ entries: [entry({ content: "world", constant: true }), entry({ keys: ["a"], content: "keyed" })] })],
      [said("a")],
    );

    const constant = selection.after.find((injection) => injection.text === "world");
    const keyed = selection.after.find((injection) => injection.text === "keyed");
    expect(constant?.priority).toBeGreaterThan(keyed?.priority ?? 0);
    // 1 is what a user-authored memory carries in `memory.ts`.
    expect(keyed?.priority).toBeGreaterThan(1);
  });
});

describe("trace", () => {
  test("every candidate is explained exactly once", () => {
    const books = [
      book({
        entries: [
          entry({ keys: ["a"], content: "hit" }),
          entry({ keys: ["zzz"], content: "miss" }),
          entry({ keys: ["a"], content: "off", enabled: false }),
          entry({ content: "always", constant: true }),
        ],
      }),
    ];

    const selection = selectLorebookEntries(books, [said("a")]);

    expect(selection.trace).toHaveLength(4);
    expect(new Set(selection.trace.map((line) => line.uid)).size).toBe(4);
    expect(selection.trace.filter((line) => line.included)).toHaveLength(2);
    expect(selection.trace.find((line) => line.reason === "key")?.matchedKey).toBe("a");
  });

  test("a selective match records which secondary key satisfied it", () => {
    const books = [
      book({
        entries: [entry({ keys: ["harbour"], secondary_keys: ["storm", "fog"], selective: true, content: "lore" })],
      }),
    ];

    const selection = selectLorebookEntries(books, [said("the harbour in fog")]);

    expect(selection.trace[0]).toMatchObject({ matchedKey: "harbour", matchedSecondaryKey: "fog" });
  });
});

describe("wiring", () => {
  test("a turn compiles the entries its own transcript triggered", () => {
    const books = [
      book({
        characterIds: ["chr_1"],
        entries: [entry({ keys: ["harbour"], content: "The harbour freezes in winter." })],
      }),
    ];

    const turn = buildRoleplayTurn({
      card: CARD,
      persona: PERSONA,
      lorebooks: books,
      scanMessages: [said("I walked down to the harbour.")],
      envContext: null,
    });

    expect(turn.composed.system).toContain("The harbour freezes in winter.");
    expect(turn.lorebook.matches).toHaveLength(1);
  });

  test("a book attached to another character is not injected", () => {
    const books = [book({ characterIds: ["chr_2"], entries: [entry({ keys: ["a"], content: "elsewhere" })] })];

    expect(lorebooksForCharacter(books, "chr_1")).toEqual([]);
  });

  test("an engine transcript becomes scan messages, dropping non-text parts", () => {
    const scan = toScanMessages([
      { info: { role: "user" }, parts: [{ type: "text", text: "the harbour" }, { type: "file" }] },
      { info: { role: "assistant" }, parts: [{ type: "reasoning", text: "thinking" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "It is cold." }] },
    ]);

    expect(scan).toEqual([
      { role: "user", text: "the harbour" },
      { role: "assistant", text: "It is cold." },
    ]);
  });
});

describe("storage", () => {
  test("a record survives the schema it is persisted through", () => {
    const record = book({
      entries: [entry({ keys: ["harbour"], content: "lore", selective: true, secondary_keys: ["storm"] })],
      characterIds: ["chr_1"],
    });

    expect(roleplayLorebookRecordSchema.parse(record)).toEqual(record);
  });
});
