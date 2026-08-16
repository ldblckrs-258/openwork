/**
 * OpenWork Roleplay State Plugin
 *
 * Exposes exactly one tool, `roleplay_state_update`, which is the only way a
 * model can change a roleplay session's scene state.
 *
 * This plugin is the reason the roleplay send path has a hole in it at all. Three
 * things keep that hole the size of one tool:
 *
 *   1. The args schema carries **no session id and no workspace id**. The target
 *      comes from `context.sessionID` alone, so a card that talks the model into
 *      naming another conversation has nothing to name. This removes the class of
 *      bug rather than validating against it.
 *   2. The tool is inert unless `context.agent === "roleplay"`. `plugin[]` is
 *      engine-wide, so this tool is advertised to ordinary coding sessions too;
 *      this is the execution-time half of keeping it out of them.
 *   3. It never computes state. It forwards a patch to the OpenWork server, which
 *      applies it through the one shared validator and writes it through the one
 *      serialized store primitive.
 */
import { z } from "zod";

type ToolContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

const ROLEPLAY_AGENT = "roleplay";

const MAX_CREATES_PER_MESSAGE = 3;
const MAX_TRACKED_MESSAGES = 64;

const MAX_CALLS_PER_MESSAGE = 5;

type MessageBudget = { calls: number; creates: number; counted: Set<string> };

const budgetByMessage = new Map<string, MessageBudget>();

function messageBudget(messageId: string): MessageBudget {
  const existing = budgetByMessage.get(messageId);
  if (existing) return existing;
  if (budgetByMessage.size >= MAX_TRACKED_MESSAGES) {
    const oldest = budgetByMessage.keys().next();
    if (!oldest.done) budgetByMessage.delete(oldest.value);
  }
  const created: MessageBudget = { calls: 0, creates: 0, counted: new Set<string>() };
  budgetByMessage.set(messageId, created);
  return created;
}

const upsertSchema = z.object({
  id: z.string().min(1).max(256).optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  state: z.string().optional(),
  countDelta: z.number().int().optional(),
  description: z.string().optional(),
});

/**
 * What a model may ask for, and it is deliberately narrower than the patch
 * schema the server applies.
 *
 * The shared schema carries a `remove`, for the person reading the scene. This
 * one does not, and the request body below is built from the parse result rather
 * than from the raw arguments — so a removal is not something the model can word
 * its way into, only something it cannot express.
 *
 * Not exported, and nothing else in this file may be either. The engine treats
 * every named export of a plugin module as a plugin factory and calls it, so
 * exporting anything that is not one drops the whole plugin — and the tool with
 * it. The invariant is checked through `execute` instead, which is the path that
 * actually matters.
 */
const argsSchema = z.object({
  upsert: z.array(upsertSchema).max(20).optional(),
});

type Upsert = z.infer<typeof upsertSchema>;

const workspaceSchema = z
  .object({ id: z.string(), name: z.string().optional(), path: z.string().optional(), displayName: z.string().optional() })
  .passthrough();

const workspaceListSchema = z.object({ items: z.array(workspaceSchema) }).passthrough();

const sceneStateResponseSchema = z
  .object({
    applied: z.array(z.record(z.string(), z.unknown())).optional(),
    rejected: z.array(z.string()).optional(),
    revision: z.number().optional(),
    noop: z.boolean().optional(),
  })
  .passthrough();

type OpenWorkWorkspace = z.infer<typeof workspaceSchema>;

function requireOpenWorkServer(): { url: string; token: string } {
  const url = String(process.env.OPENWORK_SERVER_URL || "").replace(/\/$/, "");
  const token = String(process.env.OPENWORK_SERVER_TOKEN || "");
  if (!url || !token) {
    throw new Error("Scene state is only available when OpenCode is launched by OpenWork.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null) return fallback;
  const message = Reflect.get(payload, "message");
  const code = Reflect.get(payload, "code");
  if (typeof message === "string" && message) return message;
  if (typeof code === "string" && code) return code;
  return fallback;
}

async function serverJson(path: string, init?: RequestInit): Promise<unknown> {
  const { url, token } = requireOpenWorkServer();
  const response = await fetch(url + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(payload, `Scene state call failed with HTTP ${response.status}`));
  return payload;
}

function normalizeDirPath(path: string): string {
  return path.replace(/\/+$/, "");
}

async function resolveContextWorkspace(context: ToolContext): Promise<OpenWorkWorkspace> {
  const workspaces = workspaceListSchema.parse(await serverJson("/workspaces")).items;
  if (!workspaces.length) throw new Error("No OpenWork workspaces are available");

  const directory = context.worktree?.trim() || context.directory?.trim();
  if (directory) {
    const dir = normalizeDirPath(directory);
    const match = workspaces
      .filter((workspace) => {
        const path = workspace.path?.trim();
        if (!path) return false;
        const root = normalizeDirPath(path);
        return dir === root || dir.startsWith(`${root}/`);
      })
      .sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))
      .at(0);
    if (match) return match;
  }

  const only = workspaces.at(0);
  if (workspaces.length === 1 && only) return only;
  throw new Error("Could not tell which OpenWork workspace this session belongs to");
}

function spendCall(messageId: string | undefined): boolean {
  if (!messageId) return true;
  const budget = messageBudget(messageId);
  if (budget.calls >= MAX_CALLS_PER_MESSAGE) return false;
  budget.calls += 1;
  return true;
}

function applyMessageBudget(upserts: Upsert[], messageId: string | undefined): { allowed: Upsert[]; rejected: string[] } {
  if (!messageId) return { allowed: upserts, rejected: [] };

  const budget = messageBudget(messageId);
  const allowed: Upsert[] = [];
  const rejected: string[] = [];

  upserts.forEach((upsert, index) => {
    const where = `upsert[${index}]`;

    if (upsert.id === undefined) {
      if (budget.creates >= MAX_CREATES_PER_MESSAGE) {
        rejected.push(`${where}: at most ${MAX_CREATES_PER_MESSAGE} records may be created per reply.`);
        return;
      }
      budget.creates += 1;
      allowed.push(upsert);
      return;
    }

    if (upsert.countDelta !== undefined) {
      if (budget.counted.has(upsert.id)) {
        const { countDelta: _dropped, ...rest } = upsert;
        rejected.push(`${where}: "${upsert.id}" was already counted once this reply; the count was left alone.`);
        if (Object.keys(rest).length > 1) allowed.push(rest);
        return;
      }
      budget.counted.add(upsert.id);
    }

    allowed.push(upsert);
  });

  return { allowed, rejected };
}

const DESCRIPTION = [
  "Record what is about to change in the scene you are playing: a garment, a position, a location, a count, or anything else the scene tracks.",
  "",
  "Call this **before** writing your reply, once, carrying every change that reply will make. After it returns, write the reply. That reply ends your turn — do not call this again in the same turn and do not write a second reply after it.",
  "",
  "Each entry in `upsert` either updates a record or creates one:",
  "- To update, pass the record's `id` exactly as it appears in the Scene State section of your instructions.",
  "- To create, omit `id` and pass a `type`. The id is assigned for you and returned in `applied` — use that id for every later change to that record.",
  "",
  "`type` is a lowercase slug. The scene commonly uses clothes, pose, location, climax, body_parts and toys, but any slug is accepted, so track whatever this scene actually needs. A record's type is fixed once created.",
  "`name` names the specific thing (\"silk blouse\", \"left wrist\") and may be empty for singletons like pose or location. `state` is free text (\"worn\", \"removed\", \"kneeling on the rug\"). `countDelta` moves a counter by one step.",
  "",
  "Anything refused comes back in `rejected` with the reason. Read it and correct the call rather than repeating it.",
].join("\n");

const TURN_NOTE = "Write your reply now. It ends your turn: do not call this tool again in it.";

export const OpenWorkRoleplayState = async () => ({
  tool: {
    roleplay_state_update: {
      description: DESCRIPTION,
      args: argsSchema.shape,
      async execute(rawArgs: unknown, context: ToolContext) {
        try {
          // Advertisement is engine-wide, so this tool is offered in ordinary
          // coding sessions too. This is where those are turned away.
          if (context.agent !== ROLEPLAY_AGENT) {
            return JSON.stringify({ ok: false, error: "Scene state can only be changed from a roleplay session." });
          }

          const sessionId = context.sessionID?.trim();
          if (!sessionId) {
            return JSON.stringify({ ok: false, error: "This call carried no session, so there is no scene to change." });
          }

          const args = argsSchema.parse(rawArgs ?? {});
          const upserts = args.upsert ?? [];
          if (upserts.length === 0) {
            return JSON.stringify({ ok: true, applied: [], rejected: [], noop: true, note: `Nothing was requested, so nothing changed. ${TURN_NOTE}` });
          }

          if (!spendCall(context.messageID)) {
            return JSON.stringify({
              ok: false,
              applied: [],
              rejected: ["This reply has already recorded its scene changes."],
              note: TURN_NOTE,
            });
          }

          const budgeted = applyMessageBudget(upserts, context.messageID);
          if (budgeted.allowed.length === 0) {
            return JSON.stringify({ ok: false, applied: [], rejected: budgeted.rejected, note: TURN_NOTE });
          }

          const workspace = await resolveContextWorkspace(context);
          const payload = sceneStateResponseSchema.parse(
            await serverJson(
              `/workspace/${encodeURIComponent(workspace.id)}/roleplay/sessions/${encodeURIComponent(sessionId)}/scene-state`,
              { method: "POST", body: JSON.stringify({ patch: { upsert: budgeted.allowed } }) },
            ),
          );

          return JSON.stringify({
            ok: true,
            applied: payload.applied ?? [],
            rejected: [...budgeted.rejected, ...(payload.rejected ?? [])],
            revision: payload.revision,
            noop: payload.noop ?? false,
            note: TURN_NOTE,
          });
        } catch (error) {
          // Returned rather than thrown. A rejected promise here reads as a
          // failed turn, and losing the reply because a bookkeeping call failed
          // is far worse than the model being told the bookkeeping failed.
          return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
  },
});
