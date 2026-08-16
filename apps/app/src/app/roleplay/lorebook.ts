import type { RoleplayLorebookEntry, RoleplayLorebookRecord } from "@openwork/types/roleplay";

import { CONTEXTUAL_INJECTION_BUDGET_CHARS, type BudgetedInjection } from "./injection-budget.js";
import { MEMORY_BUDGET_CHARS } from "./memory.js";

export const LOREBOOK_BUDGET_CHARS = CONTEXTUAL_INJECTION_BUDGET_CHARS - MEMORY_BUDGET_CHARS;

export const DEFAULT_SCAN_DEPTH = 4;

export const MAX_SCAN_DEPTH = 50;

export const MAX_SCAN_CHARS = 20_000;

export const MAX_RECURSION_ROUNDS = 3;

export const CHARS_PER_TOKEN = 4;

export const MAX_REGEX_PATTERN_CHARS = 256;

export type LorebookScanMessage = {
  role: "user" | "assistant";
  text: string;
};

export type LorebookPosition = "before_char" | "after_char";

export type LorebookInclusionReason = "constant" | "key" | "recursive";

export type LorebookExclusionReason =
  | "disabled"
  | "empty"
  | "no_key_match"
  | "selective_unmet"
  | "book_budget"
  | "budget";

export type LorebookTraceLine = {
  bookId: string;
  bookName: string;
  uid: string;
  label: string;
  included: boolean;
  reason: LorebookInclusionReason | LorebookExclusionReason;
  matchedKey?: string;
  matchedSecondaryKey?: string;
  round?: number;
  chars: number;
};

export type LorebookMatch = {
  bookId: string;
  uid: string;
  position: LorebookPosition;
  text: string;
  insertionOrder: number;
  reason: LorebookInclusionReason;
};

export type LorebookSelection = {
  before: BudgetedInjection[];
  after: BudgetedInjection[];
  matches: LorebookMatch[];
  trace: LorebookTraceLine[];
  charsUsed: number;
  dropped: number;
};

export type SelectLorebookOptions = {
  budgetChars?: number;
  scanDepth?: number;
};

type Candidate = {
  book: RoleplayLorebookRecord;
  entry: RoleplayLorebookEntry;
  order: number;
};

function label(entry: RoleplayLorebookEntry): string {
  return entry.name?.trim() || entry.comment?.trim() || entry.keys[0] || entry.uid;
}

function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return DEFAULT_SCAN_DEPTH;
  return Math.min(MAX_SCAN_DEPTH, Math.max(1, Math.floor(depth)));
}

function scanText(messages: LorebookScanMessage[], depth: number): string {
  const recent = messages.slice(-depth).map((message) => message.text).join("\n");
  return recent.length > MAX_SCAN_CHARS ? recent.slice(-MAX_SCAN_CHARS) : recent;
}

function matcher(key: string, caseSensitive: boolean, useRegex: boolean): (haystack: string) => boolean {
  const trimmed = key.trim();
  if (!trimmed) return () => false;

  if (useRegex && trimmed.length <= MAX_REGEX_PATTERN_CHARS) {
    const delimited = /^\/(.+)\/([a-z]*)$/i.exec(trimmed);
    const source = delimited?.[1] ?? trimmed;
    const flags = delimited?.[2] ?? "";
    const withCase = caseSensitive || flags.includes("i") ? flags.replace("g", "") : `${flags.replace("g", "")}i`;
    try {
      const expression = new RegExp(source, withCase);
      return (haystack) => expression.test(haystack);
    } catch {}
  }

  if (caseSensitive) return (haystack) => haystack.includes(trimmed);
  const needle = trimmed.toLowerCase();
  return (haystack) => haystack.toLowerCase().includes(needle);
}

function firstMatch(keys: string[], haystack: string, caseSensitive: boolean, useRegex: boolean): string | undefined {
  for (const key of keys) {
    if (matcher(key, caseSensitive, useRegex)(haystack)) return key;
  }
  return undefined;
}

const CONSTANT_PRIORITY = 3;
const KEYED_PRIORITY = 2;

function positionOf(entry: RoleplayLorebookEntry): LorebookPosition {
  return entry.position === "before_char" ? "before_char" : "after_char";
}

export function selectLorebookEntries(
  books: RoleplayLorebookRecord[],
  messages: LorebookScanMessage[],
  options: SelectLorebookOptions = {},
): LorebookSelection {
  const trace: LorebookTraceLine[] = [];
  const candidates: Candidate[] = [];
  let order = 0;

  for (const book of books) {
    for (const entry of book.entries) {
      const line = { bookId: book.id, bookName: book.name, uid: entry.uid, label: label(entry), chars: entry.content.length };
      if (entry.enabled === false) {
        trace.push({ ...line, included: false, reason: "disabled" });
        continue;
      }
      if (!entry.content.trim()) {
        trace.push({ ...line, included: false, reason: "empty" });
        continue;
      }
      candidates.push({ book, entry, order: order++ });
    }
  }

  const activated = new Map<Candidate, { reason: LorebookInclusionReason; matchedKey?: string; matchedSecondaryKey?: string; round: number }>();
  const pending = new Set(candidates);

  for (const candidate of [...pending]) {
    if (candidate.entry.constant === true) {
      activated.set(candidate, { reason: "constant", round: 0 });
      pending.delete(candidate);
    }
  }

  const scanFor = (candidate: Candidate) =>
    scanText(messages, clampDepth(options.scanDepth ?? candidate.book.scanDepth));

  let injected = [...activated.keys()].map((candidate) => candidate.entry.content).join("\n");

  for (let round = 0; round <= MAX_RECURSION_ROUNDS; round += 1) {
    const activatedThisRound: Candidate[] = [];

    for (const candidate of pending) {
      if (round > 0 && candidate.book.recursiveScanning !== true) continue;
      const { entry } = candidate;
      const text = round === 0 ? scanFor(candidate) : `${scanFor(candidate)}\n${injected}`;
      const caseSensitive = entry.case_sensitive === true;
      const useRegex = entry.use_regex === true;

      const matchedKey = firstMatch(entry.keys, text, caseSensitive, useRegex);
      if (matchedKey === undefined) continue;

      const secondaries = entry.selective === true ? (entry.secondary_keys ?? []) : [];
      if (entry.selective === true && secondaries.length > 0) {
        const matchedSecondaryKey = firstMatch(secondaries, text, caseSensitive, useRegex);
        if (matchedSecondaryKey === undefined) {
          continue;
        }
        activated.set(candidate, { reason: round === 0 ? "key" : "recursive", matchedKey, matchedSecondaryKey, round });
      } else {
        activated.set(candidate, { reason: round === 0 ? "key" : "recursive", matchedKey, round });
      }
      activatedThisRound.push(candidate);
    }

    for (const candidate of activatedThisRound) pending.delete(candidate);
    if (!books.some((book) => book.recursiveScanning === true)) break;
    if (activatedThisRound.length === 0 && (round > 0 || injected === "")) break;
    injected = [injected, ...activatedThisRound.map((candidate) => candidate.entry.content)].filter(Boolean).join("\n");
  }

  for (const candidate of pending) {
    const { entry } = candidate;
    const selectiveUnmet =
      entry.selective === true &&
      (entry.secondary_keys ?? []).length > 0 &&
      firstMatch(entry.keys, scanFor(candidate), entry.case_sensitive === true, entry.use_regex === true) !== undefined;
    trace.push({
      bookId: candidate.book.id,
      bookName: candidate.book.name,
      uid: entry.uid,
      label: label(entry),
      included: false,
      reason: selectiveUnmet ? "selective_unmet" : "no_key_match",
      chars: entry.content.length,
    });
  }

  const ordered = [...activated.keys()].sort((left, right) => {
    const byOrder = left.entry.insertion_order - right.entry.insertion_order;
    return byOrder !== 0 ? byOrder : left.order - right.order;
  });

  const budget = options.budgetChars ?? LOREBOOK_BUDGET_CHARS;
  const bookBudgets = new Map<string, number>();
  for (const book of books) {
    if (book.tokenBudget === undefined) continue;
    bookBudgets.set(book.id, Math.min(budget, Math.max(0, Math.floor(book.tokenBudget * CHARS_PER_TOKEN))));
  }

  const evictionOrder = [...ordered].sort((left, right) => {
    const byPriority = (right.entry.priority ?? 0) - (left.entry.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    const byOrder = left.entry.insertion_order - right.entry.insertion_order;
    return byOrder !== 0 ? byOrder : left.order - right.order;
  });

  const kept = new Set<Candidate>();
  const bookUsed = new Map<string, number>();
  let charsUsed = 0;
  for (const candidate of evictionOrder) {
    const cost = candidate.entry.content.length;
    const usedForBook = bookUsed.get(candidate.book.id) ?? 0;
    const bookBudget = bookBudgets.get(candidate.book.id) ?? Number.POSITIVE_INFINITY;
    const detail = activated.get(candidate);
    const line = {
      bookId: candidate.book.id,
      bookName: candidate.book.name,
      uid: candidate.entry.uid,
      label: label(candidate.entry),
      chars: cost,
    };
    if (usedForBook + cost > bookBudget) {
      trace.push({ ...line, included: false, reason: "book_budget" });
      continue;
    }
    if (charsUsed + cost > budget) {
      trace.push({ ...line, included: false, reason: "budget" });
      continue;
    }
    bookUsed.set(candidate.book.id, usedForBook + cost);
    charsUsed += cost;
    kept.add(candidate);
    trace.push({
      ...line,
      included: true,
      reason: detail?.reason ?? "key",
      ...(detail?.matchedKey ? { matchedKey: detail.matchedKey } : {}),
      ...(detail?.matchedSecondaryKey ? { matchedSecondaryKey: detail.matchedSecondaryKey } : {}),
      round: detail?.round ?? 0,
    });
  }

  const matches: LorebookMatch[] = ordered
    .filter((candidate) => kept.has(candidate))
    .map((candidate) => ({
      bookId: candidate.book.id,
      uid: candidate.entry.uid,
      position: positionOf(candidate.entry),
      text: candidate.entry.content,
      insertionOrder: candidate.entry.insertion_order,
      reason: activated.get(candidate)?.reason ?? "key",
    }));

  const toInjection = (match: LorebookMatch): BudgetedInjection => ({
    text: match.text,
    priority: match.reason === "constant" ? CONSTANT_PRIORITY : KEYED_PRIORITY,
  });

  return {
    before: matches.filter((match) => match.position === "before_char").map(toInjection),
    after: matches.filter((match) => match.position === "after_char").map(toInjection),
    matches,
    trace,
    charsUsed,
    dropped: activated.size - kept.size,
  };
}

export function createLorebookId(now: number, suffix: string): string {
  return `lore_${now.toString(36)}_${suffix}`;
}

export function createLorebookEntryUid(now: number, suffix: string): string {
  return `lbe_${now.toString(36)}_${suffix}`;
}

export function createBlankLorebookEntry(uid: string, insertionOrder: number): RoleplayLorebookEntry {
  return { uid, keys: [], content: "", extensions: {}, enabled: true, insertion_order: insertionOrder };
}

export function createBlankLorebook(id: string, now: number): RoleplayLorebookRecord {
  return {
    id,
    name: "",
    description: "",
    entries: [],
    characterIds: [],
    source: "authored",
    createdAt: now,
    updatedAt: now,
  };
}

type TranscriptPart = { type: string; text?: string };
type TranscriptMessage = { info: { role: string }; parts?: TranscriptPart[] };

export function toScanMessages(messages: TranscriptMessage[]): LorebookScanMessage[] {
  return messages
    .filter((message) => message.info.role === "user" || message.info.role === "assistant")
    .map((message) => ({
      role: message.info.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: (message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join(""),
    }))
    .filter((message) => message.text.trim() !== "");
}

export function lorebooksForCharacter(
  books: RoleplayLorebookRecord[],
  characterId: string,
): RoleplayLorebookRecord[] {
  return books.filter((book) => book.characterIds.includes(characterId));
}
