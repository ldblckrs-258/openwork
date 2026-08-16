/**
 * That makes lost updates the defining hazard — two concurrent read-modify-write
 * cycles silently discard one of them, and the user sees "my edit didn't save"
 * with no error. Every mutation goes through `runQueued`, the same promise-chain
 * serializer `session-groups.ts` uses. Any future writer must go through
 * `updateDocument` too; reaching for `write` directly reintroduces the race.
 */
import type { ZodType } from "zod";
import {
  ROLEPLAY_STORE_SCHEMA_VERSION,
  roleplayCardRevisionSchema,
  roleplayCharacterRecordSchema,
  roleplayLorebookRecordSchema,
  roleplayMemoryRecordSchema,
  roleplayPersonaRecordSchema,
  roleplaySessionBindingSchema,
  roleplayTurnRecordSchema,
  initialSceneState,
  type RoleplayCardRevision,
  type RoleplayCharacterRecord,
  type RoleplayLorebookRecord,
  type RoleplayMemoryRecord,
  type RoleplayPersonaRecord,
  type RoleplaySceneState,
  type RoleplaySessionBinding,
  type RoleplayTurnRecord,
} from "@openwork/types/roleplay";
import { runtimeDbPath } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";
import { createWorkspaceKvStore, isRecord } from "./workspace-kv-store.js";

export const MAX_RETAINED_TURNS_PER_SESSION = 200;

export const MAX_MEMORIES_PER_CHARACTER = 500;

export const MAX_REVISIONS_PER_CHARACTER = 50;

type Document<T> = Record<string, T>;

const updateQueueByKey = new Map<string, Promise<void>>();

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
const turnStore = createDocumentStore("roleplay_turns", "turns_json", roleplayTurnRecordSchema);
const memoryStore = createDocumentStore("roleplay_memories", "memories_json", roleplayMemoryRecordSchema);
const revisionStore = createDocumentStore("roleplay_revisions", "revisions_json", roleplayCardRevisionSchema);
const lorebookStore = createDocumentStore("roleplay_lorebooks", "lorebooks_json", roleplayLorebookRecordSchema);

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

/**
 * Incoming `sceneState` is ignored outright. Every other caller of this route
 * rewrites the whole binding from a copy it read earlier — a persona change, a
 * story-so-far save, the second write that replaces a generated greeting — and
 * that copy can be up to `staleTime` old. Honouring it would let an unrelated
 * settings change roll the scene back to whatever the client last saw. The
 * scene-state route is the only writer; this one only carries state forward.
 */
export async function bindSession(
  config: ServerConfig,
  workspaceId: string,
  binding: RoleplaySessionBinding,
): Promise<RoleplaySessionBinding> {
  const character = await readCharacter(config, workspaceId, binding.characterId);
  const seeded =
    character && character.nsfw && character.sceneRecords.length > 0
      ? initialSceneState(character.sceneRecords, Date.now())
      : undefined;

  // Dropped from the incoming binding rather than overwritten, or a body that
  // carried one would survive the spread whenever there is nothing to replace it
  // with — which is exactly the stale write this function exists to refuse.
  const { sceneState: _ignored, ...withoutScene } = binding;

  return sessionStore.updateDocument(config, workspaceId, (current) => {
    const existing = current[binding.sessionId];
    const carried = existing && existing.characterId === binding.characterId ? existing.sceneState : undefined;
    const sceneState = carried ?? seeded;
    const stored: RoleplaySessionBinding = { ...withoutScene, ...(sceneState ? { sceneState } : {}) };
    const next = { ...current, [binding.sessionId]: stored };
    return { next, result: stored };
  });
}

/**
 * Not a read-then-`bindSession`: that is two trips through the queue with a gap
 * in between, so a turn's tool write and the user's HUD edit can each read the
 * same binding and the second one to finish silently discards the first. Both
 * writers land here, inside one `updateDocument` cycle, which is the race this
 * store's header warns must not be reintroduced.
 *
 * The updater receives the current state so the caller can decide against what it
 * actually finds — a patch is computed against a revision, and returning
 * `undefined` is how a caller declines once it sees the state has moved.
 */
export async function updateSceneState(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
  updater: (current: RoleplaySceneState | undefined) => RoleplaySceneState | undefined,
): Promise<RoleplaySessionBinding | undefined> {
  return sessionStore.updateDocument(config, workspaceId, (current) => {
    const binding = current[sessionId];
    if (!binding) return { next: current, result: undefined };
    const sceneState = updater(binding.sceneState);
    if (sceneState === undefined) return { next: current, result: undefined };
    const updated: RoleplaySessionBinding = { ...binding, sceneState };
    return { next: { ...current, [sessionId]: updated }, result: updated };
  });
}

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
  await pruneSessionTurns(config, workspaceId, sessionId);
  return cleared;
}

export async function writeTurn(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayTurnRecord,
): Promise<RoleplayTurnRecord> {
  return turnStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [record.turnId]: record };
    const stale = Object.values(next)
      .filter((entry) => entry.sessionId === record.sessionId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(MAX_RETAINED_TURNS_PER_SESSION);
    for (const entry of stale) delete next[entry.turnId];
    return { next, result: record };
  });
}

export async function readTurn(
  config: ServerConfig,
  workspaceId: string,
  turnId: string,
): Promise<RoleplayTurnRecord | undefined> {
  return (await turnStore.read(config, workspaceId))[turnId];
}

export async function deleteTurns(
  config: ServerConfig,
  workspaceId: string,
  turnIds: string[],
): Promise<number> {
  if (turnIds.length === 0) return 0;
  return turnStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current };
    let deleted = 0;
    for (const turnId of turnIds) {
      if (!(turnId in next)) continue;
      delete next[turnId];
      deleted += 1;
    }
    return { next, result: deleted };
  });
}

export async function listSessionTurns(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): Promise<RoleplayTurnRecord[]> {
  return Object.values(await turnStore.read(config, workspaceId))
    .filter((entry) => entry.sessionId === sessionId)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function listCharacterMemories(
  config: ServerConfig,
  workspaceId: string,
  characterId: string,
): Promise<RoleplayMemoryRecord[]> {
  return Object.values(await memoryStore.read(config, workspaceId))
    .filter((entry) => entry.characterId === characterId)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/**
 * Only ever called for something a person approved: proposals live in the review
 * UI and never reach here, which is what makes "nothing persists unreviewed" a
 * property of the design rather than of a flag someone has to set correctly.
 */
export async function writeMemory(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayMemoryRecord,
): Promise<RoleplayMemoryRecord> {
  return memoryStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [record.id]: record };
    const stale = Object.values(next)
      .filter((entry) => entry.characterId === record.characterId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(MAX_MEMORIES_PER_CHARACTER);
    for (const entry of stale) delete next[entry.id];
    return { next, result: record };
  });
}

export async function deleteMemory(config: ServerConfig, workspaceId: string, memoryId: string): Promise<boolean> {
  return memoryStore.updateDocument(config, workspaceId, (current) => {
    if (!(memoryId in current)) return { next: current, result: false };
    const next = { ...current };
    delete next[memoryId];
    return { next, result: true };
  });
}

export async function listCharacterRevisions(
  config: ServerConfig,
  workspaceId: string,
  characterId: string,
): Promise<RoleplayCardRevision[]> {
  return Object.values(await revisionStore.read(config, workspaceId))
    .filter((entry) => entry.characterId === characterId)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function writeRevision(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayCardRevision,
): Promise<RoleplayCardRevision> {
  return revisionStore.updateDocument(config, workspaceId, (current) => {
    const next = { ...current, [record.id]: record };
    const mine = Object.values(next)
      .filter((entry) => entry.characterId === record.characterId)
      .sort((left, right) => left.createdAt - right.createdAt);
    const excess = mine.length - MAX_REVISIONS_PER_CHARACTER;
    for (let index = 0; index < excess; index += 1) {
      const victim = mine[index + 1];
      if (victim) delete next[victim.id];
    }
    return { next, result: record };
  });
}

export async function listLorebooks(config: ServerConfig, workspaceId: string): Promise<RoleplayLorebookRecord[]> {
  return Object.values(await lorebookStore.read(config, workspaceId)).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export async function writeLorebook(
  config: ServerConfig,
  workspaceId: string,
  record: RoleplayLorebookRecord,
): Promise<RoleplayLorebookRecord> {
  return lorebookStore.updateDocument(config, workspaceId, (current) => ({
    next: { ...current, [record.id]: record },
    result: record,
  }));
}

export async function deleteLorebook(config: ServerConfig, workspaceId: string, lorebookId: string): Promise<boolean> {
  return lorebookStore.updateDocument(config, workspaceId, (current) => {
    if (!(lorebookId in current)) return { next: current, result: false };
    const next = { ...current };
    delete next[lorebookId];
    return { next, result: true };
  });
}

export async function pruneSessionTurns(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
): Promise<number> {
  return turnStore.updateDocument(config, workspaceId, (current) => {
    const next: Document<RoleplayTurnRecord> = {};
    let pruned = 0;
    for (const [turnId, record] of Object.entries(current)) {
      if (record.sessionId === sessionId) pruned += 1;
      else next[turnId] = record;
    }
    return { next, result: pruned };
  });
}
