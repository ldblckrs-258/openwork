import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  KNOWN_SCENE_TYPES,
  MAX_HARD_LIMITS,
  MAX_HARD_LIMIT_CHARS,
  MAX_SCENE_COUNT,
  MAX_SCENE_DESCRIPTION_CHARS,
  MAX_SCENE_NAME_CHARS,
  MAX_SCENE_RECORDS,
  MAX_SCENE_STATE_CHARS,
  SCENE_TYPE_PATTERN,
} from "../../../packages/types/src/roleplay.ts";
import {
  ALLOWED_EXTENSION_NAMESPACES,
  CARD_COUNT_LIMITS,
  CARD_FIELD_LIMITS,
  MAX_CARD_BYTES,
  PRIVILEGE_KEYS,
} from "../../../apps/app/src/app/roleplay/sanitize-card.ts";
import {
  cardWithOpenworkExtension,
  importedCharacterRecord,
} from "../../../apps/app/src/app/roleplay/import-export.ts";
import { sanitizeCard } from "../../../apps/app/src/app/roleplay/sanitize-card.ts";

const schema = JSON.parse(
  readFileSync(new URL("../../../packages/types/schema/openwork-character-card.schema.json", import.meta.url), "utf8"),
) as Record<string, any>;

const cardData = schema.$defs.cardData.properties;
const openwork = schema.$defs.openworkExtension.properties;
const sceneRecord = schema.$defs.sceneRecord.properties;

describe("the published card contract matches what the app enforces", () => {
  test("every text limit is the sanitizer's own", () => {
    expect(cardData.name.maxLength).toBe(CARD_FIELD_LIMITS.name);
    expect(cardData.description.maxLength).toBe(CARD_FIELD_LIMITS.description);
    expect(cardData.personality.maxLength).toBe(CARD_FIELD_LIMITS.personality);
    expect(cardData.scenario.maxLength).toBe(CARD_FIELD_LIMITS.scenario);
    expect(cardData.first_mes.maxLength).toBe(CARD_FIELD_LIMITS.first_mes);
    expect(cardData.mes_example.maxLength).toBe(CARD_FIELD_LIMITS.mes_example);
    expect(cardData.creator_notes.maxLength).toBe(CARD_FIELD_LIMITS.creator_notes);
    expect(cardData.system_prompt.maxLength).toBe(CARD_FIELD_LIMITS.system_prompt);
    expect(cardData.post_history_instructions.maxLength).toBe(CARD_FIELD_LIMITS.post_history_instructions);
    expect(cardData.creator.maxLength).toBe(CARD_FIELD_LIMITS.creator);
    expect(cardData.character_version.maxLength).toBe(CARD_FIELD_LIMITS.character_version);
    expect(cardData.tags.items.maxLength).toBe(CARD_FIELD_LIMITS.tag);
    expect(cardData.alternate_greetings.items.maxLength).toBe(CARD_FIELD_LIMITS.alternate_greeting);
  });

  test("every count limit is the sanitizer's own", () => {
    expect(cardData.tags.maxItems).toBe(CARD_COUNT_LIMITS.tags);
    expect(cardData.alternate_greetings.maxItems).toBe(CARD_COUNT_LIMITS.alternate_greetings);
    expect(schema.$defs.characterBook.properties.entries.maxItems).toBe(CARD_COUNT_LIMITS.book_entries);

    const entry = schema.$defs.characterBookEntry.properties;
    expect(entry.keys.maxItems).toBe(CARD_COUNT_LIMITS.book_entry_keys);
    expect(entry.keys.items.maxLength).toBe(CARD_FIELD_LIMITS.book_entry_key);
    expect(entry.content.maxLength).toBe(CARD_FIELD_LIMITS.book_entry_content);
  });

  test("the byte ceiling is stated, because no schema keyword can express it", () => {
    // Documented rather than validated: a consumer that only runs the schema
    // would otherwise accept a 40MB card the app refuses at the door.
    expect(schema.description).toContain(String(MAX_CARD_BYTES));
  });

  test("the forbidden extension keys are exactly the ones the sanitizer strips", () => {
    expect(schema.$defs.noPrivilegeKeys.propertyNames.not.enum).toEqual([
      ...PRIVILEGE_KEYS,
      "__proto__",
      "constructor",
      "prototype",
    ]);
  });

  test("the only named vendor namespace is the one the sanitizer keeps", () => {
    expect(Object.keys(schema.$defs.extensions.properties)).toEqual([...ALLOWED_EXTENSION_NAMESPACES]);
  });
});

describe("the scene block matches the scene rules", () => {
  test("record and field ceilings are the shared constants", () => {
    expect(openwork.hardLimits.maxItems).toBe(MAX_HARD_LIMITS);
    expect(openwork.hardLimits.items.maxLength).toBe(MAX_HARD_LIMIT_CHARS);
    expect(openwork.sceneRecords.maxItems).toBe(MAX_SCENE_RECORDS);
    expect(sceneRecord.name.maxLength).toBe(MAX_SCENE_NAME_CHARS);
    expect(sceneRecord.state.maxLength).toBe(MAX_SCENE_STATE_CHARS);
    expect(sceneRecord.description.maxLength).toBe(MAX_SCENE_DESCRIPTION_CHARS);
    expect(sceneRecord.count.maximum).toBe(MAX_SCENE_COUNT);
    expect(sceneRecord.count.minimum).toBe(0);
  });

  test("the type slug is the shared pattern, published as an open set rather than an enum", () => {
    expect(sceneRecord.type.pattern).toBe(SCENE_TYPE_PATTERN.source);
    expect(sceneRecord.type.examples).toEqual([...KNOWN_SCENE_TYPES]);
    expect(sceneRecord.type.enum).toBeUndefined();
  });

  test("the pattern the schema publishes accepts and rejects what the app does", () => {
    const published = new RegExp(sceneRecord.type.pattern);

    for (const type of [...KNOWN_SCENE_TYPES, "weather", "restraints_2"]) {
      expect(published.test(type)).toBe(SCENE_TYPE_PATTERN.test(type));
    }
    for (const type of ["Clothes", "1st", "", "a".repeat(25), "has space"]) {
      expect(published.test(type)).toBe(SCENE_TYPE_PATTERN.test(type));
    }
  });
});

describe("what the contract says about import is what the import does", () => {
  const card = () => {
    const sanitized = sanitizeCard({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Stranger",
        description: "A card from someone else.",
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
        extensions: {
          openwork: {
            version: 1,
            nsfw: true,
            hardLimits: ["no violence"],
            sceneRecords: [{ id: "sr_1", type: "clothes", name: "silk blouse", state: "worn", description: "" }],
          },
        },
      },
    });
    if (!sanitized.ok) throw new Error("fixture card was rejected by the sanitizer");
    return sanitized.card;
  };

  test("the block the schema describes is the block that survives sanitization", () => {
    // Two separate controls, and this asserts the first: the sanitizer keeps this
    // namespace and drops every other, which is why the contract names only it.
    expect(card().data.extensions.openwork).toBeDefined();
  });

  test("the three fields documented as applied are applied", () => {
    expect(openwork.nsfw.description).toContain("Applied on import");
    expect(openwork.sceneRecords.description).toContain("Applied on import");
    expect(openwork.hardLimits.description).toContain("Applied on import");

    const imported = importedCharacterRecord(card(), "", "chr_1", 1_700_000_000);

    expect(imported.nsfw).toBe(true);
    expect(imported.hardLimits).toEqual(["no violence"]);
    expect(imported.sceneRecords).toHaveLength(1);
  });

  test("the field documented as never read is never read", () => {
    expect(openwork.attachedSkills.description).toContain("Never read on import");
    expect(importedCharacterRecord(card(), "", "chr_1", 1_700_000_000).attachedSkills).toEqual([]);
  });

  test("a character exported with these fields round-trips back through import", () => {
    const original = importedCharacterRecord(card(), "", "chr_1", 1_700_000_000);
    const roundTripped = importedCharacterRecord(
      cardWithOpenworkExtension(original),
      "",
      "chr_2",
      1_700_000_000,
    );

    expect(roundTripped.nsfw).toBe(original.nsfw);
    expect(roundTripped.hardLimits).toEqual(original.hardLimits);
    expect(roundTripped.sceneRecords).toEqual(original.sceneRecords);
  });

  test("an ordinary character exports no vendor block at all", () => {
    const plain = { ...importedCharacterRecord(card(), "", "chr_1", 1), nsfw: false, sceneRecords: [], hardLimits: [] };

    expect(plain.card.data.extensions.openwork).toBeDefined();
    expect(cardWithOpenworkExtension(plain).data.extensions.openwork).toBeUndefined();
  });
});
