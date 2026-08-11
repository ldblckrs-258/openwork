import { ApiError } from "../errors.js";
import {
  roleplayCharacterRecordSchema,
  roleplayPersonaRecordSchema,
  roleplaySessionBindingSchema,
  roleplayTurnRecordSchema,
  type RoleplayCharacterRecord,
  type RoleplayPersonaRecord,
  type RoleplaySessionBinding,
  type RoleplayTurnRecord,
} from "@openwork/types/roleplay";
import {
  bindSession,
  clearSessionBinding,
  deleteCharacter,
  deletePersona,
  listCharacters,
  listPersonas,
  readCharacter,
  listSessionTurns,
  readSessionBinding,
  writeCharacter,
  writePersona,
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

/**
 * Reject the record here rather than letting the store throw.
 *
 * The store validates on write too, but that produces a 500 for what is really a
 * bad request. Parsing at the edge also means the client never persists a shape
 * the schema would strip, so what it reads back matches what it sent.
 */
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
    // Tombstoned, not removed, so sessions bound to it stay readable.
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

  // Director text lives in `system`, not in message history, and a regenerate
  // destroys the reply it replaces. Both are why a turn is stored here rather
  // than reconstructed from the transcript.
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
}
