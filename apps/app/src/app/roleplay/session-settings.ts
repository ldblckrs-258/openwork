import type { RoleplayLorebookRecord, RoleplaySessionSettings } from "@openwork/types/roleplay";

import { COMBINED_SYSTEM_BUDGET_CHARS } from "./compose-system.js";
import { LOREBOOK_BUDGET_CHARS, MAX_SCAN_DEPTH } from "./lorebook.js";
import { MEMORY_BUDGET_CHARS } from "./memory.js";

/**
 * A conversation's own configuration, resolved against the app's defaults.
 *
 * Stored settings hold `undefined` for anything the user has not touched, so a
 * default that changes in a later release reaches conversations that started
 * before it. Resolving is therefore done here, per turn, rather than at the
 * moment a setting is written.
 *
 * Every bound is clamped rather than rejected. These values arrive from a panel
 * the user is dragging, and a number that lands outside the range should snap to
 * the edge, not fail a send mid-conversation.
 */

/**
 * The most either source may claim on its own.
 *
 * Memory and lorebook no longer share one ceiling — the user sets each freely —
 * so this is what stops a single source from consuming the whole system message.
 * The real limit is `COMBINED_SYSTEM_BUDGET_CHARS`, which truncates the composed
 * system string; this leaves room in it for the character itself.
 */
export const MAX_SOURCE_BUDGET_CHARS = 16_000;

/** Long enough for a rewritten roleplay instruction, short enough not to crowd the card. */
export const MAX_SESSION_SYSTEM_PROMPT_CHARS = 4_000;

export type ResolvedSessionSettings = {
  memoryBudgetChars: number;
  lorebookBudgetChars: number;
  /** `undefined` leaves each book's own depth in force. */
  scanDepth: number | undefined;
  disabledLorebookIds: string[];
  /** Empty means the card's `system_prompt`, then the app default, still decide. */
  systemPrompt: string;
  colorSegments: boolean;
};

function clampBudget(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SOURCE_BUDGET_CHARS, Math.max(0, Math.floor(value)));
}

export function resolveSessionSettings(settings: RoleplaySessionSettings | undefined): ResolvedSessionSettings {
  const scanDepth = settings?.scanDepth;
  return {
    memoryBudgetChars: clampBudget(settings?.memoryBudgetChars, MEMORY_BUDGET_CHARS),
    lorebookBudgetChars: clampBudget(settings?.lorebookBudgetChars, LOREBOOK_BUDGET_CHARS),
    scanDepth:
      scanDepth === undefined || !Number.isFinite(scanDepth)
        ? undefined
        : Math.min(MAX_SCAN_DEPTH, Math.max(1, Math.floor(scanDepth))),
    disabledLorebookIds: settings?.disabledLorebookIds ?? [],
    systemPrompt: (settings?.systemPrompt ?? "").slice(0, MAX_SESSION_SYSTEM_PROMPT_CHARS),
    colorSegments: settings?.colorSegments !== false,
  };
}

/** The books this conversation actually scans, in library order. */
export function activeLorebooks(
  books: RoleplayLorebookRecord[],
  disabledIds: string[],
): RoleplayLorebookRecord[] {
  if (disabledIds.length === 0) return books;
  const disabled = new Set(disabledIds);
  return books.filter((book) => !disabled.has(book.id));
}

/**
 * True when the two budgets together leave the character no usable room.
 *
 * Not an error — the send still goes out, and `composeSystem` truncates. It is
 * what the panel warns with, so a user who typed two large numbers learns it
 * from the panel rather than from the character going quiet.
 */
export function budgetsCrowdOutCharacter(settings: ResolvedSessionSettings): boolean {
  return settings.memoryBudgetChars + settings.lorebookBudgetChars > COMBINED_SYSTEM_BUDGET_CHARS / 2;
}
