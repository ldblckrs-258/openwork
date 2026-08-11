import type { RoleplayLorebookEntry, RoleplayLorebookRecord } from "@openwork/types/roleplay";

import { CONTEXTUAL_INJECTION_BUDGET_CHARS, type BudgetedInjection } from "./injection-budget.js";
import { MEMORY_BUDGET_CHARS } from "./memory.js";

/**
 * Keyword-triggered world knowledge: which lorebook entries this turn earns, and
 * where in the compiled prompt they land.
 *
 * Pure over the books and the recent transcript. Nothing here reads the clock,
 * the store, or the network, which is what lets a swipe replay a turn against the
 * same injections it originally ran with.
 *
 * The trace is not debug decoration. Lorebooks are notoriously hard to reason
 * about in every tool that has them — an entry silently fails to fire and the
 * author has no way to tell whether the key missed, the entry was disabled, or
 * the budget evicted it. Every candidate leaves a trace line saying which.
 */

/** The lorebook's share of the shared contextual ceiling. Memory is entitled to the rest. */
export const LOREBOOK_BUDGET_CHARS = CONTEXTUAL_INJECTION_BUDGET_CHARS - MEMORY_BUDGET_CHARS;

/**
 * Messages scanned for keys when the book does not say.
 *
 * Deep enough that a subject mentioned an exchange or two ago still fires, shallow
 * enough that a topic the scene has moved on from stops paying for itself.
 */
export const DEFAULT_SCAN_DEPTH = 4;

export const MAX_SCAN_DEPTH = 50;

/** Scanned text is capped independently of depth, since one message can be enormous. */
export const MAX_SCAN_CHARS = 20_000;

/**
 * How many times injected content may itself trigger further entries.
 *
 * Recursive scanning is unbounded by construction — an entry that mentions a term
 * from another entry that mentions a term from the first will activate forever.
 * The cap is what makes it terminate; the budget alone would not, because a cycle
 * between two small entries never fills it.
 */
export const MAX_RECURSION_ROUNDS = 3;

/**
 * A book's `token_budget` is in tokens; this module measures characters, for the
 * same reason `injection-budget.ts` does. Four characters per token is the usual
 * English approximation, and it is applied only to *lower* the app's own ceiling
 * — a file asking for a bigger share than the prompt has cannot have one.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Regex keys come from files strangers wrote, so a pathological pattern is an
 * expected input rather than a surprise. Both the pattern and the text it runs
 * against are bounded; that turns the worst case into a slow turn rather than a
 * frozen renderer. It is a mitigation, not a proof — a catastrophic pattern can
 * still be slow within these bounds.
 */
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
  /** The entry's own label, falling back to its comment, then its first key. */
  label: string;
  included: boolean;
  reason: LorebookInclusionReason | LorebookExclusionReason;
  /** The key that fired, when one did. */
  matchedKey?: string;
  /** The secondary key that satisfied `selective`, when the entry required one. */
  matchedSecondaryKey?: string;
  /** 0 for the first scan of real history, 1+ for entries triggered by injected content. */
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
  /** Injections for the slot ahead of the character definition. */
  before: BudgetedInjection[];
  /** Injections for the slot after it. */
  after: BudgetedInjection[];
  matches: LorebookMatch[];
  trace: LorebookTraceLine[];
  charsUsed: number;
  dropped: number;
};

export type SelectLorebookOptions = {
  budgetChars?: number;
  /** Overrides every book's own `scanDepth`. For the editor's preview, which scans what the user chose. */
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

/**
 * The text keys are matched against.
 *
 * Taken from the end: the recent turns are what "scan depth" means, and a long
 * opening message must not be able to keep firing keys for the rest of the
 * conversation just by being first.
 */
function scanText(messages: LorebookScanMessage[], depth: number): string {
  const recent = messages.slice(-depth).map((message) => message.text).join("\n");
  return recent.length > MAX_SCAN_CHARS ? recent.slice(-MAX_SCAN_CHARS) : recent;
}

/**
 * Build a key matcher.
 *
 * A regex key that will not compile falls back to a literal match rather than
 * being dropped. Dropping it would silently disable an entry the author believes
 * is live, which is the failure this whole module is trying to make visible.
 */
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
    } catch {
      // Falls through to the literal matcher below.
    }
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

/**
 * Priorities the shared contextual budget ranks lorebook against memory with.
 *
 * A `constant` entry is world knowledge the author marked always-on, so it
 * outranks both keyed lore and every memory. A keyed entry fired because the
 * scene is about it right now, which outranks a memory that may be about
 * anything — see `memory.ts`, where user memories carry 1 and extracted ones 0.
 */
const CONSTANT_PRIORITY = 3;
const KEYED_PRIORITY = 2;

function positionOf(entry: RoleplayLorebookEntry): LorebookPosition {
  return entry.position === "before_char" ? "before_char" : "after_char";
}

/**
 * Choose which lorebook entries go into this turn's prompt.
 *
 * Order of operations, and why:
 *
 * 1. `constant` entries activate unconditionally, then keyed entries are matched
 *    against the recent transcript.
 * 2. Whatever activated joins the scanned text and the keyed pass runs again, for
 *    books that asked for recursive scanning, up to a hard round cap.
 * 3. Survivors are sorted by `insertion_order` — the spec's own placement rule,
 *    where lower sits earlier in the prompt.
 * 4. Budget is enforced last, evicting by the entry's `priority` (the spec's
 *    stated eviction key) rather than by the placement order, so a low-priority
 *    entry that happens to sort first cannot starve the rest.
 */
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

  // Seeded with the constants, so a book whose keyed entries all miss can still
  // have its always-on world knowledge trigger the entries that depend on it.
  let injected = [...activated.keys()].map((candidate) => candidate.entry.content).join("\n");

  for (let round = 0; round <= MAX_RECURSION_ROUNDS; round += 1) {
    const activatedThisRound: Candidate[] = [];

    for (const candidate of pending) {
      // Round 0 scans real history at each book's own depth. Later rounds scan
      // history plus what has been injected so far, and only for books that
      // asked for recursion.
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
          // Not recorded yet: a later recursion round may still satisfy it, and
          // the final exclusion pass below writes the line once.
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
  // Only books that declared a budget get a per-book cap. Giving the rest the
  // whole ceiling as their own cap would be harmless arithmetically but would
  // report every eviction as the book's doing, when it was the app's.
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

/** Unique within its book, which is all a trace line or an editor row needs. */
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

/**
 * Turn an engine transcript into the text keys are matched against.
 *
 * Both roles are scanned, not just the user's: a place or person the character
 * itself introduced is exactly the kind of thing a lorebook entry exists to
 * expand on, and scanning only the user's side would leave those entries dead.
 */
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

/** Books attached to a character, in the order the library lists them. */
export function lorebooksForCharacter(
  books: RoleplayLorebookRecord[],
  characterId: string,
): RoleplayLorebookRecord[] {
  return books.filter((book) => book.characterIds.includes(characterId));
}
