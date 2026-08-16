import { ApiError } from "../errors.js";
import {
  roleplayCardRevisionSchema,
  roleplayCharacterRecordSchema,
  roleplayLorebookRecordSchema,
  roleplayMemoryRecordSchema,
  roleplayPersonaRecordSchema,
  roleplaySessionBindingSchema,
  roleplayTurnRecordSchema,
  sceneStatePatchSchema,
  roleplaySceneStateSchema,
  applyScenePatch,
  applySceneRestore,
  type RoleplaySceneState,
  type ScenePatchResult,
  type SceneStatePatch,
  type RoleplayCardRevision,
  type RoleplayCharacterRecord,
  type RoleplayLorebookRecord,
  type RoleplayMemoryRecord,
  type RoleplayPersonaRecord,
  type RoleplaySessionBinding,
  type RoleplayTurnRecord,
} from "@openwork/types/roleplay";
import {
  bindSession,
  clearSessionBinding,
  deleteCharacter,
  deleteLorebook,
  deleteMemory,
  deletePersona,
  listCharacterMemories,
  listCharacterRevisions,
  listCharacters,
  listLorebooks,
  listPersonas,
  readCharacter,
  deleteTurns,
  listSessionTurns,
  readSessionBinding,
  updateSceneState,
  writeCharacter,
  writeLorebook,
  writeMemory,
  writePersona,
  writeRevision,
  writeTurn,
} from "../roleplay-store.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

interface RegisterRoleplayRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  resolveWorkspaceWithoutBootstrap: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

function parseCharacter(body: Record<string, unknown>): RoleplayCharacterRecord {
  const parsed = roleplayCharacterRecordSchema.safeParse(body.character);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_character", `Invalid character: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

function parsePersona(body: Record<string, unknown>): RoleplayPersonaRecord {
  const parsed = roleplayPersonaRecordSchema.safeParse(body.persona);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_persona", `Invalid persona: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

function parseBinding(body: Record<string, unknown>): RoleplaySessionBinding {
  const parsed = roleplaySessionBindingSchema.safeParse(body.binding);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_binding", `Invalid session binding: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

function parseTurn(body: Record<string, unknown>): RoleplayTurnRecord {
  const parsed = roleplayTurnRecordSchema.safeParse(body.turn);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_turn", `Invalid turn: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

function parseMemory(body: Record<string, unknown>): RoleplayMemoryRecord {
  const parsed = roleplayMemoryRecordSchema.safeParse(body.memory);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_memory", `Invalid memory: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

function submittedEntryCount(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const entries = Reflect.get(value, "entries");
  return Array.isArray(entries) ? entries.length : 0;
}

function parseLorebook(body: Record<string, unknown>): RoleplayLorebookRecord {
  const parsed = roleplayLorebookRecordSchema.safeParse(body.lorebook);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_lorebook", `Invalid lorebook: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }

  if (submittedEntryCount(body.lorebook) !== parsed.data.entries.length) {
    throw new ApiError(400, "invalid_lorebook_entry", "One or more lorebook entries are invalid");
  }

  return parsed.data;
}

function parseScenePatch(body: Record<string, unknown>): SceneStatePatch {
  const parsed = sceneStatePatchSchema.safeParse(body.patch);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_scene_patch", `Invalid scene patch: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

/**
 * A snapshot to put the scene back to, when the body carries one.
 *
 * Absent for every call the plugin makes: it builds its request body from its own
 * validated arguments, and a restore is not among them. So this shares the
 * route — one queue, one store primitive — without becoming something a model can
 * reach. Undoing a model's write is a thing the app does on the user's behalf,
 * never a thing the model asks for.
 */
function parseSceneRestore(body: Record<string, unknown>): RoleplaySceneState | undefined {
  if (body.restore === undefined) return undefined;
  const parsed = roleplaySceneStateSchema.safeParse(body.restore);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_scene_restore", "Invalid scene snapshot");
  }
  return parsed.data;
}

const EMPTY_SCENE_STATE: RoleplaySceneState = { records: [], revision: 0, updatedAt: 0 };

function parseRevision(body: Record<string, unknown>): RoleplayCardRevision {
  const parsed = roleplayCardRevisionSchema.safeParse(body.revision);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_revision", `Invalid revision: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function registerRoleplayRoutes(options: RegisterRoleplayRoutesOptions): void {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable, requireClientScope, resolveWorkspace, resolveWorkspaceWithoutBootstrap } = options;

  addRoute(routes, "GET", "/workspace/:id/roleplay/characters", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse({ characters: await listCharacters(config, workspace.id) });
  });

  addRoute(routes, "GET", "/workspace/:id/roleplay/characters/:characterId", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    const character = await readCharacter(config, workspace.id, ctx.params.characterId);
    if (!character) throw new ApiError(404, "character_not_found", "Character not found");
    return jsonResponse({ character });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/characters/:characterId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const character = parseCharacter(body);
    if (character.id !== ctx.params.characterId) {
      throw new ApiError(400, "character_id_mismatch", "Character id in the body does not match the path");
    }
    return jsonResponse({ character: await writeCharacter(config, workspace.id, character) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/roleplay/characters/:characterId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const deleted = await deleteCharacter(config, workspace.id, ctx.params.characterId);
    return jsonResponse({ deleted });
  });

  addRoute(routes, "GET", "/workspace/:id/roleplay/personas", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse({ personas: await listPersonas(config, workspace.id) });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/personas/:personaId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const persona = parsePersona(body);
    if (persona.id !== ctx.params.personaId) {
      throw new ApiError(400, "persona_id_mismatch", "Persona id in the body does not match the path");
    }
    return jsonResponse({ persona: await writePersona(config, workspace.id, persona) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/roleplay/personas/:personaId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ deleted: await deletePersona(config, workspace.id, ctx.params.personaId) });
  });

  // A session's binding is what makes it a roleplay session: it is the only
  // thing the send path and the composer gate read to decide that a turn is
  // roleplay rather than ordinary chat.
  addRoute(routes, "GET", "/workspace/:id/roleplay/sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    const state = await readSessionBinding(config, workspace.id, ctx.params.sessionId);
    return jsonResponse({ binding: state?.binding ?? null, character: state?.character ?? null, characterDeleted: state?.characterDeleted ?? false });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/sessions/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const binding = parseBinding(body);
    if (binding.sessionId !== ctx.params.sessionId) {
      throw new ApiError(400, "session_id_mismatch", "Session id in the body does not match the path");
    }
    return jsonResponse({ binding: await bindSession(config, workspace.id, binding) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/roleplay/sessions/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ cleared: await clearSessionBinding(config, workspace.id, ctx.params.sessionId) });
  });

  /**
   * The one write path for scene state, for both of its writers: the plugin tool
   * and the scene panel in the app. One route means one copy of the rules, so a
   * hand edit cannot be permitted something a model's edit is refused.
   *
   * The two are not equal in what they may ask for. `remove` exists in the patch
   * schema and not in the tool's argument schema, so the model cannot express it
   * and a person can. The panel also sends the `revision` it was showing, which
   * is what turns a turn landing on top of a correction into a refusal it can
   * report rather than a silent overwrite.
   *
   * There is no session id in the tool's arguments — it comes from the engine's
   * own `context.sessionID` — so the id in this path is not user-supplied text
   * and cannot be pointed at another conversation by a card.
   *
   * A session with no roleplay binding gets a 404 here, and that is the scoping
   * mechanism for the tool being advertised engine-wide: an ordinary coding
   * session that calls it has no scene to change. A bound session whose state is
   * absent starts from an empty one, because a scene that opened with no
   * authored records still has to be able to gain its first.
   */
  addRoute(routes, "POST", "/workspace/:id/roleplay/sessions/:sessionId/scene-state", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const restore = parseSceneRestore(body);
    const patch = restore ? undefined : parseScenePatch(body);
    const now = Date.now();

    function apply(state: RoleplaySceneState): ScenePatchResult {
      if (restore) return applySceneRestore(state, restore, now);
      return applyScenePatch(state, patch ?? {}, now);
    }

    let outcome: ScenePatchResult | undefined;
    // Applied inside the update cycle, against what is actually stored, so a
    // turn's write and a hand edit cannot each compute against the same state and
    // have the later one silently discard the earlier.
    await updateSceneState(config, workspace.id, ctx.params.sessionId, (current) => {
      const result = apply(current ?? EMPTY_SCENE_STATE);
      outcome = result;
      return result.applied.length === 0 && result.removed.length === 0 ? undefined : result.next;
    });

    if (!outcome) throw new ApiError(404, "session_not_bound", "This session is not a roleplay session");

    return jsonResponse({
      applied: outcome.applied,
      removed: outcome.removed,
      rejected: outcome.rejected,
      revision: outcome.next.revision,
      noop: outcome.noop,
    });
  });

  addRoute(routes, "GET", "/workspace/:id/roleplay/sessions/:sessionId/turns", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse({ turns: await listSessionTurns(config, workspace.id, ctx.params.sessionId) });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/turns/:turnId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const turn = parseTurn(body);
    if (turn.turnId !== ctx.params.turnId) {
      throw new ApiError(400, "turn_id_mismatch", "Turn id in the body does not match the path");
    }
    return jsonResponse({ turn: await writeTurn(config, workspace.id, turn) });
  });

  addRoute(routes, "POST", "/workspace/:id/roleplay/sessions/:sessionId/turns/delete", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const turnIds = Array.isArray(body.turnIds) ? body.turnIds.filter((id): id is string => typeof id === "string") : [];
    return jsonResponse({ deleted: await deleteTurns(config, workspace.id, turnIds) });
  });

  addRoute(routes, "GET", "/workspace/:id/roleplay/characters/:characterId/memories", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse({ memories: await listCharacterMemories(config, workspace.id, ctx.params.characterId) });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/memories/:memoryId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const memory = parseMemory(body);
    if (memory.id !== ctx.params.memoryId) {
      throw new ApiError(400, "memory_id_mismatch", "Memory id in the body does not match the path");
    }
    return jsonResponse({ memory: await writeMemory(config, workspace.id, memory) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/roleplay/memories/:memoryId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ deleted: await deleteMemory(config, workspace.id, ctx.params.memoryId) });
  });

  addRoute(routes, "GET", "/workspace/:id/roleplay/lorebooks", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse({ lorebooks: await listLorebooks(config, workspace.id) });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/lorebooks/:lorebookId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const lorebook = parseLorebook(body);
    if (lorebook.id !== ctx.params.lorebookId) {
      throw new ApiError(400, "lorebook_id_mismatch", "Lorebook id in the body does not match the path");
    }
    return jsonResponse({ lorebook: await writeLorebook(config, workspace.id, lorebook) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/roleplay/lorebooks/:lorebookId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse({ deleted: await deleteLorebook(config, workspace.id, ctx.params.lorebookId) });
  });

  addRoute(routes, "GET", "/workspace/:id/roleplay/characters/:characterId/revisions", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    return jsonResponse({ revisions: await listCharacterRevisions(config, workspace.id, ctx.params.characterId) });
  });

  addRoute(routes, "PUT", "/workspace/:id/roleplay/revisions/:revisionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const revision = parseRevision(body);
    if (revision.id !== ctx.params.revisionId) {
      throw new ApiError(400, "revision_id_mismatch", "Revision id in the body does not match the path");
    }
    return jsonResponse({ revision: await writeRevision(config, workspace.id, revision) });
  });
}
