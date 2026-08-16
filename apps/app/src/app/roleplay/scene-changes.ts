import type { RoleplaySceneChangeRecord } from "@openwork/types/roleplay";

import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "../types";

export const MAX_RENDERED_SCENE_CHANGES = 8;

export type SceneChangePart = {
  type: string;
  toolName?: string | undefined;
  input?: unknown;
  output?: unknown;
};

export type SceneChangeMessage = {
  id: string;
  role: string;
  parts: SceneChangePart[];
};

type AppliedRecord = { id: string; type: string; name: string; state: string };

function appliedRecords(output: unknown): AppliedRecord[] {
  if (typeof output !== "string" || output === "") return [];
  let payload: unknown;
  try {
    payload = JSON.parse(output) as unknown;
  } catch {
    return [];
  }
  if (typeof payload !== "object" || payload === null) return [];
  if (Reflect.get(payload, "ok") !== true) return [];
  const applied = Reflect.get(payload, "applied");
  if (!Array.isArray(applied)) return [];

  return applied.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const id = Reflect.get(entry, "id");
    if (typeof id !== "string" || !id) return [];
    const read = (key: string) => {
      const value = Reflect.get(entry, key);
      return typeof value === "string" ? value : "";
    };
    return [
      {
        id,
        type: read("type") || "other",
        name: read("name"),
        state: read("state"),
      },
    ];
  });
}

function requestedIds(input: unknown): Set<string> {
  const ids = new Set<string>();
  if (typeof input !== "object" || input === null) return ids;
  const upsert = Reflect.get(input, "upsert");
  if (!Array.isArray(upsert)) return ids;
  for (const entry of upsert) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = Reflect.get(entry, "id");
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

function changesInMessage(
  message: SceneChangeMessage,
  toolName: string,
): RoleplaySceneChangeRecord[] {
  return message.parts
    .filter(
      (part) => part.type === "dynamic-tool" && part.toolName === toolName,
    )
    .flatMap((part) => {
      const requested = requestedIds(part.input);
      return appliedRecords(part.output).map((record) => ({
        id: record.id,
        type: record.type,
        name: record.name,
        state: record.state,
        kind: requested.has(record.id)
          ? ("changed" as const)
          : ("added" as const),
      }));
    });
}

function isVisible(message: SceneChangeMessage, toolName: string): boolean {
  return message.parts.some(
    (part) =>
      part.type !== "step-start" &&
      !(part.type === "dynamic-tool" && part.toolName === toolName),
  );
}

function isSessionError(message: SceneChangeMessage): boolean {
  return message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX);
}

export function sceneChangesByMessage(
  messages: SceneChangeMessage[],
  toolName: string,
): Map<string, RoleplaySceneChangeRecord[]> {
  const byMessage = new Map<string, RoleplaySceneChangeRecord[]>();
  let pending: RoleplaySceneChangeRecord[] = [];
  let anchor: string | null = null;

  const flush = () => {
    if (anchor !== null && pending.length > 0) {
      const latest = new Map(pending.map((record) => [record.id, record]));
      byMessage.set(anchor, [...latest.values()]);
    }
    pending = [];
    anchor = null;
  };

  for (const message of messages) {
    if (message.role !== "assistant") {
      flush();
      continue;
    }

    pending = [...pending, ...changesInMessage(message, toolName)];
    if (isVisible(message, toolName) && !isSessionError(message)) anchor = message.id;
  }
  flush();

  return byMessage;
}
