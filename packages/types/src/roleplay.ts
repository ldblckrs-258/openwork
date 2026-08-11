import { z } from "zod"

const looseString = z.string().catch("")
const looseStringArray = z.array(z.string()).catch([])
const looseExtensions = z.record(z.string(), z.unknown()).catch({})
const looseBoolean = z.boolean().optional().catch(undefined)
const looseNumber = z.number().optional().catch(undefined)
const looseOptionalString = z.string().optional().catch(undefined)

export const roleplayPersonaSchema = z.object({
  name: looseString,
  description: looseString,
})
export type RoleplayPersona = z.infer<typeof roleplayPersonaSchema>

export const characterBookEntryPositionSchema = z.enum(["before_char", "after_char"])
export type CharacterBookEntryPosition = z.infer<typeof characterBookEntryPositionSchema>

export const characterBookEntrySchema = z.object({
  keys: looseStringArray,
  content: looseString,
  extensions: looseExtensions,
  enabled: z.boolean().catch(true),
  insertion_order: z.number().catch(0),
  case_sensitive: looseBoolean,
  name: looseOptionalString,
  priority: looseNumber,
  id: looseNumber,
  comment: looseOptionalString,
  selective: looseBoolean,
  secondary_keys: z.array(z.string()).optional().catch(undefined),
  constant: looseBoolean,
  position: characterBookEntryPositionSchema.optional().catch(undefined),
})
export type CharacterBookEntry = z.infer<typeof characterBookEntrySchema>

export const characterBookSchema = z.object({
  name: looseOptionalString,
  description: looseOptionalString,
  scan_depth: looseNumber,
  token_budget: looseNumber,
  recursive_scanning: looseBoolean,
  extensions: looseExtensions,
  entries: z.array(characterBookEntrySchema).catch([]),
})
export type CharacterBook = z.infer<typeof characterBookSchema>

export const characterCardDataV2Schema = z.object({
  name: looseString,
  description: looseString,
  personality: looseString,
  scenario: looseString,
  first_mes: looseString,
  mes_example: looseString,
  creator_notes: looseString,
  system_prompt: looseString,
  post_history_instructions: looseString,
  alternate_greetings: looseStringArray,
  character_book: characterBookSchema.optional().catch(undefined),
  tags: looseStringArray,
  creator: looseString,
  character_version: looseString,
  extensions: looseExtensions,
})
export type CharacterCardDataV2 = z.infer<typeof characterCardDataV2Schema>

export const characterCardV2Schema = z.object({
  spec: z.literal("chara_card_v2"),
  spec_version: looseString,
  data: characterCardDataV2Schema,
})
export type CharacterCardV2 = z.infer<typeof characterCardV2Schema>

export const characterCardV1Schema = z.object({
  name: looseString,
  description: looseString,
  personality: looseString,
  scenario: looseString,
  first_mes: looseString,
  mes_example: looseString,
})
export type CharacterCardV1 = z.infer<typeof characterCardV1Schema>

export const characterCardAssetSchema = z.object({
  type: looseString,
  uri: looseString,
  name: looseString,
  ext: looseString,
})
export type CharacterCardAsset = z.infer<typeof characterCardAssetSchema>

export const characterBookEntryV3Schema = characterBookEntrySchema.extend({
  use_regex: looseBoolean,
})
export type CharacterBookEntryV3 = z.infer<typeof characterBookEntryV3Schema>

export const characterBookV3Schema = characterBookSchema.extend({
  entries: z.array(characterBookEntryV3Schema).catch([]),
})
export type CharacterBookV3 = z.infer<typeof characterBookV3Schema>

export const characterCardDataV3Schema = characterCardDataV2Schema.extend({
  nickname: looseOptionalString,
  creator_notes_multilingual: z.record(z.string(), z.string()).optional().catch(undefined),
  source: z.array(z.string()).optional().catch(undefined),
  assets: z.array(characterCardAssetSchema).optional().catch(undefined),
  group_only_greetings: looseStringArray,
  creation_date: looseNumber,
  modification_date: looseNumber,
  character_book: characterBookV3Schema.optional().catch(undefined),
})
export type CharacterCardDataV3 = z.infer<typeof characterCardDataV3Schema>

export const characterCardV3Schema = z.object({
  spec: z.literal("chara_card_v3"),
  spec_version: looseString,
  data: characterCardDataV3Schema,
})
export type CharacterCardV3 = z.infer<typeof characterCardV3Schema>

export const ROLEPLAY_STORE_SCHEMA_VERSION = 1

const idString = z.string().trim().min(1).max(256)
const timestamp = z.number().int().nonnegative().catch(0)

/**
 * `plain` is not one of the composer's three authored block types. It is what
 * untriggered text becomes: a roleplay turn is still free text, and a line the
 * user typed without a trigger has to survive the round trip verbatim rather
 * than being silently promoted to dialogue and wrapped in quotes it never had.
 */
export const roleplayBlockTypeSchema = z.enum(["dialogue", "action", "director", "plain"])
export type RoleplayBlockType = z.infer<typeof roleplayBlockTypeSchema>

export const roleplayBlockSchema = z.object({
  type: roleplayBlockTypeSchema,
  text: looseString,
})
export type RoleplayBlock = z.infer<typeof roleplayBlockSchema>

export const roleplayCharacterSourceSchema = z.enum(["authored", "imported"])
export type RoleplayCharacterSource = z.infer<typeof roleplayCharacterSourceSchema>

export const roleplayCharacterRecordSchema = z.object({
  id: idString,
  card: characterCardV2Schema,
  /** V3 `nickname` when the source card carried one; drives `{{char}}` without changing the display name. */
  charSubstitutionName: looseString,
  avatarPath: looseOptionalString,
  source: roleplayCharacterSourceSchema.catch("authored"),
  createdAt: timestamp,
  updatedAt: timestamp,
  /**
   * Set instead of removing the record. Sessions bound to a deleted character
   * must stay readable, and rendering their past turns needs the character's
   * name and avatar to survive the delete.
   */
  deletedAt: z.number().int().nonnegative().optional().catch(undefined),
})
export type RoleplayCharacterRecord = z.infer<typeof roleplayCharacterRecordSchema>

export const roleplayPersonaRecordSchema = z.object({
  id: idString,
  persona: roleplayPersonaSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
})
export type RoleplayPersonaRecord = z.infer<typeof roleplayPersonaRecordSchema>

export const roleplaySessionBindingSchema = z.object({
  sessionId: idString,
  characterId: idString,
  personaId: looseString,
  /**
   * User-authored continuity notes, compiled into `system` on every turn.
   *
   * The engine's `summarize` call takes only a provider and a model, so a
   * roleplay-specific summarisation prompt cannot reach it. This is what carries
   * tone and unresolved beats across a compaction the app does not control.
   */
  storySoFar: looseString,
  boundAt: timestamp,
})
export type RoleplaySessionBinding = z.infer<typeof roleplaySessionBindingSchema>

/**
 * One generated reply, kept so it survives being regenerated.
 *
 * The engine destroys a reverted reply the moment the next prompt is dispatched
 * — proven in `reports/swipe-semantics-spike.md`, including when that prompt
 * fails. So an alternative that is not copied here before the revert is gone,
 * and swipe navigation would have nothing to navigate.
 */
export const roleplayAlternativeSchema = z.object({
  text: looseString,
  /** The engine message id this text came from, before it was discarded. */
  messageId: looseString,
  createdAt: timestamp,
})
export type RoleplayAlternative = z.infer<typeof roleplayAlternativeSchema>

/**
 * A roleplay turn: what the user authored, and every reply it has produced.
 *
 * Keyed by a client-generated `turnId` rather than by the engine's message id,
 * because a regenerate mints new ids for both the user message and the reply. A
 * store keyed by message id would be orphaned by the exact operation the blocks
 * were persisted to survive.
 */
export const roleplayTurnRecordSchema = z.object({
  turnId: idString,
  /** Carried on the record so turns can be pruned per session and on session delete. */
  sessionId: idString,
  /** The engine's current user-message id for this turn; changes on every swipe. */
  messageId: looseString,
  /** The parts to re-send when regenerating. `parts: []` blanks the user's message. */
  userText: looseString,
  blocks: z.array(roleplayBlockSchema).catch([]),
  alternatives: z.array(roleplayAlternativeSchema).catch([]),
  /** Index into `alternatives` the transcript is currently showing. */
  activeAlternative: z.number().int().nonnegative().catch(0),
  createdAt: timestamp,
})
export type RoleplayTurnRecord = z.infer<typeof roleplayTurnRecordSchema>
