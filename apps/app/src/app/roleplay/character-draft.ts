import {
  SCENE_TYPE_PATTERN,
  roleplayCharacterRecordSchema,
  type CharacterCardDataV2,
  type RoleplayCharacterRecord,
  type RoleplayPersonaRecord,
} from "@openwork/types/roleplay";

export const CHARACTER_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  first_mes: "First message",
  mes_example: "Example dialogue",
  alternate_greetings: "Alternate greetings",
  sceneRecords: "Opening scene",
};

export type CharacterFieldError = {
  field: string;
  label: string;
  message: string;
};

function emptyCardData(): CharacterCardDataV2 {
  return {
    name: "",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
  };
}

export function createCharacterId(now: number, random: string): string {
  return `chr_${now.toString(36)}_${random}`;
}

export function createPersonaId(now: number, random: string): string {
  return `psn_${now.toString(36)}_${random}`;
}

export function createBlankCharacter(
  id: string,
  now: number,
): RoleplayCharacterRecord {
  return {
    id,
    card: { spec: "chara_card_v2", spec_version: "2.0", data: emptyCardData() },
    charSubstitutionName: "",
    source: "authored",
    attachedSkills: [],
    nsfw: false,
    sceneRecords: [],
    hardLimits: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createBlankPersona(
  id: string,
  now: number,
): RoleplayPersonaRecord {
  return {
    id,
    persona: { name: "", description: "" },
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateCharacter(
  source: RoleplayCharacterRecord,
  id: string,
  now: number,
): RoleplayCharacterRecord {
  return {
    ...source,
    id,
    card: {
      ...source.card,
      data: {
        ...source.card.data,
        name: `${source.card.data.name} copy`.trim(),
      },
    },
    source: "authored",
    deletedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateCharacter(
  record: RoleplayCharacterRecord,
): CharacterFieldError[] {
  const errors: CharacterFieldError[] = [];
  const data = record.card.data;

  if (!data.name.trim()) {
    errors.push({
      field: "name",
      label: CHARACTER_FIELD_LABELS.name,
      message: "Give the character a name.",
    });
  }
  if (!data.first_mes.trim()) {
    errors.push({
      field: "first_mes",
      label: CHARACTER_FIELD_LABELS.first_mes,
      message: "Write the line the character opens with.",
    });
  }
  record.sceneRecords.forEach((scene, index) => {
    if (!SCENE_TYPE_PATTERN.test(scene.type)) {
      errors.push({
        field: `sceneRecords.${index}.type`,
        label: CHARACTER_FIELD_LABELS.sceneRecords ?? "Opening scene",
        message: `"${scene.type}" is not a type. Use lowercase letters, digits and underscores, up to 24 characters.`,
      });
    }
  });

  const parsed = roleplayCharacterRecordSchema.safeParse(record);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      errors.push({
        field,
        label: CHARACTER_FIELD_LABELS[issue.path.at(-1) as string] ?? field,
        message: issue.message,
      });
    }
  }

  return errors;
}

export function applyCardEdit(
  record: RoleplayCharacterRecord,
  edit: Partial<CharacterCardDataV2>,
  now: number,
): RoleplayCharacterRecord {
  const data = { ...record.card.data, ...edit };
  return {
    ...record,
    card: { ...record.card, data },
    charSubstitutionName:
      record.source === "authored" ? data.name : record.charSubstitutionName,
    updatedAt: now,
  };
}
