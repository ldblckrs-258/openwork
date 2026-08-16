const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsSafeword(text: string, safeword: string): boolean {
  const needle = safeword.trim();
  if (!needle) return false;

  const boundedLeft = WORD_CHARACTER.test(needle.charAt(0));
  const boundedRight = WORD_CHARACTER.test(needle.charAt(needle.length - 1));
  const pattern = new RegExp(
    `${boundedLeft ? "(?<![\\p{L}\\p{N}])" : ""}${escapeForRegExp(needle)}${boundedRight ? "(?![\\p{L}\\p{N}])" : ""}`,
    "iu",
  );
  return pattern.test(text);
}

export function sendCarriesSafeword(
  parts: { text?: string | undefined; directorText?: string | undefined },
  safeword: string,
): boolean {
  return (
    containsSafeword(parts.text ?? "", safeword) ||
    containsSafeword(parts.directorText ?? "", safeword)
  );
}
