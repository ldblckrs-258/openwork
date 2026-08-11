/**
 * One world, written the way each platform writes it.
 *
 * Every fixture describes the same two facts — the harbour freezes, and the
 * Wardens watch it — so a conversion can be checked against a fixed expectation
 * rather than against whatever the converter happened to produce. Field names,
 * shapes, and quirks are taken from each platform's own export: SillyTavern's
 * keyed object and numeric `position`, NovelAI's `contextConfig`, Agnai's
 * `entry`/`keywords`, RisuAI's comma-joined key string.
 */

export const SILLYTAVERN_WORLD = {
  entries: {
    "0": {
      uid: 0,
      key: ["harbour", "docks"],
      keysecondary: [],
      comment: "The harbour",
      content: "The harbour freezes over every winter.",
      constant: false,
      selective: true,
      order: 100,
      position: 0,
      disable: false,
      caseSensitive: false,
      probability: 100,
      useProbability: true,
      depth: 4,
      matchWholeWords: null,
      excludeRecursion: false,
    },
    "1": {
      uid: 1,
      key: ["Wardens"],
      keysecondary: ["harbour"],
      comment: "The Wardens",
      content: "The Wardens answer to nobody.",
      constant: true,
      selective: true,
      order: 200,
      position: 1,
      disable: true,
      caseSensitive: true,
    },
  },
};

export const NOVELAI_LOREBOOK = {
  lorebookVersion: 5,
  settings: { orderByKeyLocations: false },
  entries: [
    {
      text: "The harbour freezes over every winter.",
      contextConfig: {
        prefix: "",
        suffix: "\n",
        tokenBudget: 2048,
        reservedTokens: 0,
        budgetPriority: 400,
        trimDirection: "trimBottom",
        insertionType: "newline",
        insertionPosition: -1,
      },
      lastUpdatedAt: 1_700_000_000_000,
      displayName: "The harbour",
      keys: ["harbour", "docks"],
      searchRange: 1000,
      enabled: true,
      forceActivation: false,
      keyRelative: false,
      nonStoryActivatable: false,
      category: "",
      loreBiasGroups: [],
    },
    {
      text: "The Wardens answer to nobody.",
      contextConfig: { budgetPriority: 100, insertionPosition: -1 },
      displayName: "The Wardens",
      keys: ["Wardens"],
      enabled: false,
      forceActivation: true,
      searchRange: 1000,
    },
  ],
};

export const AGNAI_MEMORY_BOOK = {
  kind: "memory",
  name: "Ashfell",
  description: "The coast around Ashfell.",
  entries: [
    {
      name: "The harbour",
      entry: "The harbour freezes over every winter.",
      keywords: ["harbour", "docks"],
      priority: 400,
      weight: 100,
      enabled: true,
    },
    {
      name: "The Wardens",
      entry: "The Wardens answer to nobody.",
      keywords: ["Wardens"],
      priority: 100,
      weight: 200,
      enabled: false,
    },
  ],
};

export const RISUAI_LOREBOOK = {
  type: "risu",
  ver: 1,
  data: [
    {
      key: "harbour, docks",
      comment: "The harbour",
      content: "The harbour freezes over every winter.",
      mode: "normal",
      insertorder: 100,
      alwaysActive: false,
      secondkey: "",
      selective: false,
      activationPercent: 100,
    },
    {
      key: "Wardens",
      comment: "The Wardens",
      content: "The Wardens answer to nobody.",
      mode: "constant",
      insertorder: 200,
      alwaysActive: true,
      secondkey: "harbour",
      selective: true,
    },
  ],
};

export const CARD_WITH_BOOK = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "The archivist.",
    first_mes: "You're late.",
    character_book: {
      name: "Ashfell",
      scan_depth: 3,
      token_budget: 500,
      recursive_scanning: true,
      extensions: {},
      entries: [
        {
          keys: ["harbour", "docks"],
          content: "The harbour freezes over every winter.",
          extensions: {},
          enabled: true,
          insertion_order: 100,
          comment: "The harbour",
          position: "before_char",
        },
        {
          keys: ["Wardens"],
          secondary_keys: ["harbour"],
          selective: true,
          constant: true,
          content: "The Wardens answer to nobody.",
          extensions: {},
          enabled: false,
          insertion_order: 200,
          case_sensitive: true,
        },
      ],
    },
  },
};

/** What every fixture above must produce, whichever file it arrived in. */
export const EXPECTED_HARBOUR_CONTENT = "The harbour freezes over every winter.";
export const EXPECTED_WARDENS_CONTENT = "The Wardens answer to nobody.";
