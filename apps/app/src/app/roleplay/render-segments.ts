/**
 * Split a roleplay message into the parts a reader treats differently.
 *
 * Four kinds, matching the three the composer authors plus the prose between
 * them: speech in quotes, action in asterisks, out-of-character asides in
 * brackets, and narration for everything else. The model writes in the same
 * conventions because the compiled prompt and the user's own turns use them.
 *
 * Pure and framework-free, so the reading rules can be asserted without
 * rendering anything.
 */

export type RoleplaySegmentKind = "narration" | "speech" | "action" | "ooc";

export type RoleplaySegment = {
  kind: RoleplaySegmentKind;
  /** What to display. Asterisks are dropped; quotes and brackets are kept. */
  text: string;
};

/**
 * Why each delimiter is matched the way it is:
 *
 * - **Speech** keeps its quotes. They are the reader's own convention, and a
 *   colour alone would make a copied transcript lose the distinction.
 * - **Action** drops its asterisks. Before this renderer they were markdown
 *   emphasis and rendered as italics with no asterisks visible, so keeping them
 *   would look like a regression. Both `*x*` and `**x**` count.
 * - **OOC** keeps its brackets, and single parentheses are deliberately NOT
 *   matched: ordinary narration is full of them ("she paused (again)"), and
 *   colouring those as out-of-character would be wrong far more often than
 *   right. `[…]`, `((…))`, and an explicit `(OOC: …)` are unambiguous.
 *
 * No delimiter may span a newline. An unterminated quote then stops at the end
 * of its line instead of swallowing the rest of the message.
 */
const SEGMENT_PATTERN = new RegExp(
  [
    "\\[[^\\]\\n]*\\]",
    "\\(\\((?:[^)\\n]|\\)(?!\\)))*\\)\\)",
    "\\(\\s*OOC\\b[^)\\n]*\\)",
    '"[^"\\n]*"',
    "“[^”\\n]*”",
    "\\*\\*[^*\\n]+\\*\\*",
    "\\*[^*\\n]+\\*",
  ].join("|"),
  "gi",
);

/** The match's kind, what to display for it, and the content its delimiters hold. */
function classify(match: string): RoleplaySegment & { inner: string } {
  if (match.startsWith("[") || match.startsWith("(")) {
    return { kind: "ooc", text: match, inner: match.replace(/^[[(]+|[\])]+$/g, "") };
  }
  if (match.startsWith("*")) {
    const inner = match.replace(/^\*+|\*+$/g, "");
    return { kind: "action", text: inner, inner };
  }
  return { kind: "speech", text: match, inner: match.slice(1, -1) };
}

export function segmentRoleplayText(text: string): RoleplaySegment[] {
  const segments: RoleplaySegment[] = [];
  let cursor = 0;

  // Adjacent narration merges into one segment: a `""` that falls back to prose
  // would otherwise split the sentence around it into three spans that render
  // identically.
  const pushNarration = (chunk: string) => {
    if (!chunk) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "narration") last.text += chunk;
    else segments.push({ kind: "narration", text: chunk });
  };

  SEGMENT_PATTERN.lastIndex = 0;
  for (let match = SEGMENT_PATTERN.exec(text); match !== null; match = SEGMENT_PATTERN.exec(text)) {
    pushNarration(text.slice(cursor, match.index));
    const segment = classify(match[0]);
    // Empty delimiters carry nothing to colour, so they stay prose rather than
    // becoming an invisible styled span.
    if (segment.inner.trim()) segments.push({ kind: segment.kind, text: segment.text });
    else pushNarration(match[0]);
    cursor = match.index + match[0].length;
  }

  pushNarration(text.slice(cursor));
  return segments;
}
