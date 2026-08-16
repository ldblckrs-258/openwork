import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";

export type SafeModePreference = boolean | null;

export function workspaceHasAdultCharacter(
  characters: RoleplayCharacterRecord[],
): boolean {
  return characters.some((character) => character.nsfw && !character.deletedAt);
}

export function resolveSafeMode(
  preference: SafeModePreference,
  characters: RoleplayCharacterRecord[],
): boolean {
  if (preference !== null) return preference;
  return !workspaceHasAdultCharacter(characters);
}

export function visibleCharacters(
  characters: RoleplayCharacterRecord[],
  safeMode: boolean,
): RoleplayCharacterRecord[] {
  if (!safeMode) return characters;
  return characters.filter((character) => !character.nsfw);
}

export function hiddenCharacterCount(
  characters: RoleplayCharacterRecord[],
  safeMode: boolean,
): number {
  return characters.length - visibleCharacters(characters, safeMode).length;
}
