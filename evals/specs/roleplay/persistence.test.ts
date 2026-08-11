import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ROLEPLAY_STORE_SCHEMA_VERSION,
  type CharacterCardV2,
  type RoleplayCharacterRecord,
} from "../../../packages/types/src/roleplay.ts";
import type { ServerConfig } from "../../../apps/server/src/types.ts";
import {
  bindSession,
  clearSessionBinding,
  deleteCharacter,
  deleteLorebook,
  deleteMemory,
  deletePersona,
  listCharacterMemories,
  listLorebooks,
  writeLorebook,
  listCharacterRevisions,
  listCharacters,
  listPersonas,
  MAX_MEMORIES_PER_CHARACTER,
  MAX_RETAINED_TURNS_PER_SESSION,
  MAX_REVISIONS_PER_CHARACTER,
  writeMemory,
  writeRevision,
  readCharacter,
  listSessionTurns,
  readTurn,
  readSessionBinding,
  writeCharacter,
  writeTurn,
  writePersona,
} from "../../../apps/server/src/roleplay-store.ts";

let root = "";
let config: ServerConfig;

const WORKSPACE_A = "ws_roleplay_a";
const WORKSPACE_B = "ws_roleplay_b";

function serverConfig(dir: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(dir, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_A, name: "A", path: dir, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [dir],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

function card(name: string, description = "A wandering archivist."): CharacterCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description,
      personality: "Curious.",
      scenario: "A library.",
      first_mes: "You're late.",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "",
      character_version: "",
      extensions: {},
    },
  };
}

function characterRecord(id: string, name = "Aria", description?: string): RoleplayCharacterRecord {
  return {
    id,
    card: card(name, description),
    charSubstitutionName: name,
    source: "authored",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  };
}

async function schemaVersionOf(table: string, workspaceId: string): Promise<number> {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(join(root, "runtime.sqlite"), { readOnly: true });
  try {
    const row = sqlite.prepare(`SELECT schema_version AS v FROM ${table} WHERE workspace_id = ?`).get(workspaceId);
    if (typeof row !== "object" || row === null || typeof (row as { v?: unknown }).v !== "number") {
      throw new Error(`${table} carried no schema version for ${workspaceId}`);
    }
    return (row as { v: number }).v;
  } finally {
    sqlite.close();
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openwork-roleplay-"));
  config = serverConfig(root);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("characters", () => {
  test("a written character round-trips and lists", async () => {
    await writeCharacter(config, WORKSPACE_A, characterRecord("char_round_trip"));

    const read = await readCharacter(config, WORKSPACE_A, "char_round_trip");
    expect(read?.card.data.name).toBe("Aria");
    expect((await listCharacters(config, WORKSPACE_A)).map((entry) => entry.id)).toContain("char_round_trip");
  });

  test("privilege-bearing keys never reach the database file, not merely the read path", async () => {
    // Defense in depth behind the import sanitizer. Asserting the round-tripped
    // in-memory value would not prove this: filtering on read alone still leaves
    // the keys sitting in plain text on disk, where a backup, support bundle, or
    // migration script reading the database directly would find exactly what the
    // sanitizer was supposed to have removed. So this reads the raw column.
    const hostile = characterRecord("char_hostile");
    const smuggled = {
      ...hostile,
      card: { ...hostile.card, data: { ...hostile.card.data, permission: { bash: "allow" }, tools: { bash: true } } },
    } as RoleplayCharacterRecord;

    await writeCharacter(config, WORKSPACE_A, smuggled);

    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(join(root, "runtime.sqlite"), { readOnly: true });
    let raw = "";
    try {
      const row = sqlite
        .prepare("SELECT characters_json AS json FROM roleplay_characters WHERE workspace_id = ?")
        .get(WORKSPACE_A);
      raw = String((row as { json?: unknown } | undefined)?.json ?? "");
    } finally {
      sqlite.close();
    }

    expect(raw).toContain("char_hostile");
    expect(raw).not.toContain("permission");
    expect(raw).not.toContain('"tools"');

    const stored = await readCharacter(config, WORKSPACE_A, "char_hostile");
    expect(stored?.card.data).not.toHaveProperty("permission");
    expect(stored?.card.data).not.toHaveProperty("tools");
  });

  test("a structurally invalid record is refused loudly rather than saved half-formed", async () => {
    // A record that fails validation is a caller bug, not untrusted input.
    // Dropping it silently would show the user a successful save and no character.
    const broken = { ...characterRecord("char_broken"), id: "" } as RoleplayCharacterRecord;

    await expect(writeCharacter(config, WORKSPACE_A, broken)).rejects.toThrow(/Refusing to persist/);
  });

  test("a character in one workspace is invisible in another", async () => {
    await writeCharacter(config, WORKSPACE_A, characterRecord("char_only_in_a"));

    expect(await readCharacter(config, WORKSPACE_B, "char_only_in_a")).toBeUndefined();
    expect((await listCharacters(config, WORKSPACE_B)).map((entry) => entry.id)).not.toContain("char_only_in_a");
  });

  test("a character survives being re-read from the database file on disk", async () => {
    await writeCharacter(config, WORKSPACE_A, characterRecord("char_durable", "Durable"));

    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(join(root, "runtime.sqlite"), { readOnly: true });
    try {
      const row = sqlite
        .prepare("SELECT characters_json AS json FROM roleplay_characters WHERE workspace_id = ?")
        .get(WORKSPACE_A);
      const json = (row as { json?: unknown } | undefined)?.json;
      expect(typeof json).toBe("string");
      expect(JSON.parse(String(json)).char_durable.card.data.name).toBe("Durable");
    } finally {
      sqlite.close();
    }
  });
});

describe("concurrent writes", () => {
  test("simultaneous writes all survive; none is silently lost", async () => {
    // This is the defining hazard of a one-blob-per-workspace store. Without the
    // promise-chain serializer every one of these calls reads the same document
    // and the last write wins, so the user loses edits with no error shown. If
    // this regresses, the serializer has been bypassed.
    const ids = Array.from({ length: 25 }, (_, index) => `char_concurrent_${index}`);

    await Promise.all(ids.map((id) => writeCharacter(config, WORKSPACE_B, characterRecord(id, `Name ${id}`))));

    const stored = (await listCharacters(config, WORKSPACE_B)).map((entry) => entry.id);
    expect(stored).toEqual(expect.arrayContaining(ids));
  });

  test("a persona round-trips and can be deleted outright", async () => {
    // Personas are the user's own text, not untrusted card data, so they are
    // removed rather than tombstoned — nothing renders a past turn from them.
    await writePersona(config, WORKSPACE_A, {
      id: "persona_round_trip",
      persona: { name: "Wren", description: "A courier with an overdue book." },
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await listPersonas(config, WORKSPACE_A)).map((entry) => entry.id)).toContain("persona_round_trip");

    expect(await deletePersona(config, WORKSPACE_A, "persona_round_trip")).toBe(true);
    expect(await deletePersona(config, WORKSPACE_A, "persona_round_trip")).toBe(false);
    expect((await listPersonas(config, WORKSPACE_A)).map((entry) => entry.id)).not.toContain("persona_round_trip");
  });

  test("concurrent writes across different stores do not clobber each other", async () => {
    await Promise.all([
      writeCharacter(config, WORKSPACE_A, characterRecord("char_mixed")),
      writePersona(config, WORKSPACE_A, {
        id: "persona_mixed",
        persona: { name: "Wren", description: "A courier." },
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);

    expect(await readCharacter(config, WORKSPACE_A, "char_mixed")).toBeDefined();
    expect((await listPersonas(config, WORKSPACE_A)).map((entry) => entry.id)).toContain("persona_mixed");
  });
});

describe("character delete", () => {
  test("deleting a character leaves its bound session readable in a deleted state", async () => {
    await writeCharacter(config, WORKSPACE_A, characterRecord("char_doomed", "Doomed"));
    await bindSession(config, WORKSPACE_A, {
      sessionId: "ses_doomed",
      characterId: "char_doomed",
      personaId: "",
      storySoFar: "",
      boundAt: 1_700_000_000,
    });

    expect(await deleteCharacter(config, WORKSPACE_A, "char_doomed")).toBe(true);

    const state = await readSessionBinding(config, WORKSPACE_A, "ses_doomed");
    expect(state?.characterDeleted).toBe(true);
    expect(state?.binding.characterId).toBe("char_doomed");
    // The card survives the tombstone so the transcript can still render the
    // character's name; a hard delete would orphan the conversation.
    expect(state?.character?.card.data.name).toBe("Doomed");
    expect((await listCharacters(config, WORKSPACE_A)).map((entry) => entry.id)).not.toContain("char_doomed");
  });

  test("deleting an already-deleted character reports no change", async () => {
    expect(await deleteCharacter(config, WORKSPACE_A, "char_doomed")).toBe(false);
  });
});

describe("turns", () => {
  function turnRecord(turnId: string, sessionId: string, overrides: Record<string, unknown> = {}) {
    return {
      turnId,
      sessionId,
      messageId: `msg_${turnId}`,
      userText: "Still open?",
      blocks: [
        { type: "dialogue" as const, text: "Still open?" },
        { type: "action" as const, text: "shakes out an umbrella" },
        { type: "director" as const, text: "Aria should refuse at first." },
      ],
      alternatives: [],
      activeAlternative: 0,
      createdAt: 10,
      ...overrides,
    };
  }

  test("a turn is retrievable by the client turn id, not the engine message id", async () => {
    // The engine mints new message ids on every regenerate, so a message-keyed
    // record would be orphaned by the one operation it exists to survive.
    await writeTurn(config, WORKSPACE_A, turnRecord("turn_round_trip", "ses_turns"));

    const stored = await readTurn(config, WORKSPACE_A, "turn_round_trip");
    expect(stored?.blocks.map((block) => block.type)).toEqual(["dialogue", "action", "director"]);
    expect(await readTurn(config, WORKSPACE_A, "msg_turn_round_trip")).toBeUndefined();
  });

  test("captured alternatives survive a rewrite of the turn", async () => {
    // These are the only copies: the engine destroys a reverted reply as soon as
    // the replacement prompt is dispatched.
    await writeTurn(config, WORKSPACE_A, turnRecord("turn_alts", "ses_turns", {
      alternatives: [
        { text: "She says nothing.", messageId: "msg_a", createdAt: 1 },
        { text: "She laughs.", messageId: "msg_b", createdAt: 2 },
      ],
      activeAlternative: 1,
    }));

    const stored = await readTurn(config, WORKSPACE_A, "turn_alts");
    expect(stored?.alternatives.map((alternative) => alternative.text)).toEqual(["She says nothing.", "She laughs."]);
    expect(stored?.activeAlternative).toBe(1);
  });

  test("a session's turns come back oldest first", async () => {
    await writeTurn(config, WORKSPACE_A, turnRecord("turn_late", "ses_ordered", { createdAt: 200 }));
    await writeTurn(config, WORKSPACE_A, turnRecord("turn_early", "ses_ordered", { createdAt: 100 }));

    expect((await listSessionTurns(config, WORKSPACE_A, "ses_ordered")).map((entry) => entry.turnId))
      .toEqual(["turn_early", "turn_late"]);
  });

  test("retained turns per session are capped, oldest first", async () => {
    // Turns grow with conversation length and are never read in bulk, so an
    // uncapped store grows without bound inside a document that is deserialized
    // on every read.
    const total = MAX_RETAINED_TURNS_PER_SESSION + 5;
    for (let index = 0; index < total; index += 1) {
      await writeTurn(config, WORKSPACE_A, turnRecord(`turn_capped_${index}`, "ses_capped", { createdAt: index }));
    }

    expect(await readTurn(config, WORKSPACE_A, "turn_capped_0")).toBeUndefined();
    expect(await readTurn(config, WORKSPACE_A, `turn_capped_${total - 1}`)).toBeDefined();
  });

  test("clearing a session binding prunes that session's turns and no others", async () => {
    await bindSession(config, WORKSPACE_A, {
      sessionId: "ses_pruned",
      characterId: "char_round_trip",
      personaId: "",
      storySoFar: "",
      boundAt: 1,
    });
    await writeTurn(config, WORKSPACE_A, turnRecord("turn_pruned", "ses_pruned", { createdAt: 1 }));

    await clearSessionBinding(config, WORKSPACE_A, "ses_pruned");

    expect(await readTurn(config, WORKSPACE_A, "turn_pruned")).toBeUndefined();
    expect(await readTurn(config, WORKSPACE_A, "turn_round_trip")).toBeDefined();
    expect(await readSessionBinding(config, WORKSPACE_A, "ses_pruned")).toBeUndefined();
  });
});

describe("schema version", () => {
  test("every store stamps the current schema version so a future bump can migrate", async () => {
    await writeCharacter(config, WORKSPACE_A, characterRecord("char_versioned"));
    // Each table is created on its first write, so every store needs one before
    // its version can be read back.
    await writeMemory(config, WORKSPACE_A, {
      id: "mem_versioned",
      characterId: "char_versioned",
      text: "Versioned.",
      source: "user",
      createdAt: 1,
      updatedAt: 1,
    });
    await writeRevision(config, WORKSPACE_A, {
      id: "rev_versioned",
      characterId: "char_versioned",
      card: characterRecord("char_versioned").card,
      changedFields: [],
      createdAt: 1,
    });

    expect(await schemaVersionOf("roleplay_characters", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
    expect(await schemaVersionOf("roleplay_personas", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
    expect(await schemaVersionOf("roleplay_sessions", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
    expect(await schemaVersionOf("roleplay_turns", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
    expect(await schemaVersionOf("roleplay_memories", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
    await writeLorebook(config, WORKSPACE_A, lorebookRecord("lore_versioned"));

    expect(await schemaVersionOf("roleplay_revisions", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
    expect(await schemaVersionOf("roleplay_lorebooks", WORKSPACE_A)).toBe(ROLEPLAY_STORE_SCHEMA_VERSION);
  });
});

function lorebookRecord(id: string, characterIds: string[] = []) {
  return {
    id,
    name: "Ashfell",
    description: "",
    entries: [
      {
        uid: "lbe_0",
        keys: ["harbour"],
        content: "The harbour freezes over.",
        extensions: {},
        enabled: true,
        insertion_order: 0,
      },
    ],
    characterIds,
    source: "authored" as const,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("lorebooks", () => {
  test("a book round-trips with its entries and attachments", async () => {
    await writeLorebook(config, WORKSPACE_A, lorebookRecord("lore_round_trip", ["char_1"]));

    const listed = await listLorebooks(config, WORKSPACE_A);
    const stored = listed.find((entry) => entry.id === "lore_round_trip");

    expect(stored?.entries[0]?.keys).toEqual(["harbour"]);
    expect(stored?.characterIds).toEqual(["char_1"]);
  });

  test("books are isolated per workspace", async () => {
    await writeLorebook(config, WORKSPACE_A, lorebookRecord("lore_isolated"));

    expect((await listLorebooks(config, WORKSPACE_B)).some((entry) => entry.id === "lore_isolated")).toBe(false);
  });

  test("deleting removes the book outright, since nothing renders from it later", async () => {
    await writeLorebook(config, WORKSPACE_A, lorebookRecord("lore_deleted"));

    expect(await deleteLorebook(config, WORKSPACE_A, "lore_deleted")).toBe(true);
    expect((await listLorebooks(config, WORKSPACE_A)).some((entry) => entry.id === "lore_deleted")).toBe(false);
    expect(await deleteLorebook(config, WORKSPACE_A, "lore_deleted")).toBe(false);
  });
});

describe("revisions", () => {
  function revisionRecord(id: string, characterId: string, createdAt: number, personality: string) {
    return {
      id,
      characterId,
      card: {
        spec: "chara_card_v2" as const,
        spec_version: "2.0" as const,
        data: {
          name: "Aria",
          description: "The archivist.",
          personality,
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
          extensions: {},
        },
      },
      changedFields: ["personality"],
      createdAt,
    };
  }

  test("a revision keeps the whole prior card, so rollback is a copy", async () => {
    await writeRevision(config, WORKSPACE_A, revisionRecord("rev_1", "char_rev", 10, "warm"));

    const stored = await listCharacterRevisions(config, WORKSPACE_A, "char_rev");
    expect(stored[0]?.card.data.personality).toBe("warm");
    expect(stored[0]?.changedFields).toEqual(["personality"]);
  });

  test("revisions come back oldest first, so the first entry is the original", async () => {
    await writeRevision(config, WORKSPACE_A, revisionRecord("rev_late", "char_order_rev", 30, "late"));
    await writeRevision(config, WORKSPACE_A, revisionRecord("rev_early", "char_order_rev", 10, "early"));

    expect((await listCharacterRevisions(config, WORKSPACE_A, "char_order_rev")).map((entry) => entry.id)).toEqual([
      "rev_early",
      "rev_late",
    ]);
  });

  test("pruning drops from the middle and never the original", async () => {
    // The oldest entry is the card before anything was applied. It is what a
    // drift comparison and a full rollback are made against, so a plain
    // "keep the last N" would discard the one entry the feature exists for.
    for (let index = 0; index < MAX_REVISIONS_PER_CHARACTER + 5; index += 1) {
      await writeRevision(config, WORKSPACE_A, revisionRecord(`rev_cap_${index}`, "char_cap_rev", index, `v${index}`));
    }

    const stored = await listCharacterRevisions(config, WORKSPACE_A, "char_cap_rev");
    expect(stored).toHaveLength(MAX_REVISIONS_PER_CHARACTER);
    expect(stored[0]?.id).toBe("rev_cap_0");
    expect(stored.at(-1)?.id).toBe(`rev_cap_${MAX_REVISIONS_PER_CHARACTER + 4}`);
  });

  test("revisions belong to one character", async () => {
    await writeRevision(config, WORKSPACE_A, revisionRecord("rev_mine", "char_a_rev", 1, "mine"));

    expect(await listCharacterRevisions(config, WORKSPACE_A, "char_b_rev")).toEqual([]);
  });
});

describe("memories", () => {
  function memoryRecord(id: string, characterId: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      characterId,
      text: "Wren works nights at the harbour.",
      source: "user" as const,
      createdAt: 10,
      updatedAt: 10,
      ...overrides,
    };
  }

  test("a memory survives the session it was learned in", async () => {
    // The entire feature. Memories are keyed per character, so nothing about the
    // conversation they came from can take them with it.
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_1", "char_mem", { sessionId: "ses_old" }));
    await clearSessionBinding(config, WORKSPACE_A, "ses_old");

    const stored = await listCharacterMemories(config, WORKSPACE_A, "char_mem");
    expect(stored.map((entry) => entry.text)).toEqual(["Wren works nights at the harbour."]);
  });

  test("memories belong to one character, not to the workspace", async () => {
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_a", "char_one"));
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_b", "char_two", { text: "Different." }));

    expect(await listCharacterMemories(config, WORKSPACE_A, "char_one")).toHaveLength(1);
    expect((await listCharacterMemories(config, WORKSPACE_A, "char_two"))[0]?.text).toBe("Different.");
  });

  test("memories are listed oldest first", async () => {
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_late", "char_order", { createdAt: 30 }));
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_early", "char_order", { createdAt: 10 }));

    expect((await listCharacterMemories(config, WORKSPACE_A, "char_order")).map((entry) => entry.id)).toEqual([
      "mem_early",
      "mem_late",
    ]);
  });

  test("a rewrite replaces the entry rather than adding a second", async () => {
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_edit", "char_edit"));
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_edit", "char_edit", { text: "Rewritten.", updatedAt: 20 }));

    const stored = await listCharacterMemories(config, WORKSPACE_A, "char_edit");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe("Rewritten.");
  });

  test("forgetting removes the entry outright", async () => {
    // Unlike a character, a memory has nothing pointing at it, so there is no
    // reason to tombstone one — and "forget" that leaves the fact on disk would
    // be a lie about what the button did.
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_gone", "char_forget"));

    expect(await deleteMemory(config, WORKSPACE_A, "mem_gone")).toBe(true);
    expect(await listCharacterMemories(config, WORKSPACE_A, "char_forget")).toEqual([]);
    expect(await deleteMemory(config, WORKSPACE_A, "mem_gone")).toBe(false);
  });

  test("a character's memories are capped, oldest dropped first", async () => {
    for (let index = 0; index < MAX_MEMORIES_PER_CHARACTER + 5; index += 1) {
      await writeMemory(config, WORKSPACE_A, memoryRecord(`mem_cap_${index}`, "char_cap", { createdAt: index }));
    }

    const stored = await listCharacterMemories(config, WORKSPACE_A, "char_cap");
    expect(stored).toHaveLength(MAX_MEMORIES_PER_CHARACTER);
    expect(stored[0]?.id).toBe("mem_cap_5");
  });

  test("memories do not cross workspaces", async () => {
    await writeMemory(config, WORKSPACE_A, memoryRecord("mem_iso", "char_iso"));

    expect(await listCharacterMemories(config, WORKSPACE_B, "char_iso")).toEqual([]);
  });
});

describe("scale", () => {
  test("a 100+ character library stays within the budget that justified the blob store", async () => {
    // The blob-plus-serializer design was chosen over a keyed table on the
    // expectation that libraries this size stay fast. These numbers are the
    // escalation trigger: if they degrade, move to a keyed table before more UI
    // is built on the assumption.
    const workspace = "ws_roleplay_scale";
    const description = "x".repeat(2_000);
    const fixture = Array.from({ length: 120 }, (_, index) => characterRecord(`char_scale_${index}`, `Name ${index}`, description));

    const writeStart = performance.now();
    for (const record of fixture) await writeCharacter(config, workspace, record);
    const writeMs = (performance.now() - writeStart) / fixture.length;

    const listStart = performance.now();
    const listed = await listCharacters(config, workspace);
    const listMs = performance.now() - listStart;

    console.log(`roleplay scale: ${fixture.length} characters, mean write ${writeMs.toFixed(2)}ms, list ${listMs.toFixed(2)}ms`);

    expect(listed).toHaveLength(fixture.length);
    expect(listMs).toBeLessThan(150);
    expect(writeMs).toBeLessThan(150);
  });
});
