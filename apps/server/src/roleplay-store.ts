/**
 * Local, per-workspace storage for roleplay characters, personas, session
 * bindings, and per-turn composer blocks.
 *
 * `createWorkspaceKvStore` is a one-document-per-workspace blob store, not a
 * keyed table: the table is keyed by `workspace_id` alone and carries a single
 * JSON value column. Each store below therefore holds a whole map-shaped
 * document that is deserialized on every read and rewritten on every write.
 *
 * That makes lost updates the defining hazard — two concurrent read-modify-write
 * cycles silently discard one of them, and the user sees "my edit didn't save"
 * with no error. Every mutation goes through `runQueued`, the same promise-chain
 * serializer `session-groups.ts` uses. Any future writer must go through
 * `updateDocument` too; reaching for `write` directly reintroduces the race.
 */
import type { ZodType } from "zod";
import {
  ROLEPLAY_STORE_SCHEMA_VERSION,
  roleplayCharacterRecordSchema,
  roleplayMessageBlocksRecordSchema,
  roleplayPersonaRecordSchema,
  roleplaySessionBindingSchema,
  type RoleplayBlock,
  type RoleplayCharacterRecord,
  type RoleplayMessageBlocksRecord,
  type RoleplayPersonaRecord,
  type RoleplaySessionBinding,
} from "@openwork/types/roleplay";
import { runtimeDbPath } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";
import { createWorkspaceKvStore, isRecord } from "./workspace-kv-store.js";

/** Retained composer turns per session. Blocks grow with conversation length and are never read in bulk. */
export const MAX_RETAINED_TURNS_PER_SESSION = 200;

type Document<T> = Record<string, T>;

const updateQueueByKey = new Map<string, Promise<void>>();

/**
 * Serialize a mutation against one store document.
 *
 * Copied deliberately from `session-groups.ts:125-140` rather than redesigned —
 * it is the only proven concurrency pattern for this blob store in this repo.
 */
async function runQueued<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = updateQueueByKey.get(key) ?? Promise.resolve();
  let release = () => {};
  const queued = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentQueue = previous.then(() => queued, () => queued);
  updateQueueByKey.set(key, currentQueue);

  await previous.catch(() => undefined);
  try {
    return await job();
  } finally {
    release();
    if (updateQueueByKey.get(key) === currentQueue) updateQueueByKey.delete(key);
  }
}

/**
 * Ids that would mutate the document's prototype rather than becoming own keys.
 * `JSON.parse` produces an own `__proto__` key, but bracket-assigning it invokes
 * the inherited setter instead.
 */
const PROTOTYPE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

function assign<T>(document: Document<T>, id: string, value: T): void {
  Object.defineProperty(document, id, { value, enumerable: true, writable: true, configurable: true });
}

function parseDocument<T>(json: string, schema: ZodType<T>): Document<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};

  const document: Document<T> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (PROTOTYPE_KEYS.includes(id)) continue;
    const parsed = schema.safeParse(value);
    // One corrupt entry must not take the whole workspace's characters with it.
    if (parsed.success) assign(document, id, parsed.data);
  }
  return document;
}

/**
 * Re-validate every record before it is written.
 *
 * The schemas are allow-lists, so this is what actually keeps privilege-bearing
 * keys off disk when a caller reaches the store without going through the import
 * sanitizer. A record that fails validation is a caller bug, not untrusted input,
 * so it throws rather than being silently dropped — losing a character quietly is
 * worse than a failed save the user can see.
 */
function validateDocument<T>(document: Document<T>, schema: ZodType<T>): Document<T> {
  const validated: Document<T> = {};
  for (const [id, value] of Object.entries(document)) {
    if (PROTOTYPE_KEYS.includes(id)) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Refusing to persist an invalid roleplay record "${id}": ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    }
    assign(validated, id, parsed.data);
  }
  return validated;
}

function createDocumentStore<T>(tableName: string, valueColumn: string, schema: ZodType<T>) {
  const store = createWorkspaceKvStore<Document<T>>({
    tableName,
    valueColumn,
    extraColumns: {
      schemaVersion: {
        name: "schema_version",
        definition: "INTEGER NOT NULL DEFAULT 1",
        value: ROLEPLAY_STORE_SCHEMA_VERSION,
      },
    },
    parse: (json) => parseDocument(json, schema),
    // Validate on the way out, not only on the way back in. Filtering on read
    // alone still lets an unsanitized record sit on disk in plain text, where
    // anything reading the database directly — a backup, a support bundle, a
    // migration script — would find the very keys the import sanitizer removed.
    serialize: (value) => JSON.stringify(validateDocument(value, schema)),
  });

  async function read(config: ServerConfig, workspaceId: string): Promise<Document<T>> {
    return (await store.get(config, workspaceId)) ?? {};
  }

  async function updateDocument<R>(
    config: ServerConfig,
    workspaceId: string,
    updater: (current: Document<T>) => { next: Document<T>; result: R },
  ): Promise<R> {
    const key = `${runtimeDbPath(config)}:${workspaceId}:${tableName}`;
    return runQueued(key, async () => {
      const current = await read(config, workspaceId);
      const { next, result } = updater(current);
      await store.set(config, workspaceId, next, Date.now());
      return result;
    });
  }

  return { read, updateDocument };
}

const characterStore = createDocumentStore("roleplay_characters", "characters_json", roleplayCharacterRecordSchema);
const personaStore = createDocumentStore("roleplay_personas", "personas_json", roleplayPersonaRecordSchema);
const sessionStore = createDocumentStore("roleplay_sessions", "sessions_json", roleplaySessionBindingSchema);
const messageBlockStore = createDocumentStore("roleplay_message_blocks", "blocks_json", roleplayMessageBlocksRecordSchema);

export async function listCharacters(config: ServerConfig, workspaceId: string): Promise<RoleplayCharacterRecord[]> {
  const document = await characterStore.read(config, workspaceId);
  return Object.values(document)
    .filter((record) => record.deletedAt === undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function readCharacter(
  config: ServerConfig,
  workspaceId: string,
  characterId: string,
): Promise<RoleplayCharacterRecord | undefined> {
  return (await characterStore.read(config, workspaceId))[characterId];
}

export async function writeCharacter(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayCharacterRecord,
): Promise<RoleplayCharacterRecord> {
  return characterStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [record.id]: record };
    return { next, result: record };
  });
}

/**
 * Tombstone a character rather than removing it.
 *
 * Sessions bound to it must stay readable, and their transcript still needs the
 * character's name and avatar to render. A hard delete would leave those
 * sessions pointing at nothing.
 */
export async function deleteCharacter(
  config: ServerConfig,
  workspaceId: string,
  characterId: string,
  deletedAt = Date.now(),
): Promise<boolean> {
  return characterStore.updateDocument(config, workspaceId, (current) => {
    const existing = current[characterId];
    if (!existing || existing.deletedAt !== undefined) return { next: current, result: false };
    const next = { ...current, [characterId]: { ...existing, deletedAt, updatedAt: deletedAt } };
    return { next, result: true };
  });
}

export async function listPersonas(config: ServerConfig, workspaceId: string): Promise<RoleplayPersonaRecord[]> {
  const document = await personaStore.read(config, workspaceId);
  return Object.values(document).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function writePersona(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayPersonaRecord,
): Promise<RoleplayPersonaRecord> {
  return personaStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [record.id]: record };
    return { next, result: record };
  });
}

export async function deletePersona(config: ServerConfig, workspaceId: string, personaId: string): Promise<boolean> {
  return personaStore.updateDocument(config, workspaceId, (current) => {
    if (!(personaId in current)) return { next: current, result: false };
    const next = { ...current };
    delete next[personaId];
    return { next, result: true };
  });
}

export type SessionBindingState = {
  binding: RoleplaySessionBinding;
  character: RoleplayCharacterRecord | undefined;
  characterDeleted: boolean;
};

export async function bindSession(
  config: ServerConfig,
  workspaceId: string,
  binding: RoleplaySessionBinding,
): Promise<RoleplaySessionBinding> {
  return sessionStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [binding.sessionId]: binding };
    return { next, result: binding };
  });
}

/**
 * Read a session's binding together with the character it points at.
 *
 * `characterDeleted` is what the chat surface renders its "character deleted"
 * state from; the binding itself is never cleared, so the conversation stays
 * readable.
 */
export async function readSessionBinding(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): Promise<SessionBindingState | undefined> {
  const binding = (await sessionStore.read(config, workspaceId))[sessionId];
  if (!binding) return undefined;
  const character = await readCharacter(config, workspaceId, binding.characterId);
  return { binding, character, characterDeleted: character === undefined || character.deletedAt !== undefined };
}

export async function clearSessionBinding(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): Promise<boolean> {
  const cleared = await sessionStore.updateDocument(config, workspaceId, (current) => {
    if (!(sessionId in current)) return { next: current, result: false };
    const next = { ...current };
    delete next[sessionId];
    return { next, result: true };
  });
  await pruneSessionMessageBlocks(config, workspaceId, sessionId);
  return cleared;
}

export async function writeMessageBlocks(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayMessageBlocksRecord,
): Promise<RoleplayMessageBlocksRecord> {
  return messageBlockStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [record.messageId]: record };
    const retained = Object.values(next)
      .filter((entry) => entry.sessionId === record.sessionId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(MAX_RETAINED_TURNS_PER_SESSION);
    for (const stale of retained) delete next[stale.messageId];
    return { next, result: record };
  });
}

export async function readMessageBlocks(
  config: ServerConfig,
  workspaceId: string,
  messageId: string,
): Promise<RoleplayBlock[] | undefined> {
  return (await messageBlockStore.read(config, workspaceId))[messageId]?.blocks;
}

export async function pruneSessionMessageBlocks(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): Promise<number> {
  return messageBlockStore.updateDocument(config, workspaceId, (current) => {
    const next: Document<RoleplayMessageBlocksRecord> = {};
    let pruned = 0;
    for (const [messageId, record] of Object.entries(current)) {
      if (record.sessionId === sessionId) pruned += 1;
      else next[messageId] = record;
    }
    return { next, result: pruned };
  });
}
