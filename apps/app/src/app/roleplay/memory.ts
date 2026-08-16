import type { RoleplayMemoryRecord } from "@openwork/types/roleplay";

import { CONTEXTUAL_INJECTION_BUDGET_CHARS, type BudgetedInjection } from "./injection-budget.js";

export const MEMORY_BUDGET_CHARS = Math.floor(CONTEXTUAL_INJECTION_BUDGET_CHARS / 2);

export const MAX_MEMORY_CHARS = 400;

export function sanitizeMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_CHARS);
}

export function createMemoryId(now: number, suffix: string): string {
  return `mem_${now.toString(36)}_${suffix}`;
}

export function createMemory(input: {
  id: string;
  characterId: string;
  text: string;
  source: RoleplayMemoryRecord["source"];
  sessionId?: string;
  now: number;
}): RoleplayMemoryRecord {
  return {
    id: input.id,
    characterId: input.characterId,
    text: sanitizeMemoryText(input.text),
    source: input.source,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function editMemory(memory: RoleplayMemoryRecord, text: string, now: number): RoleplayMemoryRecord {
  return { ...memory, text: sanitizeMemoryText(text), updatedAt: now };
}

export type MemorySelection = {
  injections: BudgetedInjection[];
  kept: RoleplayMemoryRecord[];
  dropped: number;
};

export function selectMemories(
  memories: RoleplayMemoryRecord[],
  budgetChars: number = MEMORY_BUDGET_CHARS,
): MemorySelection {
  const ranked = [...memories].sort((left, right) => {
    if (left.source !== right.source) return left.source === "user" ? -1 : 1;
    return right.createdAt - left.createdAt;
  });

  const kept: RoleplayMemoryRecord[] = [];
  let used = 0;
  for (const memory of ranked) {
    const cost = memory.text.length;
    if (!memory.text || used + cost > budgetChars) continue;
    used += cost;
    kept.push(memory);
  }

  const ordered = [...kept].sort((left, right) => left.createdAt - right.createdAt);
  return {
    injections: ordered.map((memory) => ({ text: memory.text, priority: memory.source === "user" ? 1 : 0 })),
    kept: ordered,
    dropped: memories.length - ordered.length,
  };
}
