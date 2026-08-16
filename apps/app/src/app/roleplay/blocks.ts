import type { RoleplayBlock, RoleplayBlockType } from "@openwork/types/roleplay";

export type AuthoredBlockType = Exclude<RoleplayBlockType, "plain">;

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
};

export function detectBlockTrigger(lineBeforeCursor: string): BlockTrigger | null {
  for (const [prefix, type] of Object.entries(SLASH_TRIGGERS) as Array<[string, AuthoredBlockType]>) {
    if (lineBeforeCursor === prefix) return { type };
  }
  for (const [char, type] of Object.entries(PUNCTUATION_TRIGGERS) as Array<[string, AuthoredBlockType]>) {
    if (lineBeforeCursor === char) return { type };
  }
  return null;
}

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
  messageText: string;
  directorText: string;
};

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
