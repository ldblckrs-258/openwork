import type { RoleplayMemoryRecord } from "@openwork/types/roleplay";

import { CONTEXTUAL_INJECTION_BUDGET_CHARS, type BudgetedInjection } from "./injection-budget.js";

/**
 * What a character remembers between sessions, and how much of the prompt it is
 * allowed to occupy.
 *
 * The budget is the load-bearing part. Memory grows every session while the
 * character definition does not, so without a ceiling the remembered facts
 * eventually outweigh the character and the model starts reciting history
 * instead of playing someone. That failure arrives gradually and reads as the
 * character going flat, which is exactly the kind of bug nobody files.
 *
 * There are two bounds, and they are different things:
 *
 *   - `MEMORY_BUDGET_CHARS` here, so memory cannot take the whole shared
 *     contextual ceiling and leave the lorebook nothing.
 *   - `CONTEXTUAL_INJECTION_BUDGET_CHARS` in `injection-budget.ts`, which
 *     lorebook and memory are ranked against together.
 *
 * Both are needed: the shared ceiling alone would let whichever source is bigger
 * crowd the other out entirely.
 */

/** Half the shared contextual ceiling. The lorebook is entitled to the rest. */
export const MEMORY_BUDGET_CHARS = Math.floor(CONTEXTUAL_INJECTION_BUDGET_CHARS / 2);

/**
 * One memory is a sentence or two, not an essay.
 *
 * A model asked for "what happened" will happily return three paragraphs, and a
 * single such entry would consume most of the budget on its own. Capping the
 * entry rather than only the total is what keeps recall broad instead of deep.
 */
export const MAX_MEMORY_CHARS = 400;

/**
 * Normalize memory text before it is stored.
 *
 * The card sanitizer does not apply here and pretending otherwise would be
 * theatre: it validates a JSON card object, stripping privilege keys and unknown
 * extension vendors, and a memory is a bare string with none of those. What a
 * string can carry into the prompt is length and layout, so those are what this
 * bounds — newlines collapse because a multi-line entry would otherwise imitate
 * the section headings the compiled prompt uses.
 */
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
  /** Ready to hand to `compilePrompt`'s `memories` option. */
  injections: BudgetedInjection[];
  kept: RoleplayMemoryRecord[];
  dropped: number;
};

/**
 * Choose which memories go into this turn's prompt.
 *
 * Ranked by the two things that predict usefulness without reading the text:
 * a memory the user wrote or explicitly approved the wording of outranks one
 * accepted as-is, and recent outranks old. Ties break toward recent.
 *
 * The `priority` handed back is what `applyContextualInjectionBudget` ranks
 * against the lorebook afterwards, so a memory that survives here can still lose
 * the shared ceiling to a constant lorebook entry — which is correct: world
 * facts the card author marked always-on outrank a conversational detail.
 */
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

  // Oldest first in the prompt, so the character reads its own history in the
  // order it happened rather than in the order this function ranked it.
  const ordered = [...kept].sort((left, right) => left.createdAt - right.createdAt);
  return {
    injections: ordered.map((memory) => ({ text: memory.text, priority: memory.source === "user" ? 1 : 0 })),
    kept: ordered,
    dropped: memories.length - ordered.length,
  };
}
