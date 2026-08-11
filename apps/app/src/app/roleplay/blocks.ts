import type { RoleplayBlock, RoleplayBlockType } from "@openwork/types/roleplay";

/**
 * The three block types the composer can author. `plain` is excluded: it has no
 * trigger and no marker because it is the absence of both.
 */
export type AuthoredBlockType = Exclude<RoleplayBlockType, "plain">;

/**
 * Markers are how a block survives the composer's flat-string codec.
 *
 * The composer serializes its entire state to one string (`serializePromptFromRoot`)
 * and rebuilds from it (`setPrompt`), so a block chip has to have a textual form.
 * The `[rp:...]` shape follows the existing `[skill ...]` / `[attachment ...]`
 * token convention and is matched only at the start of a line, so it cannot
 * collide with those (they are matched anywhere) or with ordinary prose.
 */
export const BLOCK_MARKERS = {
  dialogue: "[rp:say]",
  action: "[rp:do]",
  director: "[rp:ooc]",
} as const satisfies Record<AuthoredBlockType, string>;

const MARKER_ENTRIES = Object.entries(BLOCK_MARKERS) as Array<[AuthoredBlockType, string]>;

export const SLASH_TRIGGERS = {
  "/say ": "dialogue",
  "/do ": "action",
  "/ooc ": "director",
} as const satisfies Record<string, AuthoredBlockType>;

export const PUNCTUATION_TRIGGERS = {
  '"': "dialogue",
  "*": "action",
  "[": "director",
} as const satisfies Record<string, AuthoredBlockType>;

export type BlockTrigger = {
  type: AuthoredBlockType;
  /** Characters of the line the trigger consumed; the chip replaces exactly these. */
  consumed: number;
  source: "slash" | "punctuation";
};

/**
 * Decide whether the text typed so far on the current line has fired a trigger.
 *
 * The whole line prefix is matched, not a suffix, which is what implements the
 * line-start guard: `He said "` cannot match because the prefix is not `"`.
 * Without that guard, quoting anything inside dialogue would spawn nested blocks.
 *
 * Kept pure and outside Lexical so the mid-line and line-start cases can be
 * asserted without driving an editor.
 */
export function detectBlockTrigger(lineBeforeCursor: string): BlockTrigger | null {
  for (const [prefix, type] of Object.entries(SLASH_TRIGGERS) as Array<[string, AuthoredBlockType]>) {
    if (lineBeforeCursor === prefix) return { type, consumed: prefix.length, source: "slash" };
  }
  for (const [char, type] of Object.entries(PUNCTUATION_TRIGGERS) as Array<[string, AuthoredBlockType]>) {
    if (lineBeforeCursor === char) return { type, consumed: char.length, source: "punctuation" };
  }
  return null;
}

/** The literal characters a punctuation trigger consumed, for one-keystroke revert. */
export function triggerLiteral(type: AuthoredBlockType): string {
  const entry = Object.entries(PUNCTUATION_TRIGGERS).find(([, kind]) => kind === type);
  return entry?.[0] ?? "";
}

export function matchBlockMarker(line: string): { type: AuthoredBlockType; rest: string } | null {
  return matchMarker(line);
}

function matchMarker(line: string): { type: AuthoredBlockType; rest: string } | null {
  for (const [type, marker] of MARKER_ENTRIES) {
    if (line.startsWith(marker)) return { type, rest: line.slice(marker.length) };
  }
  return null;
}

/**
 * Read the composer's flat draft string back into ordered blocks.
 *
 * An unmarked line continues the block above it rather than starting a `plain`
 * one, so a dialogue block the user wrapped across several lines compiles as one
 * quoted speech instead of one quoted line followed by bare text.
 */
export function parseBlocks(draftText: string): RoleplayBlock[] {
  const blocks: RoleplayBlock[] = [];
  for (const line of draftText.split("\n")) {
    const marked = matchMarker(line);
    if (marked) {
      blocks.push({ type: marked.type, text: marked.rest });
      continue;
    }
    const open = blocks[blocks.length - 1];
    if (open) {
      open.text = `${open.text}\n${line}`;
      continue;
    }
    blocks.push({ type: "plain", text: line });
  }
  return blocks;
}

/** Inverse of `parseBlocks`, so a persisted turn can be restored into the composer. */
export function serializeBlocks(blocks: RoleplayBlock[]): string {
  return blocks
    .map((block) => (block.type === "plain" ? block.text : `${BLOCK_MARKERS[block.type]}${block.text}`))
    .join("\n");
}

function wrap(text: string, delimiter: string): string {
  const already = text.length >= 2 * delimiter.length
    && text.startsWith(delimiter)
    && text.endsWith(delimiter);
  return already ? text : `${delimiter}${text}${delimiter}`;
}

export type CompiledBlocks = {
  /** What goes in the user message, in authored order. */
  messageText: string;
  /** What goes in the per-prompt `system`. Never appears in the message. */
  directorText: string;
};

/**
 * Split an ordered block list into the two channels a roleplay turn sends on.
 *
 * Out-of-character steering that shares a channel with in-character content gets
 * treated as scene content or echoed back by the model, so director text leaves
 * here in its own field and the caller is responsible for keeping it out of
 * `parts`.
 *
 * Dialogue and action are wrapped in the reading conventions, never rewritten:
 * the text between the delimiters is byte-identical to what the user typed.
 */
export function compileBlocks(blocks: RoleplayBlock[]): CompiledBlocks {
  const message: string[] = [];
  const director: string[] = [];

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    if (block.type === "director") {
      director.push(text);
      continue;
    }
    if (block.type === "dialogue") {
      message.push(wrap(text, '"'));
      continue;
    }
    if (block.type === "action") {
      message.push(wrap(text, "*"));
      continue;
    }
    message.push(text);
  }

  return { messageText: message.join("\n"), directorText: director.join("\n") };
}

export function compileDraftText(draftText: string): CompiledBlocks & { blocks: RoleplayBlock[] } {
  const blocks = parseBlocks(draftText);
  return { blocks, ...compileBlocks(blocks) };
}
