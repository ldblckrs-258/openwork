import type { RoleplaySkillRef, RoleplaySkillScope } from "@openwork/types/roleplay";

/**
 * Attached skills are writing guidance, not capability. Their bodies are text in
 * the system message; the `skill` tool stays denied and every roleplay send
 * still carries `tools: {"*": false}`.
 *
 * They get their own ceiling rather than joining the lorebook/memory eviction
 * pass. Those two grow without bound and compete; an attached set is small,
 * explicitly chosen, and fixed until the user changes it. Ranking a style skill
 * against a lorebook entry would let a long scene silently evict the guidance
 * the character has been writing under — a voice change with no signal.
 */
export const SKILL_BUDGET_CHARS = 6_000;

/**
 * Deliberately above the budget, so one long skill is truncated with a report
 * rather than dropped whole.
 */
export const MAX_SKILL_BODY_CHARS = 8_000;

export const MAX_ATTACHED_SKILLS = 8;

/**
 * Why an attached ref produced no body.
 *
 * `missing` is not an error — skills come and go on disk. `shadowed` is the
 * ref resolving in a different scope than it was attached from, which means
 * some other file has taken the name; running guidance the user did not choose
 * is worse than running none, so it is reported rather than substituted.
 */
export type RoleplaySkillStatus = "missing" | "shadowed";

/** One attached skill with its body already read. The pure layer does no I/O. */
export type RoleplayAttachedSkill = {
  name: string;
  scope: RoleplaySkillScope;
  body: string;
  status?: RoleplaySkillStatus;
};

export type SkillInjection = {
  name: string;
  body: string;
};

export type SkillSelection = {
  injections: SkillInjection[];
  /** Attached names that reached the prompt with nothing of them at all: the budget was spent, or the count cap was hit. */
  dropped: string[];
  /**
   * Attached names whose body was cut — by its own cap, or by what was left of
   * the budget. Disjoint from `dropped`: a name is cut *or* absent, never both.
   */
  truncated: string[];
  unresolved: string[];
  shadowed: string[];
  charsUsed: number;
};

export type SelectSkillInjectionsOptions = {
  budgetChars?: number;
};

/**
 * Turn a lookup result into an attached skill.
 *
 * Total by construction: every input, including a failed or missing lookup,
 * produces a record. That is what lets the composer's pending flag mean *in
 * flight* and nothing else — a ref that can never resolve still resolves here,
 * so the conversation opens instead of waiting forever on a deleted file.
 */
export function classifyResolvedSkill(
  ref: RoleplaySkillRef,
  resolved: { scope: RoleplaySkillScope; content: string } | null,
): RoleplayAttachedSkill {
  if (!resolved) return { name: ref.name, scope: ref.scope, body: "", status: "missing" };
  if (resolved.scope !== ref.scope) return { name: ref.name, scope: ref.scope, body: "", status: "shadowed" };
  return { name: ref.name, scope: ref.scope, body: resolved.content };
}

const FRONTMATTER_PATTERN = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Drop a leading YAML frontmatter block.
 *
 * Done here rather than with `parseFrontmatter`, which lives in `apps/server` —
 * `apps/app` never imports from it. Ten lines is the cost of that boundary, not
 * a DRY violation to fix.
 */
export function stripSkillFrontmatter(body: string): string {
  return body.replace(FRONTMATTER_PATTERN, "").trim();
}

/**
 * Choose which attached skill bodies reach the prompt, in the user's attach
 * order, and report everything that did not.
 *
 * Pure and deterministic, like `compilePrompt`: a swipe replays a turn against
 * the exact system string it originally ran with.
 */
export function selectSkillInjections(
  skills: RoleplayAttachedSkill[],
  options: SelectSkillInjectionsOptions = {},
): SkillSelection {
  const budgetChars = options.budgetChars ?? SKILL_BUDGET_CHARS;
  const injections: SkillInjection[] = [];
  const dropped: string[] = [];
  const truncated: string[] = [];
  const unresolved: string[] = [];
  const shadowed: string[] = [];
  let charsUsed = 0;
  let admitted = 0;

  for (const skill of skills) {
    if (skill.status === "missing") {
      unresolved.push(skill.name);
      continue;
    }
    if (skill.status === "shadowed") {
      shadowed.push(skill.name);
      continue;
    }

    // The count cap is applied to resolved skills only, so a stale ref cannot
    // consume a slot a live skill would have had.
    if (admitted >= MAX_ATTACHED_SKILLS) {
      dropped.push(skill.name);
      continue;
    }

    const body = stripSkillFrontmatter(skill.body);
    if (body === "") continue;

    admitted += 1;

    // Filled in attach order, cutting whatever straddles the boundary rather
    // than skipping it. The per-body cap sits *above* the budget on purpose, so
    // a single long skill has to arrive cut with a report — skipping it instead
    // would make that cap unreachable and drop the skill whole, which is the
    // outcome it exists to prevent.
    //
    // The cost is that attach order decides: a long skill early can leave a
    // short one behind it nothing. That is what "in the user's attach order"
    // means, and the panel reports the drop.
    const remaining = budgetChars - charsUsed;
    if (remaining <= 0) {
      dropped.push(skill.name);
      continue;
    }

    const limit = Math.min(MAX_SKILL_BODY_CHARS, remaining);
    const capped = body.length > limit ? body.slice(0, limit) : body;
    if (capped.length !== body.length) truncated.push(skill.name);

    charsUsed += capped.length;
    injections.push({ name: skill.name, body: capped });
  }

  return { injections, dropped, truncated, unresolved, shadowed, charsUsed };
}
