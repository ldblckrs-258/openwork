export type RoleplaySegmentKind = "narration" | "speech" | "action" | "ooc";

export type RoleplaySegment = {
  kind: RoleplaySegmentKind;
  text: string;
};

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
    if (segment.inner.trim()) segments.push({ kind: segment.kind, text: segment.text });
    else pushNarration(match[0]);
    cursor = match.index + match[0].length;
  }

  pushNarration(text.slice(cursor));
  return segments;
}
