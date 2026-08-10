export type MacroContext = {
  char: string;
  user: string;
  original?: string;
};

const MACRO_PATTERN = /\{\{\s*(char|user|original)\s*\}\}|<BOT>|<USER>/gi;

const START_PATTERN = /<START>/gi;

/**
 * Substitute card macros in a single left-to-right pass.
 *
 * One pass is deliberate. Replacing macros sequentially would let a substituted
 * value be re-scanned, so a character named `{{user}}` — a name the card author
 * controls — could expand into a second macro. A single alternation makes every
 * replacement terminal.
 *
 * `{{original}}` is only meaningful inside `system_prompt` and
 * `post_history_instructions`. Elsewhere `original` is undefined and the literal
 * text is left alone rather than silently deleted.
 */
export function substituteMacros(text: string, context: MacroContext): string {
  return text.replace(MACRO_PATTERN, (match, name: string | undefined) => {
    const macro = (name ?? match.slice(1, -1)).toLowerCase();
    if (macro === "char" || macro === "bot") return context.char;
    if (macro === "user") return context.user;
    return context.original ?? match;
  });
}

/** Split `mes_example` into its discrete exchanges on `<START>` boundaries. */
export function splitExampleMessages(mesExample: string): string[] {
  return mesExample
    .split(START_PATTERN)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

/**
 * Rebuild `mes_example` from discrete exchanges.
 *
 * The editor presents example dialogue as a list of blocks rather than one
 * textarea, so the `<START>` separators are written here instead of typed by
 * hand. Typed separators are the usual source of malformed example dialogue,
 * which fails silently: the model just sees one run-on exchange.
 */
export function joinExampleMessages(blocks: string[]): string {
  const filled = blocks.map((block) => block.trim()).filter((block) => block !== "");
  if (filled.length === 0) return "";
  return filled.map((block) => `${EXAMPLE_SEPARATOR_TAG}\n${block}`).join("\n");
}

const EXAMPLE_SEPARATOR_TAG = "<START>";
