import {
  characterCardDataV3Schema,
  characterCardV1Schema,
  characterCardV2Schema,
  type CharacterBook,
  type CharacterBookEntry,
  type CharacterCardDataV2,
  type CharacterCardV2,
} from "@openwork/types/roleplay";

export const ALLOWED_EXTENSION_NAMESPACES: readonly string[] = ["openwork"];

export const PRIVILEGE_KEYS: readonly string[] = [
  "permission",
  "tools",
  "agent",
  "model",
  "prompt",
  "plugin",
  "mcp",
  "command",
  "instructions",
  "provider",
  "mode",
  "temperature",
  "options",
  "disable",
];

export const MAX_CARD_BYTES = 2_000_000;

export const CARD_FIELD_LIMITS = {
  name: 256,
  description: 32_000,
  personality: 32_000,
  scenario: 32_000,
  first_mes: 32_000,
  mes_example: 64_000,
  creator_notes: 8_000,
  system_prompt: 32_000,
  post_history_instructions: 32_000,
  creator: 256,
  character_version: 64,
  tag: 64,
  alternate_greeting: 32_000,
  book_entry_content: 32_000,
  book_entry_key: 256,
} as const;

export const CARD_COUNT_LIMITS = {
  tags: 64,
  alternate_greetings: 32,
  book_entries: 512,
  book_entry_keys: 64,
} as const;

const MAX_EXTENSION_DEPTH = 16;

/**
 * Keys that mutate an object's prototype instead of becoming own properties.
 *
 * `JSON.parse` happily produces an own `__proto__` key, but assigning it with
 * bracket notation invokes the inherited setter and reassigns the prototype. The
 * value then survives sanitization while reporting zero own keys and appearing in
 * no strip report — content passing the boundary invisibly, which is precisely
 * what this sanitizer exists to prevent.
 */
const PROTOTYPE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

const V1_COMPANION_FIELDS = ["description", "personality", "scenario", "first_mes", "mes_example"];

const CAPPED_TEXT_FIELDS = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "creator",
  "character_version",
] as const;

export type CardSourceSpec = "chara_card_v1" | "chara_card_v2" | "chara_card_v3";

export type CardSanitizeReport = {
  sourceSpec: CardSourceSpec;
  charSubstitutionName: string;
  strippedKeys: string[];
  truncatedFields: string[];
  droppedV3Fields: string[];
};

export type CardRejectReason =
  | { kind: "not_json_object" }
  | { kind: "unrecognized_card" }
  | { kind: "too_large"; bytes: number; limit: number };

export type CardSanitizeResult =
  | { ok: true; card: CharacterCardV2; report: CardSanitizeReport }
  | { ok: false; reason: CardRejectReason };

type ReportSink = {
  stripped: string[];
  truncated: string[];
  droppedV3: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function recordPrivilegeKeys(source: Record<string, unknown>, path: string, sink: ReportSink): void {
  for (const key of Object.keys(source)) {
    if (PRIVILEGE_KEYS.includes(key)) sink.stripped.push(path ? `${path}.${key}` : key);
  }
}

function scrubPrivilege(value: unknown, path: string, sink: ReportSink, depth: number): unknown {
  if (depth > MAX_EXTENSION_DEPTH) {
    // Deeper nesting than we are willing to walk cannot be checked for
    // privilege keys, so it is discarded — and reported, because dropping card
    // data without saying so is the failure this report exists to prevent.
    sink.stripped.push(path);
    return null;
  }
  if (Array.isArray(value)) return value.map((item, index) => scrubPrivilege(item, `${path}.${index}`, sink, depth + 1));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (PRIVILEGE_KEYS.includes(key) || PROTOTYPE_KEYS.includes(key)) {
      sink.stripped.push(keyPath);
      continue;
    }
    Object.defineProperty(out, key, { value: scrubPrivilege(item, keyPath, sink, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function sanitizeExtensions(
  extensions: Record<string, unknown>,
  path: string,
  sink: ReportSink,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [namespace, value] of Object.entries(extensions)) {
    const namespacePath = `${path}.${namespace}`;
    if (!ALLOWED_EXTENSION_NAMESPACES.includes(namespace) || PROTOTYPE_KEYS.includes(namespace)) {
      sink.stripped.push(namespacePath);
      continue;
    }
    Object.defineProperty(out, namespace, {
      value: scrubPrivilege(value, namespacePath, sink, 0),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function cap(value: string, limit: number, path: string, sink: ReportSink): string {
  if (value.length <= limit) return value;
  sink.truncated.push(path);
  return value.slice(0, limit);
}

function capList<T>(list: T[], limit: number, path: string, sink: ReportSink): T[] {
  if (list.length <= limit) return list;
  sink.truncated.push(path);
  return list.slice(0, limit);
}

function sanitizeBookEntry(entry: CharacterBookEntry, path: string, sink: ReportSink): CharacterBookEntry {
  return {
    ...entry,
    keys: capList(entry.keys, CARD_COUNT_LIMITS.book_entry_keys, `${path}.keys`, sink).map((key, index) =>
      cap(key, CARD_FIELD_LIMITS.book_entry_key, `${path}.keys.${index}`, sink),
    ),
    content: cap(entry.content, CARD_FIELD_LIMITS.book_entry_content, `${path}.content`, sink),
    extensions: sanitizeExtensions(entry.extensions, `${path}.extensions`, sink),
  };
}

function sanitizeBook(book: CharacterBook, path: string, sink: ReportSink): CharacterBook {
  return {
    ...book,
    extensions: sanitizeExtensions(book.extensions, `${path}.extensions`, sink),
    entries: capList(book.entries, CARD_COUNT_LIMITS.book_entries, `${path}.entries`, sink).map((entry, index) =>
      sanitizeBookEntry(entry, `${path}.entries.${index}`, sink),
    ),
  };
}

function sanitizeData(data: CharacterCardDataV2, sink: ReportSink): CharacterCardDataV2 {
  const next: CharacterCardDataV2 = { ...data };

  for (const field of CAPPED_TEXT_FIELDS) {
    next[field] = cap(data[field], CARD_FIELD_LIMITS[field], `data.${field}`, sink);
  }

  next.tags = capList(data.tags, CARD_COUNT_LIMITS.tags, "data.tags", sink).map((tag, index) =>
    cap(tag, CARD_FIELD_LIMITS.tag, `data.tags.${index}`, sink),
  );

  next.alternate_greetings = capList(
    data.alternate_greetings,
    CARD_COUNT_LIMITS.alternate_greetings,
    "data.alternate_greetings",
    sink,
  ).map((greeting, index) =>
    cap(greeting, CARD_FIELD_LIMITS.alternate_greeting, `data.alternate_greetings.${index}`, sink),
  );

  next.extensions = sanitizeExtensions(data.extensions, "data.extensions", sink);

  if (data.character_book) next.character_book = sanitizeBook(data.character_book, "data.character_book", sink);

  return next;
}

function detectSpec(raw: Record<string, unknown>): CardSourceSpec | undefined {
  if (raw.spec === "chara_card_v2") return "chara_card_v2";
  if (raw.spec === "chara_card_v3") return "chara_card_v3";
  if (typeof raw.spec === "string") return undefined;
  const hasName = typeof raw.name === "string" && raw.name.trim() !== "";
  const hasCompanion = V1_COMPANION_FIELDS.some((field) => field in raw);
  return hasName && hasCompanion ? "chara_card_v1" : undefined;
}

function emptyDataFields() {
  return {
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
  };
}

function degradeV3Data(raw: unknown, sink: ReportSink): { data: CharacterCardDataV2; charName: string } | undefined {
  const parsed = characterCardDataV3Schema.safeParse(raw);
  if (!parsed.success) return undefined;
  const v3 = parsed.data;
  const source = isPlainObject(raw) ? raw : {};

  for (const field of ["assets", "source", "creation_date", "modification_date", "creator_notes_multilingual"]) {
    if (field in source) sink.droppedV3.push(field);
  }
  if ("group_only_greetings" in source) sink.droppedV3.push("group_only_greetings");

  const englishNotes = v3.creator_notes_multilingual?.en ?? "";
  const creatorNotes = v3.creator_notes || englishNotes;

  const book = v3.character_book;
  const degradedBook: CharacterBook | undefined = book
    ? {
        ...book,
        entries: book.entries.map((entry, index) => {
          const { use_regex: useRegex, ...rest } = entry;
          if (useRegex !== undefined) sink.droppedV3.push(`character_book.entries.${index}.use_regex`);
          return rest;
        }),
      }
    : undefined;

  const data: CharacterCardDataV2 = {
    name: v3.name,
    description: v3.description,
    personality: v3.personality,
    scenario: v3.scenario,
    first_mes: v3.first_mes,
    mes_example: v3.mes_example,
    creator_notes: creatorNotes,
    system_prompt: v3.system_prompt,
    post_history_instructions: v3.post_history_instructions,
    alternate_greetings: v3.alternate_greetings,
    tags: v3.tags,
    creator: v3.creator,
    character_version: v3.character_version,
    extensions: v3.extensions,
    ...(degradedBook ? { character_book: degradedBook } : {}),
  };

  return { data, charName: v3.nickname?.trim() || v3.name };
}

/**
 * Turn an untrusted, third-party card payload into a Character Card V2 this app
 * is willing to compile into a prompt.
 *
 * This is a security control. Card text is authored by strangers and reaches the
 * model verbatim, so anything in it that could influence agent capability — tool
 * maps, permission maps, agent/model selection — is removed here rather than
 * relied on to be absent. Unknown extension vendors are dropped for the same
 * reason, which knowingly departs from the V2 spec's "MUST NOT drop unknown
 * keys" rule; the returned report names every loss so the UI can surface it.
 *
 * It does not, and cannot, address tool-free attacks: a card that instructs the
 * model to emit a fake system notice or a phishing link produces ordinary chat
 * output, which this function never sees. That mitigation is UI-side.
 */
export function sanitizeCard(input: unknown): CardSanitizeResult {
  if (!isPlainObject(input)) return { ok: false, reason: { kind: "not_json_object" } };

  const bytes = byteLength(input);
  if (bytes > MAX_CARD_BYTES) {
    return { ok: false, reason: { kind: "too_large", bytes, limit: MAX_CARD_BYTES } };
  }

  const sourceSpec = detectSpec(input);
  if (!sourceSpec) return { ok: false, reason: { kind: "unrecognized_card" } };

  const sink: ReportSink = { stripped: [], truncated: [], droppedV3: [] };
  recordPrivilegeKeys(input, "", sink);
  if (isPlainObject(input.data)) recordPrivilegeKeys(input.data, "data", sink);

  let data: CharacterCardDataV2;
  let charSubstitutionName: string;

  if (sourceSpec === "chara_card_v3") {
    const degraded = degradeV3Data(input.data, sink);
    if (!degraded) return { ok: false, reason: { kind: "unrecognized_card" } };
    data = degraded.data;
    charSubstitutionName = degraded.charName;
  } else if (sourceSpec === "chara_card_v2") {
    const parsed = characterCardV2Schema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: { kind: "unrecognized_card" } };
    data = parsed.data.data;
    charSubstitutionName = data.name;
  } else {
    const parsed = characterCardV1Schema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: { kind: "unrecognized_card" } };
    data = { ...parsed.data, ...emptyDataFields() };
    charSubstitutionName = data.name;
  }

  const card: CharacterCardV2 = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: sanitizeData(data, sink),
  };

  return {
    ok: true,
    card,
    report: {
      sourceSpec,
      charSubstitutionName,
      strippedKeys: sink.stripped,
      truncatedFields: sink.truncated,
      droppedV3Fields: sink.droppedV3,
    },
  };
}
