import { describe, expect, test } from "vitest";
import { roleplayLorebookRecordSchema } from "../../../packages/types/src/roleplay.ts";
import {
  importLorebookFromFile,
  importLorebookFromJson,
  importedLorebookRecord,
  lorebookFromCharacterBook,
  type LorebookImportSuccess,
} from "../../../apps/app/src/app/roleplay/lorebook-import.ts";
import { createLorebookId, selectLorebookEntries } from "../../../apps/app/src/app/roleplay/lorebook.ts";
import { sanitizeCard } from "../../../apps/app/src/app/roleplay/sanitize-card.ts";
import { CARD_COUNT_LIMITS, CARD_FIELD_LIMITS } from "../../../apps/app/src/app/roleplay/sanitize-card.ts";
import { encodeCardToPng } from "../../../apps/app/src/app/roleplay/png-codec.ts";
import { IDAT, IEND, IHDR, pngOf } from "../../fixtures/roleplay/png-fixtures.ts";
import {
  AGNAI_MEMORY_BOOK,
  CARD_WITH_BOOK,
  EXPECTED_HARBOUR_CONTENT,
  EXPECTED_WARDENS_CONTENT,
  NOVELAI_LOREBOOK,
  RISUAI_LOREBOOK,
  SILLYTAVERN_WORLD,
} from "../../fixtures/roleplay/lorebook-fixtures.ts";

function importOf(payload: unknown): LorebookImportSuccess {
  const result = importLorebookFromJson(JSON.stringify(payload));
  if (!result.ok) throw new Error(`expected an import, got: ${result.message}`);
  return result;
}

describe("format detection", () => {
  test("each platform's file is recognised as its own format", () => {
    expect(importOf(SILLYTAVERN_WORLD).format).toBe("sillytavern");
    expect(importOf(NOVELAI_LOREBOOK).format).toBe("novelai");
    expect(importOf(AGNAI_MEMORY_BOOK).format).toBe("agnai");
    expect(importOf(RISUAI_LOREBOOK).format).toBe("risuai");
    expect(importOf(CARD_WITH_BOOK).format).toBe("character_book");
  });

  test("every format produces the same two facts", () => {
    for (const payload of [SILLYTAVERN_WORLD, NOVELAI_LOREBOOK, AGNAI_MEMORY_BOOK, RISUAI_LOREBOOK, CARD_WITH_BOOK]) {
      expect(importOf(payload).book.entries.map((entry) => entry.content)).toEqual([
        EXPECTED_HARBOUR_CONTENT,
        EXPECTED_WARDENS_CONTENT,
      ]);
    }
  });

  test("a file that is not a lorebook is refused with a message naming what is read", () => {
    const result = importLorebookFromJson(JSON.stringify({ hello: "world" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("SillyTavern");
  });

  test("invalid JSON is reported as invalid JSON, not as a missing lorebook", () => {
    const result = importLorebookFromJson("{ nope");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("That file is not valid JSON.");
  });
});

describe("SillyTavern world info", () => {
  const imported = importOf(SILLYTAVERN_WORLD);

  test("keys, secondary keys and selectivity carry across", () => {
    expect(imported.book.entries[0]?.keys).toEqual(["harbour", "docks"]);
    expect(imported.book.entries[1]?.secondary_keys).toEqual(["harbour"]);
    expect(imported.book.entries[1]?.selective).toBe(true);
  });

  test("`disable` becomes `enabled`, inverted", () => {
    expect(imported.book.entries[0]?.enabled).toBe(true);
    expect(imported.book.entries[1]?.enabled).toBe(false);
  });

  test("numeric position maps onto the two placements a card book has", () => {
    expect(imported.book.entries[0]?.position).toBe("before_char");
    expect(imported.book.entries[1]?.position).toBe("after_char");
  });

  test("order, constant and case sensitivity survive", () => {
    expect(imported.book.entries[0]?.insertion_order).toBe(100);
    expect(imported.book.entries[1]?.constant).toBe(true);
    expect(imported.book.entries[1]?.case_sensitive).toBe(true);
  });

  test("settings this app has no behavior for are named, not dropped in silence", () => {
    const losses = imported.losses.join(" ");

    expect(losses).toContain("probability");
    expect(losses).toContain("depth");
  });

  test("an author's-note placement is reported rather than pretended", () => {
    const atDepth = importOf({ entries: { "0": { key: ["a"], content: "x", position: 4 } } });

    expect(atDepth.book.entries[0]?.position).toBe("after_char");
    expect(atDepth.losses.join(" ")).toContain("author's note");
  });
});

describe("NovelAI lorebook", () => {
  const imported = importOf(NOVELAI_LOREBOOK);

  test("force activation is the same idea as constant", () => {
    expect(imported.book.entries[0]?.constant).toBe(false);
    expect(imported.book.entries[1]?.constant).toBe(true);
  });

  test("budget priority becomes the eviction priority", () => {
    expect(imported.book.entries[0]?.priority).toBe(400);
    expect(imported.book.entries[1]?.priority).toBe(100);
  });

  test("the display name and enabled flag carry across", () => {
    expect(imported.book.entries[0]?.name).toBe("The harbour");
    expect(imported.book.entries[1]?.enabled).toBe(false);
  });

  test("the different matching model is stated, since entries will fire at other moments", () => {
    expect(imported.losses.join(" ")).toContain("recent messages");
  });
});

describe("Agnai memory book", () => {
  const imported = importOf(AGNAI_MEMORY_BOOK);

  test("keywords become keys and the book keeps its name", () => {
    expect(imported.book.name).toBe("Ashfell");
    expect(imported.book.entries[0]?.keys).toEqual(["harbour", "docks"]);
  });

  test("priority and weight land on the fields that do those jobs here", () => {
    expect(imported.book.entries[0]?.priority).toBe(400);
    expect(imported.book.entries[0]?.insertion_order).toBe(100);
    expect(imported.book.entries[1]?.insertion_order).toBe(200);
  });
});

describe("RisuAI lorebook", () => {
  const imported = importOf(RISUAI_LOREBOOK);

  test("comma-joined keys are split", () => {
    expect(imported.book.entries[0]?.keys).toEqual(["harbour", "docks"]);
    expect(imported.book.entries[1]?.secondary_keys).toEqual(["harbour"]);
  });

  test("always-active and constant mode both mean constant", () => {
    expect(imported.book.entries[0]?.constant).toBe(false);
    expect(imported.book.entries[1]?.constant).toBe(true);
  });
});

describe("character card lorebook", () => {
  test("the book travels out of the card with its settings", () => {
    const imported = importOf(CARD_WITH_BOOK);

    expect(imported.book.name).toBe("Ashfell");
    expect(imported.book.scanDepth).toBe(3);
    expect(imported.book.tokenBudget).toBe(500);
    expect(imported.book.recursiveScanning).toBe(true);
  });

  test("a sanitized card's book converts without going back through a file", () => {
    const sanitized = sanitizeCard(CARD_WITH_BOOK);
    if (!sanitized.ok) throw new Error("the fixture card should sanitize");
    const book = sanitized.card.data.character_book;
    if (!book) throw new Error("the fixture card should carry a book");

    const converted = lorebookFromCharacterBook(book, "Aria's world");

    expect(converted.name).toBe("Ashfell");
    expect(converted.entries.map((entry) => entry.uid)).toEqual(["lbe_0", "lbe_1"]);
  });

  test("a card PNG yields its lorebook", () => {
    const encoded = encodeCardToPng(pngOf([IHDR, IDAT, IEND]), CARD_WITH_BOOK, CARD_WITH_BOOK);
    if (!encoded.ok) throw new Error("the fixture card should encode");

    const result = importLorebookFromFile(encoded.bytes);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.book.entries).toHaveLength(2);
  });

  test("a card without a lorebook says so rather than failing as a bad file", () => {
    const encoded = encodeCardToPng(
      pngOf([IHDR, IDAT, IEND]),
      { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Aria" } },
      { spec: "chara_card_v3", spec_version: "3.0", data: { name: "Aria" } },
    );
    if (!encoded.ok) throw new Error("the fixture card should encode");

    const result = importLorebookFromFile(encoded.bytes);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("lorebook");
  });
});

describe("the import gate", () => {
  test("privilege keys in an entry's extensions are stripped", () => {
    // A world file is exactly as untrusted as a card, and reaches the prompt by
    // the same route, so it passes the same gate.
    const imported = importOf({
      entries: [{ keys: ["a"], content: "x", extensions: { openwork: { tools: { bash: true } }, evil: {} } }],
    });

    expect(imported.book.entries[0]?.extensions).toEqual({ openwork: {} });
    expect(imported.losses.join(" ")).toContain("Removed for safety");
  });

  test("over-long content and over-many entries are cut to the card limits", () => {
    const imported = importOf({
      entries: Array.from({ length: CARD_COUNT_LIMITS.book_entries + 10 }, () => ({
        keys: ["a"],
        content: "x".repeat(CARD_FIELD_LIMITS.book_entry_content + 100),
      })),
    });

    expect(imported.book.entries).toHaveLength(CARD_COUNT_LIMITS.book_entries);
    expect(imported.book.entries[0]?.content.length).toBe(CARD_FIELD_LIMITS.book_entry_content);
    expect(imported.losses.join(" ")).toContain("Shortened");
  });

  test("an imported book is persistable and immediately matchable", () => {
    const imported = importOf(SILLYTAVERN_WORLD);
    const record = importedLorebookRecord(imported.book, {
      id: createLorebookId(1, "abc"),
      now: 1,
      characterIds: ["chr_1"],
      format: imported.format,
      fallbackName: "Imported world",
    });

    expect(roleplayLorebookRecordSchema.parse(record)).toEqual(record);
    expect(record.source).toBe("imported");
    expect(record.importFormat).toBe("sillytavern");

    const selection = selectLorebookEntries([record], [{ role: "user", text: "down at the docks" }]);

    expect(selection.matches.map((match) => match.text)).toEqual([EXPECTED_HARBOUR_CONTENT]);
  });

  test("a book with no name takes the fallback the caller supplies", () => {
    const record = importedLorebookRecord(importOf(NOVELAI_LOREBOOK).book, {
      id: "lore_1",
      now: 1,
      fallbackName: "harbour.lorebook",
    });

    expect(record.name).toBe("harbour.lorebook");
  });
});
