import type { RoleplaySkillRef, RoleplaySkillScope } from "@openwork/types/roleplay";

/**
 * Attached skills are writing guidance, not capability. Their bodies are text in
 * the system message; the `skill` tool stays denied and every roleplay send
 * still carries `tools: {"*": false}`.
 */
export const SKILL_BUDGET_CHARS = 6_000;

export const MAX_SKILL_BODY_CHARS = 8_000;

export const MAX_ATTACHED_SKILLS = 8;

export type RoleplaySkillStatus = "missing" | "shadowed";

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
  dropped: string[];
  truncated: string[];
  unresolved: string[];
  shadowed: string[];
  charsUsed: number;
};

export type SelectSkillInjectionsOptions = {
  budgetChars?: number;
};

export function classifyResolvedSkill(
  ref: RoleplaySkillRef,
  resolved: { scope: RoleplaySkillScope; content: string } | null,
): RoleplayAttachedSkill {
  if (!resolved) return { name: ref.name, scope: ref.scope, body: "", status: "missing" };
  if (resolved.scope !== ref.scope) return { name: ref.name, scope: ref.scope, body: "", status: "shadowed" };
  return { name: ref.name, scope: ref.scope, body: resolved.content };
}

const FRONTMATTER_PATTERN = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function stripSkillFrontmatter(body: string): string {
  return body.replace(FRONTMATTER_PATTERN, "").trim();
}

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

    if (admitted >= MAX_ATTACHED_SKILLS) {
      dropped.push(skill.name);
      continue;
    }

    const body = stripSkillFrontmatter(skill.body);
    if (body === "") continue;

    admitted += 1;

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
