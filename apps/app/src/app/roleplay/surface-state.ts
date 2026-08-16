import type {
  CharacterCardV2,
  RoleplayLorebookRecord,
  RoleplayMemoryRecord,
  RoleplayModelRef,
  RoleplayPersona,
  RoleplaySceneState,
  RoleplaySessionSettings,
} from "@openwork/types/roleplay";

import type { RoleplayAttachedSkill } from "./skills-injection.js";

export type RoleplaySurfaceState = {
  characterName: string;
  card: CharacterCardV2;
  persona: RoleplayPersona;
  greeting: string;
  storySoFar: string;
  memories: RoleplayMemoryRecord[];
  greetingPending: boolean;
  lorebooks: RoleplayLorebookRecord[];
  skills: RoleplayAttachedSkill[];
  skillsPending: boolean;
  settings: RoleplaySessionSettings;
  sceneState?: RoleplaySceneState;
  hardLimits: string[];
  nsfw: boolean;
  preferredModel?: RoleplayModelRef;
  characterId: string;
};
