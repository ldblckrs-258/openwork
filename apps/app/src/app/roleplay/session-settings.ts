import type {
  RoleplayLorebookRecord,
  RoleplaySessionSettings,
} from "@openwork/types/roleplay";
import {
  DEFAULT_SAFEWORD,
  MAX_SAFEWORD_CHARS,
  MAX_SCENE_INTENSITY,
  MIN_SCENE_INTENSITY,
} from "@openwork/types/roleplay";

import { COMBINED_SYSTEM_BUDGET_CHARS } from "./compose-system.js";
import { LOREBOOK_BUDGET_CHARS, MAX_SCAN_DEPTH } from "./lorebook.js";
import { MEMORY_BUDGET_CHARS } from "./memory.js";
import { SCENE_STATE_BUDGET_CHARS } from "./scene-state.js";
import {
  SKILL_BUDGET_CHARS,
  type RoleplayAttachedSkill,
} from "./skills-injection.js";

export const MAX_SOURCE_BUDGET_CHARS = 16_000;

export const MAX_SESSION_SYSTEM_PROMPT_CHARS = 4_000;

export type ResolvedSessionSettings = {
  memoryBudgetChars: number;
  lorebookBudgetChars: number;
  scanDepth: number | undefined;
  disabledLorebookIds: string[];
  disabledSkillNames: string[];
  systemPrompt: string;
  colorSegments: boolean;
  intensity: number;
  safeword: string;
  deEscalated: boolean;
};

export const DEFAULT_SCENE_INTENSITY = 1;

function clampIntensity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_SCENE_INTENSITY;
  return Math.min(
    MAX_SCENE_INTENSITY,
    Math.max(MIN_SCENE_INTENSITY, Math.round(value)),
  );
}

export function resolveSafeword(value: string | undefined): string {
  return (value ?? "").trim().slice(0, MAX_SAFEWORD_CHARS) || DEFAULT_SAFEWORD;
}

function clampBudget(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SOURCE_BUDGET_CHARS, Math.max(0, Math.floor(value)));
}

export function resolveSessionSettings(
  settings: RoleplaySessionSettings | undefined,
): ResolvedSessionSettings {
  const scanDepth = settings?.scanDepth;
  return {
    memoryBudgetChars: clampBudget(
      settings?.memoryBudgetChars,
      MEMORY_BUDGET_CHARS,
    ),
    lorebookBudgetChars: clampBudget(
      settings?.lorebookBudgetChars,
      LOREBOOK_BUDGET_CHARS,
    ),
    scanDepth:
      scanDepth === undefined || !Number.isFinite(scanDepth)
        ? undefined
        : Math.min(MAX_SCAN_DEPTH, Math.max(1, Math.floor(scanDepth))),
    disabledLorebookIds: settings?.disabledLorebookIds ?? [],
    disabledSkillNames: settings?.disabledSkillNames ?? [],
    systemPrompt: (settings?.systemPrompt ?? "").slice(
      0,
      MAX_SESSION_SYSTEM_PROMPT_CHARS,
    ),
    colorSegments: settings?.colorSegments !== false,
    intensity: clampIntensity(settings?.intensity),
    safeword: resolveSafeword(settings?.safeword),
    deEscalated: settings?.deEscalated === true,
  };
}

export function activeLorebooks(
  books: RoleplayLorebookRecord[],
  disabledIds: string[],
): RoleplayLorebookRecord[] {
  if (disabledIds.length === 0) return books;
  const disabled = new Set(disabledIds);
  return books.filter((book) => !disabled.has(book.id));
}

export function activeSkills(
  skills: RoleplayAttachedSkill[],
  disabledNames: string[],
): RoleplayAttachedSkill[] {
  if (disabledNames.length === 0) return skills;
  const disabled = new Set(disabledNames);
  return skills.filter((skill) => !disabled.has(skill.name));
}

export function totalSourceBudgetChars(
  settings: ResolvedSessionSettings,
): number {
  return (
    settings.memoryBudgetChars +
    settings.lorebookBudgetChars +
    SKILL_BUDGET_CHARS +
    SCENE_STATE_BUDGET_CHARS
  );
}

export function budgetsCrowdOutCharacter(
  settings: ResolvedSessionSettings,
): boolean {
  return totalSourceBudgetChars(settings) > COMBINED_SYSTEM_BUDGET_CHARS / 2;
}
