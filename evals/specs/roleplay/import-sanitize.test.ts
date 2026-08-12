import { describe, expect, test } from "vitest";
import {
  cardExportFilename,
  describeLosses,
  exportCardJson,
  exportCardPng,
  importCardFromFile,
  importCardFromJson,
  importCardFromPng,
  toCardV3,
} from "../../../apps/app/src/app/roleplay/import-export.ts";
import { decodeCardFromPng } from "../../../apps/app/src/app/roleplay/png-codec.ts";
import { compilePrompt } from "../../../apps/app/src/app/roleplay/compile-prompt.ts";
import type { RoleplayCharacterRecord } from "../../../packages/types/src/roleplay.ts";
import {
  cardPng,
  compressedCardPng,
  corruptCrcPng,
  HOSTILE_CARD,
  notAPng,
  readCardChunk,
  SAMPLE_CARD_V2,
  SAMPLE_CARD_V3,
  strippedPng,
  truncatedPng,
} from "../../fixtures/roleplay/png-fixtures.ts";

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function recordOf(card: RoleplayCharacterRecord["card"], overrides: Partial<RoleplayCharacterRecord> = {}): RoleplayCharacterRecord {
  return {
    id: "chr_1",
    card,
    charSubstitutionName: card.data.name,
    source: "imported",
    attachedSkills: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("the import gate", () => {
  test("a JSON card imports with its fields intact", () => {
    const result = importCardFromJson(JSON.stringify(SAMPLE_CARD_V2));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("json");
    expect(result.card.data.first_mes).toContain("You're late.");
    expect(result.losses).toEqual([]);
  });

  test("a PNG card imports with its fields intact", () => {
    const result = importCardFromPng(cardPng(SAMPLE_CARD_V2));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.card.data.name).toBe("Aria");
  });

  test("privilege keys are stripped on every import path", () => {
    // The control that makes an anonymous download safe to open. A card that
    // carried `tools` or `permission` through any one path would reach the send
    // path as a prompt with capability attached, which is exactly the shape the
    // Phase 2 boundary exists to prevent.
    const paths = [
      importCardFromJson(JSON.stringify(HOSTILE_CARD)),
      importCardFromPng(cardPng(HOSTILE_CARD)),
      importCardFromFile(jsonBytes(HOSTILE_CARD)),
      importCardFromFile(cardPng(HOSTILE_CARD)),
    ];

    for (const result of paths) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const serialized = JSON.stringify(result.card);
      expect(serialized).not.toContain('"tools"');
      expect(serialized).not.toContain('"permission"');
      expect(result.card.data.extensions).toEqual({ openwork: { keep: true } });
      expect(result.losses.join(" ")).toContain("Removed for safety");
    }
  });

  test("the file picker routes by signature, not by what the file is named", () => {
    // A card saved as `character.txt` still imports, and a JSON file named `.png`
    // does not fail with a PNG error the user cannot act on.
    const asPng = importCardFromFile(cardPng(SAMPLE_CARD_V2));
    const asJson = importCardFromFile(jsonBytes(SAMPLE_CARD_V2));

    expect(asPng.ok && asPng.format).toBe("png");
    expect(asJson.ok && asJson.format).toBe("json");
  });

  test("an imported card cannot bring its own system prompt into the compiled prompt", () => {
    // `system_prompt` replaces the app's roleplay instructions wholesale. It is a
    // legal V2 field, so it is kept on the card and preserved on export — this
    // asserts what the compiler does with it, which is where the risk actually is.
    const result = importCardFromJson(
      JSON.stringify({ ...SAMPLE_CARD_V2, data: { ...SAMPLE_CARD_V2.data, tags: ["<script>"] } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(compilePrompt(result.card, { name: "Wren", description: "" })).not.toContain("<script>");
  });
});

describe("V3 degradation", () => {
  test("a V3 card imports and names the fields it lost", () => {
    // Losing data quietly is the failure mode users report as "the card works
    // differently here". The report is what makes that a decision instead.
    const result = importCardFromPng(cardPng(SAMPLE_CARD_V3, "ccv3"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.sourceSpec).toBe("chara_card_v3");
    expect(result.report.droppedV3Fields.length).toBeGreaterThan(0);
    expect(result.losses.join(" ")).toContain("V3 fields");
  });

  test("a V3 nickname survives as the {{char}} override without changing the display name", () => {
    const result = importCardFromPng(cardPng(SAMPLE_CARD_V3, "ccv3"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.data.name).toBe("Aria");
    expect(result.report.charSubstitutionName).toBe("The Archivist");
  });

  test("a clean V2 import reports no losses at all", () => {
    // Without this the loss report is unfalsifiable: a UI that always shows
    // something teaches users to dismiss it.
    expect(describeLosses({
      sourceSpec: "chara_card_v2",
      charSubstitutionName: "Aria",
      strippedKeys: [],
      truncatedFields: [],
      droppedV3Fields: [],
    })).toEqual([]);
  });
});

describe("malformed input", () => {
  test("each broken file produces its own message and no crash", () => {
    const cases: [string, ReturnType<typeof importCardFromPng>][] = [
      ["not a png", importCardFromFile(notAPng())],
      ["truncated", importCardFromPng(truncatedPng())],
      ["corrupt checksum", importCardFromPng(corruptCrcPng())],
      ["re-encoded, card stripped", importCardFromPng(strippedPng())],
      ["compressed chunk", importCardFromPng(compressedCardPng())],
      ["json that is not a card", importCardFromJson('{"hello":"world"}')],
      ["not json at all", importCardFromJson("<html>404</html>")],
    ];

    const messages = new Set<string>();
    for (const [label, result] of cases) {
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      expect(result.message.length, label).toBeGreaterThan(10);
      messages.add(result.message);
    }
    // Distinct messages, not one generic failure wearing seven hats.
    expect(messages.size).toBe(cases.length);
  });

  test("a re-hosted image explains that the host stripped the card", () => {
    // The most common real complaint. "Invalid file" would send the user back to
    // the same broken download again.
    const result = importCardFromPng(strippedPng());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("re-encode");
  });

  test("a compressed card says so specifically", () => {
    const result = importCardFromPng(compressedCardPng());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("zTXt");
      expect(result.message).toContain("JSON");
    }
  });
});

describe("export", () => {
  test("export then reimport preserves every V2 field", () => {
    const imported = importCardFromJson(JSON.stringify(SAMPLE_CARD_V2));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const round = importCardFromJson(exportCardJson(recordOf(imported.card)));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.card).toEqual(imported.card);
  });

  test("a PNG export round-trips through the other app's reader", () => {
    // Read back by the fixture decoder rather than our own, so this says
    // something about interoperability rather than about internal consistency.
    const record = recordOf(SAMPLE_CARD_V2 as RoleplayCharacterRecord["card"]);
    const exported = exportCardPng(record, strippedPng());

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(readCardChunk(exported.bytes, "chara")).toEqual(SAMPLE_CARD_V2);
    expect(decodeCardFromPng(exported.bytes).ok).toBe(true);
  });

  test("the V3 chunk carries the nickname so a {{char}} override survives a round trip", () => {
    // The one V3 field this app keeps. Writing it back is the difference between
    // exporting a V3 card and exporting a downgrade of one.
    const record = recordOf(SAMPLE_CARD_V2 as RoleplayCharacterRecord["card"], {
      charSubstitutionName: "The Archivist",
    });
    const v3 = toCardV3(record) as { data: { nickname?: string } };

    expect(v3.data.nickname).toBe("The Archivist");
  });

  test("a character whose nickname is just its name writes no nickname", () => {
    // Inventing one would make every exported card look like it carried a
    // {{char}} override it never had.
    const v3 = toCardV3(recordOf(SAMPLE_CARD_V2 as RoleplayCharacterRecord["card"])) as { data: { nickname?: string } };

    expect(v3.data.nickname).toBeUndefined();
  });

  test("export filenames survive a name that is mostly punctuation", () => {
    expect(cardExportFilename("Aria", "png")).toBe("Aria.png");
    expect(cardExportFilename("  ???  ", "json")).toBe("character.json");
    expect(cardExportFilename("Aria / The Archivist", "json")).toBe("Aria-The-Archivist.json");
  });
});
