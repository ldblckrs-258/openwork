import type {
  CharacterBook,
  RoleplayLorebookEntry,
  RoleplayLorebookRecord,
} from "@openwork/types/roleplay";

import { decodeCardFromPng } from "./png-codec.js";
import { sanitizeLorebookEntries } from "./sanitize-card.js";

export type LorebookImportFormat = "character_book" | "sillytavern" | "novelai" | "agnai" | "risuai";

export type ImportedLorebook = {
  name: string;
  description: string;
  scanDepth?: number;
  tokenBudget?: number;
  recursiveScanning?: boolean;
  entries: RoleplayLorebookEntry[];
};

export type LorebookImportSuccess = {
  ok: true;
  format: LorebookImportFormat;
  book: ImportedLorebook;
  losses: string[];
};

export type LorebookImportFailure = { ok: false; message: string };

export type LorebookImportResult = LorebookImportSuccess | LorebookImportFailure;

export const LOREBOOK_FORMAT_LABELS: Record<LorebookImportFormat, string> = {
  character_book: "Character card lorebook",
  sillytavern: "SillyTavern world info",
  novelai: "NovelAI lorebook",
  agnai: "Agnai memory book",
  risuai: "RisuAI lorebook",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((key) => key.trim()).filter(Boolean);
  return [];
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function entryUid(index: number): string {
  return `lbe_${index}`;
}

type EntryDraft = {
  keys: string[];
  content: string;
  extensions?: Record<string, unknown>;
  name?: string;
  comment?: string;
  enabled?: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  priority?: number;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: "before_char" | "after_char";
  use_regex?: boolean;
};

function toEntry(draft: EntryDraft, index: number): RoleplayLorebookEntry {
  return {
    uid: entryUid(index),
    keys: draft.keys,
    content: draft.content,
    extensions: draft.extensions ?? {},
    enabled: draft.enabled ?? true,
    insertion_order: draft.insertion_order ?? index,
    ...(draft.case_sensitive === undefined ? {} : { case_sensitive: draft.case_sensitive }),
    ...(draft.name ? { name: draft.name } : {}),
    ...(draft.priority === undefined ? {} : { priority: draft.priority }),
    ...(draft.comment ? { comment: draft.comment } : {}),
    ...(draft.selective === undefined ? {} : { selective: draft.selective }),
    ...(draft.secondary_keys?.length ? { secondary_keys: draft.secondary_keys } : {}),
    ...(draft.constant === undefined ? {} : { constant: draft.constant }),
    ...(draft.position === undefined ? {} : { position: draft.position }),
    ...(draft.use_regex === undefined ? {} : { use_regex: draft.use_regex }),
  };
}

function noteUnsupported(seen: Set<string>, source: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    if (field in source && source[field] !== undefined && source[field] !== null) seen.add(field);
  }
}

function unsupportedLoss(seen: Set<string>, what: string): string[] {
  if (seen.size === 0) return [];
  return [`${what} this app does not use were ignored: ${[...seen].sort().join(", ")}.`];
}

const ST_POSITION_BEFORE = 0;
const ST_POSITION_AFTER = 1;

function stPosition(value: unknown, losses: Set<string>): "before_char" | "after_char" | undefined {
  const position = num(value);
  if (position === undefined) return undefined;
  if (position === ST_POSITION_BEFORE) return "before_char";
  if (position === ST_POSITION_AFTER) return "after_char";
  losses.add("position");
  return "after_char";
}

const ST_UNSUPPORTED = [
  "probability",
  "useProbability",
  "depth",
  "role",
  "sticky",
  "cooldown",
  "delay",
  "group",
  "groupOverride",
  "groupWeight",
  "vectorized",
  "matchWholeWords",
  "excludeRecursion",
  "preventRecursion",
  "delayUntilRecursion",
  "automationId",
  "scanDepth",
] as const;

function fromSillyTavern(raw: Record<string, unknown>): LorebookImportSuccess {
  const unsupported = new Set<string>();
  const placement = new Set<string>();
  const source = isRecord(raw.entries) ? Object.values(raw.entries) : Array.isArray(raw.entries) ? raw.entries : [];

  const entries = source.filter(isRecord).map((entry, index) => {
    noteUnsupported(unsupported, entry, ST_UNSUPPORTED);
    const secondary = strList(entry.keysecondary);
    const position = stPosition(entry.position, placement);
    return toEntry(
      {
        keys: strList(entry.key),
        content: str(entry.content),
        ...(str(entry.comment) ? { comment: str(entry.comment) } : {}),
        enabled: entry.disable === true ? false : true,
        insertion_order: num(entry.order) ?? index,
        ...(bool(entry.caseSensitive) === undefined ? {} : { case_sensitive: bool(entry.caseSensitive) }),
        ...(bool(entry.constant) === undefined ? {} : { constant: bool(entry.constant) }),
        ...(bool(entry.selective) === undefined ? {} : { selective: bool(entry.selective) }),
        ...(secondary.length ? { secondary_keys: secondary } : {}),
        ...(bool(entry.useRegex) === undefined ? {} : { use_regex: bool(entry.useRegex) }),
        ...(position === undefined ? {} : { position }),
      },
      index,
    );
  });

  const losses = [
    ...unsupportedLoss(unsupported, "SillyTavern entry settings"),
    ...(placement.size > 0
      ? ["Entries placed relative to the author's note or at a chat depth were placed after the character definition instead."]
      : []),
  ];

  return {
    ok: true,
    format: "sillytavern",
    book: { name: str(raw.name), description: str(raw.description), entries },
    losses,
  };
}

const NAI_UNSUPPORTED = [
  "searchRange",
  "keyRelative",
  "nonStoryActivatable",
  "loreBiasGroups",
  "bias",
  "category",
  "contextConfig",
] as const;

function fromNovelAi(raw: Record<string, unknown>): LorebookImportSuccess {
  const unsupported = new Set<string>();
  const source = Array.isArray(raw.entries) ? raw.entries : [];

  const entries = source.filter(isRecord).map((entry, index) => {
    noteUnsupported(unsupported, entry, NAI_UNSUPPORTED);
    const context = isRecord(entry.contextConfig) ? entry.contextConfig : {};
    return toEntry(
      {
        keys: strList(entry.keys),
        content: str(entry.text),
        ...(str(entry.displayName) ? { name: str(entry.displayName) } : {}),
        ...(bool(entry.enabled) === undefined ? {} : { enabled: bool(entry.enabled) }),
        ...(bool(entry.forceActivation) === undefined ? {} : { constant: bool(entry.forceActivation) }),
        ...(num(context.budgetPriority) === undefined ? {} : { priority: num(context.budgetPriority) }),
        insertion_order: index,
      },
      index,
    );
  });

  const losses = [
    ...unsupportedLoss(unsupported, "NovelAI entry settings"),
    ...(source.length > 0
      ? ["NovelAI matches keys over a character range; this app matches over recent messages instead, so entries may fire at slightly different moments."]
      : []),
  ];

  return { ok: true, format: "novelai", book: { name: "", description: "", entries }, losses };
}

const AGNAI_UNSUPPORTED = ["weight"] as const;

function fromAgnai(raw: Record<string, unknown>): LorebookImportSuccess {
  const unsupported = new Set<string>();
  const source = Array.isArray(raw.entries) ? raw.entries : [];

  const entries = source.filter(isRecord).map((entry, index) => {
    noteUnsupported(unsupported, entry, AGNAI_UNSUPPORTED);
    return toEntry(
      {
        keys: strList(entry.keywords),
        content: str(entry.entry),
        ...(str(entry.name) ? { name: str(entry.name) } : {}),
        ...(bool(entry.enabled) === undefined ? {} : { enabled: bool(entry.enabled) }),
        ...(num(entry.priority) === undefined ? {} : { priority: num(entry.priority) }),
        insertion_order: num(entry.weight) ?? index,
      },
      index,
    );
  });

  return {
    ok: true,
    format: "agnai",
    book: { name: str(raw.name), description: str(raw.description), entries },
    losses: unsupportedLoss(unsupported, "Agnai entry settings"),
  };
}

const RISU_UNSUPPORTED = ["activationPercent", "loreCache", "folder", "bookVersion"] as const;

function fromRisuAi(raw: Record<string, unknown>): LorebookImportSuccess {
  const unsupported = new Set<string>();
  const source = Array.isArray(raw.data) ? raw.data : [];

  const entries = source.filter(isRecord).map((entry, index) => {
    noteUnsupported(unsupported, entry, RISU_UNSUPPORTED);
    const secondary = strList(entry.secondkey);
    return toEntry(
      {
        keys: strList(entry.key),
        content: str(entry.content),
        ...(str(entry.comment) ? { comment: str(entry.comment) } : {}),
        insertion_order: num(entry.insertorder) ?? index,
        constant: entry.alwaysActive === true || entry.mode === "constant",
        ...(bool(entry.selective) === undefined ? {} : { selective: bool(entry.selective) }),
        ...(secondary.length ? { secondary_keys: secondary } : {}),
        ...(bool(entry.useRegex) === undefined ? {} : { use_regex: bool(entry.useRegex) }),
      },
      index,
    );
  });

  return {
    ok: true,
    format: "risuai",
    book: { name: str(raw.name), description: "", entries },
    losses: unsupportedLoss(unsupported, "RisuAI entry settings"),
  };
}

export function lorebookFromCharacterBook(book: CharacterBook, name: string): ImportedLorebook {
  return {
    name: book.name?.trim() || name,
    description: book.description ?? "",
    ...(book.scan_depth === undefined ? {} : { scanDepth: book.scan_depth }),
    ...(book.token_budget === undefined ? {} : { tokenBudget: book.token_budget }),
    ...(book.recursive_scanning === undefined ? {} : { recursiveScanning: book.recursive_scanning }),
    entries: book.entries.map((entry, index) => ({ ...entry, uid: entryUid(index) })),
  };
}

function fromCharacterBook(raw: Record<string, unknown>): LorebookImportSuccess {
  const source = Array.isArray(raw.entries) ? raw.entries : [];
  const entries = source.filter(isRecord).map((entry, index) =>
    toEntry(
      {
        keys: strList(entry.keys),
        content: str(entry.content),
        ...(isRecord(entry.extensions) ? { extensions: entry.extensions } : {}),
        ...(str(entry.name) ? { name: str(entry.name) } : {}),
        ...(str(entry.comment) ? { comment: str(entry.comment) } : {}),
        ...(bool(entry.enabled) === undefined ? {} : { enabled: bool(entry.enabled) }),
        insertion_order: num(entry.insertion_order) ?? index,
        ...(bool(entry.case_sensitive) === undefined ? {} : { case_sensitive: bool(entry.case_sensitive) }),
        ...(num(entry.priority) === undefined ? {} : { priority: num(entry.priority) }),
        ...(bool(entry.selective) === undefined ? {} : { selective: bool(entry.selective) }),
        ...(strList(entry.secondary_keys).length ? { secondary_keys: strList(entry.secondary_keys) } : {}),
        ...(bool(entry.constant) === undefined ? {} : { constant: bool(entry.constant) }),
        ...(entry.position === "before_char" || entry.position === "after_char" ? { position: entry.position } : {}),
        ...(bool(entry.use_regex) === undefined ? {} : { use_regex: bool(entry.use_regex) }),
      },
      index,
    ),
  );

  return {
    ok: true,
    format: "character_book",
    book: {
      name: str(raw.name),
      description: str(raw.description),
      ...(num(raw.scan_depth) === undefined ? {} : { scanDepth: num(raw.scan_depth) }),
      ...(num(raw.token_budget) === undefined ? {} : { tokenBudget: num(raw.token_budget) }),
      ...(bool(raw.recursive_scanning) === undefined ? {} : { recursiveScanning: bool(raw.recursive_scanning) }),
      entries,
    },
    losses: [],
  };
}

function unwrap(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.data) && isRecord(payload.data.character_book)) return payload.data.character_book;
  if (isRecord(payload.character_book)) return payload.character_book;
  return payload;
}

function detect(raw: Record<string, unknown>): LorebookImportFormat | undefined {
  if (raw.type === "risu" || (Array.isArray(raw.data) && raw.data.some((entry) => isRecord(entry) && "insertorder" in entry))) {
    return "risuai";
  }
  if ("lorebookVersion" in raw) return "novelai";

  const list = Array.isArray(raw.entries) ? raw.entries.filter(isRecord) : [];
  const keyed = isRecord(raw.entries) ? Object.values(raw.entries).filter(isRecord) : [];

  if (list.some((entry) => "text" in entry && "contextConfig" in entry)) return "novelai";
  if (list.some((entry) => "entry" in entry && "keywords" in entry)) return "agnai";
  if (keyed.length > 0 || list.some((entry) => "key" in entry || "keysecondary" in entry)) return "sillytavern";
  if (list.some((entry) => "keys" in entry && "content" in entry)) return "character_book";
  if (Array.isArray(raw.entries) || isRecord(raw.entries)) return "character_book";
  return undefined;
}

function convert(format: LorebookImportFormat, raw: Record<string, unknown>): LorebookImportSuccess {
  if (format === "sillytavern") return fromSillyTavern(raw);
  if (format === "novelai") return fromNovelAi(raw);
  if (format === "agnai") return fromAgnai(raw);
  if (format === "risuai") return fromRisuAi(raw);
  return fromCharacterBook(raw);
}

export function sanitizeImportedLorebook(book: ImportedLorebook): { book: ImportedLorebook; losses: string[] } {
  const sanitized = sanitizeLorebookEntries(book.entries, "lorebook");
  const losses: string[] = [];
  if (sanitized.strippedKeys.length > 0) losses.push(`Removed for safety: ${sanitized.strippedKeys.join(", ")}.`);
  if (sanitized.truncatedFields.length > 0) {
    losses.push(`Shortened to fit the size limits: ${sanitized.truncatedFields.join(", ")}.`);
  }
  return { book: { ...book, entries: sanitized.entries }, losses };
}

export function importLorebookFromJson(text: string): LorebookImportResult {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file is not valid JSON." };
  }

  const raw = unwrap(payload);
  if (!raw) return { ok: false, message: "That file does not contain a lorebook." };

  const format = detect(raw);
  if (!format) {
    return {
      ok: false,
      message:
        "OpenWork could not find a lorebook in that file. It reads SillyTavern world info, NovelAI lorebooks, Agnai memory books, RisuAI lorebooks, and the lorebook inside a character card.",
    };
  }

  const converted = convert(format, raw);
  const sanitized = sanitizeImportedLorebook(converted.book);
  return { ...converted, book: sanitized.book, losses: [...converted.losses, ...sanitized.losses] };
}

export function importLorebookFromFile(bytes: Uint8Array): LorebookImportResult {
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) return importLorebookFromJson(new TextDecoder().decode(bytes));

  const decoded = decodeCardFromPng(bytes);
  if (!decoded.ok) return { ok: false, message: "That image does not carry a character card OpenWork can read." };

  const raw = unwrap(decoded.payload);
  if (!raw || !detect(raw)) return { ok: false, message: "That card does not have a lorebook in it." };
  return importLorebookFromJson(JSON.stringify(raw));
}

export function importedLorebookRecord(
  book: ImportedLorebook,
  input: { id: string; now: number; characterIds?: string[]; format?: LorebookImportFormat; fallbackName: string },
): RoleplayLorebookRecord {
  return {
    id: input.id,
    name: book.name.trim() || input.fallbackName,
    description: book.description,
    ...(book.scanDepth === undefined ? {} : { scanDepth: book.scanDepth }),
    ...(book.tokenBudget === undefined ? {} : { tokenBudget: book.tokenBudget }),
    ...(book.recursiveScanning === undefined ? {} : { recursiveScanning: book.recursiveScanning }),
    entries: book.entries,
    characterIds: input.characterIds ?? [],
    source: "imported",
    ...(input.format ? { importFormat: input.format } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}
