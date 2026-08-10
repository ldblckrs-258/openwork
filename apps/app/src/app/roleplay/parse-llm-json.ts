import type { z, ZodType } from "zod";

/**
 * Parse structured JSON out of a model response and validate it against a schema.
 *
 * Character generation, memory proposals, and card self-revision all consume
 * model-authored JSON. Each writing its own parse-validate-repair pass would mean
 * three separate sets of JSON-repair edge-case bugs, so they share this one.
 *
 * Exactly one repair round runs. Repair is unbounded in principle — a model can
 * always emit something a little more broken — so the bound is the contract: one
 * mechanical pass over the common wrappers, then failure. It never re-prompts and
 * never evaluates the payload.
 */
export type ParseLlmJsonResult<T> =
  | { ok: true; value: T; repaired: boolean }
  | { ok: false; error: string; raw: string };

const FENCE_PATTERN = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

function stripFence(raw: string): string {
  const fenced = FENCE_PATTERN.exec(raw);
  return fenced?.[1] ?? raw;
}

/** Slice out the outermost JSON object or array, dropping prose either side of it. */
function sliceOutermost(raw: string): string | undefined {
  const start = raw.search(/[[{]/);
  if (start === -1) return undefined;
  const opener = raw[start];
  const closer = opener === "{" ? "}" : "]";
  const end = raw.lastIndexOf(closer);
  if (end <= start) return undefined;
  return raw.slice(start, end + 1);
}

function repair(raw: string): string | undefined {
  const sliced = sliceOutermost(stripFence(raw));
  if (sliced === undefined) return undefined;
  // Trailing commas are the one malformation models produce often enough, and
  // unambiguously enough, to be worth mechanically correcting.
  return sliced.replace(/,(\s*[}\]])/g, "$1");
}

function attempt<S extends ZodType>(
  candidate: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  return { ok: true, value: result.data };
}

export function parseLlmJson<S extends ZodType>(raw: string, schema: S): ParseLlmJsonResult<z.infer<S>> {
  const direct = attempt(raw, schema);
  if (direct.ok) return { ok: true, value: direct.value, repaired: false };

  const repaired = repair(raw);
  if (repaired === undefined) return { ok: false, error: direct.error, raw };

  const second = attempt(repaired, schema);
  if (second.ok) return { ok: true, value: second.value, repaired: true };

  return { ok: false, error: second.error, raw };
}
