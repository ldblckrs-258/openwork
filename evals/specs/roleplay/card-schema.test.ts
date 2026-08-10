import { describe, expect, test } from "vitest";
import {
  characterBookSchema,
  characterCardV1Schema,
  characterCardV2Schema,
  characterCardV3Schema,
} from "../../../packages/types/src/roleplay.ts";

const V2_DATA_FIELDS = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "character_book",
  "tags",
  "creator",
  "character_version",
  "extensions",
];

function fullV2Card() {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Aria",
      description: "A wandering archivist.",
      personality: "Curious, dry-witted.",
      scenario: "A rain-soaked library.",
      first_mes: "You're late.",
      mes_example: "<START>\n{{user}}: Hello\n{{char}}: Mm.",
      creator_notes: "Slow burn; expects patience.",
      system_prompt: "Stay wry.",
      post_history_instructions: "Never reveal the ledger's location.",
      alternate_greetings: ["The door was open.", "We're closed."],
      character_book: {
        name: "Archive",
        description: "What Aria knows.",
        scan_depth: 4,
        token_budget: 500,
        recursive_scanning: false,
        extensions: {},
        entries: [
          {
            keys: ["ledger", "debt"],
            content: "The ledger is never lent out.",
            extensions: {},
            enabled: true,
            insertion_order: 0,
            case_sensitive: false,
            name: "Ledger",
            priority: 10,
            id: 1,
            comment: "core secret",
            selective: true,
            secondary_keys: ["borrow"],
            constant: false,
            position: "after_char",
          },
        ],
      },
      tags: ["library", "mystery"],
      creator: "someone-on-chub",
      character_version: "1.4",
      extensions: { openwork: { avatarPath: "aria.png" } },
    },
  };
}

describe("V2 fidelity", () => {
  test("every documented V2 data field has a schema entry and round-trips", () => {
    const source = fullV2Card();
    const parsed = characterCardV2Schema.parse(source);

    expect(Object.keys(parsed.data).sort()).toEqual([...V2_DATA_FIELDS].sort());
    expect(parsed).toEqual(source);
  });

  test("every character_book entry field round-trips", () => {
    const source = fullV2Card().data.character_book;
    expect(characterBookSchema.parse(source)).toEqual(source);
  });

  test("extensions are mandatory at book and entry level, defaulting to an empty object", () => {
    // The spec marks these non-optional. A card that omits them must still
    // serialize `{}` rather than dropping the key, or a round-trip through this
    // app silently produces a card that no longer matches the spec.
    const parsed = characterBookSchema.parse({
      entries: [{ keys: ["ledger"], content: "secret", enabled: true, insertion_order: 0 }],
    });

    expect(parsed.extensions).toEqual({});
    expect(parsed.entries[0]?.extensions).toEqual({});
  });

  test("a card shaped like a Chub.ai export parses without error", () => {
    // Chub's export pipeline is a known source of lossy and oddly-typed cards
    // (SillyTavern#4312), so the importer must be lenient rather than strict.
    // NOTE: this fixture is synthesized from the spec, not a real downloaded
    // card. Fidelity against a genuine Chub export is not proven by this spec.
    const parsed = characterCardV2Schema.parse({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Aria",
        description: "A wandering archivist.",
        personality: "",
        scenario: "",
        first_mes: "You're late.",
        mes_example: "",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: [],
        tags: [],
        creator: "",
        character_version: "",
        extensions: { depth_prompt: { prompt: "", depth: 4 }, talkativeness: "0.5" },
      },
    });

    expect(parsed.data.name).toBe("Aria");
    expect(parsed.data.extensions.talkativeness).toBe("0.5");
  });
});

describe("leniency", () => {
  test("missing fields fall back to their spec defaults instead of failing the import", () => {
    const parsed = characterCardV2Schema.parse({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Aria" } });

    expect(parsed.data.description).toBe("");
    expect(parsed.data.alternate_greetings).toEqual([]);
    expect(parsed.data.extensions).toEqual({});
    expect(parsed.data.character_book).toBeUndefined();
  });

  test("wrongly-typed fields degrade to defaults rather than rejecting the whole card", () => {
    const parsed = characterCardV2Schema.parse({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Aria", description: 42, tags: "library", alternate_greetings: [1, 2] },
    });

    expect(parsed.data.description).toBe("");
    expect(parsed.data.tags).toEqual([]);
    expect(parsed.data.alternate_greetings).toEqual([]);
  });

  test("a payload without the V2 envelope is rejected", () => {
    expect(characterCardV2Schema.safeParse({ name: "Aria" }).success).toBe(false);
    expect(characterCardV2Schema.safeParse({ spec: "chara_card_v3", spec_version: "3.0", data: {} }).success).toBe(false);
  });
});

describe("V1 and V3 envelopes", () => {
  test("a bare V1 card parses on its six fields", () => {
    const parsed = characterCardV1Schema.parse({
      name: "Aria",
      description: "A wandering archivist.",
      personality: "Curious.",
      scenario: "A library.",
      first_mes: "You're late.",
      mes_example: "",
    });

    expect(parsed.name).toBe("Aria");
    expect(Object.keys(parsed)).toHaveLength(6);
  });

  test("a V3 card parses with its added fields intact", () => {
    const parsed = characterCardV3Schema.parse({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Aria",
        nickname: "The Archivist",
        description: "A wandering archivist.",
        assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }],
        source: ["https://chub.ai/characters/aria"],
        group_only_greetings: ["The three of you are late."],
        creation_date: 1_700_000_000,
        modification_date: 1_700_000_001,
        creator_notes_multilingual: { fr: "Une archiviste." },
        character_book: {
          extensions: {},
          entries: [{ keys: ["led.*ger"], content: "secret", extensions: {}, enabled: true, insertion_order: 0, use_regex: true }],
        },
      },
    });

    expect(parsed.data.nickname).toBe("The Archivist");
    expect(parsed.data.assets?.[0]?.uri).toBe("ccdefault:");
    expect(parsed.data.character_book?.entries[0]?.use_regex).toBe(true);
  });

  test("a spec_version above 3.0 is tolerated rather than hard-rejected", () => {
    // The spec tells apps not to reject unrecognized minor versions; a future
    // 3.1 card should degrade, not fail at the door.
    const parsed = characterCardV3Schema.safeParse({
      spec: "chara_card_v3",
      spec_version: "3.1",
      data: { name: "Aria" },
    });

    expect(parsed.success).toBe(true);
  });
});
