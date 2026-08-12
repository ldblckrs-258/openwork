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

export const roleplaySkillScopeSchema = z.enum(["project", "global"])
export type RoleplaySkillScope = z.infer<typeof roleplaySkillScopeSchema>

/**
 * A workspace skill attached to a character as writing guidance.
 *
 * The scope is stored beside the name because a name alone is shadowable:
 * `listSkills` pushes every ancestor's project directories ahead of the global
 * ones and then dedupes first-wins, so a plugin install or a checked-out repo
 * can silently take over a global name. A ref that resolves in a different
 * scope than it was attached from is treated as unresolved rather than
 * substituted.
 */
export const roleplaySkillRefSchema = z.object({
  name: looseString,
  scope: roleplaySkillScopeSchema.catch("project"),
})
export type RoleplaySkillRef = z.infer<typeof roleplaySkillRefSchema>

export const roleplayCharacterRecordSchema = z.object({
  id: idString,
  card: characterCardV2Schema,
  /** V3 `nickname` when the source card carried one; drives `{{char}}` without changing the display name. */
  charSubstitutionName: looseString,
  avatarPath: looseOptionalString,
  source: roleplayCharacterSourceSchema.catch("authored"),
  /**
   * Set when a revision has been applied.
   *
   * Matters most for imported cards: once one has been revised it no longer
   * represents its original author's work, and anything that presents it — the
   * library, an export — should not imply otherwise.
   */
  revisedAt: z.number().int().nonnegative().optional().catch(undefined),
  /**
   * Workspace skills injected as writing guidance on every turn.
   *
   * Stored on the character rather than in the skill's own frontmatter: a skill
   * is a `SKILL.md` file shared out of the workspace, and writing a roleplay
   * concept into it would leak into every skill the user exports.
   */
  attachedSkills: z.array(roleplaySkillRefSchema).catch([]),
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

/**
 * Per-conversation overrides for how a turn is built.
 *
 * Every field is optional and `undefined` means "use the app's default", so the
 * defaults stay in one place — the app layer that owns them — rather than being
 * copied into every stored binding, where they would freeze at whatever they
 * were the day the session started.
 *
 * These apply to a regenerate as well as to a send. A conversation therefore has
 * one live configuration rather than a per-turn one, which means two swipe
 * alternatives of the same turn may have been generated under different settings.
 */
export const roleplaySessionSettingsSchema = z.object({
  /** Characters of prompt the memories may occupy. */
  memoryBudgetChars: looseNumber,
  /** Characters of prompt the matched lorebook entries may occupy. */
  lorebookBudgetChars: looseNumber,
  /** Overrides every attached book's own scan depth. */
  scanDepth: looseNumber,
  /**
   * Books switched off for this conversation only.
   *
   * Stored as the ids that are off rather than the ids that are on: a book
   * attached to the character after this session started is then live by
   * default, which matches what attaching one means.
   */
  disabledLorebookIds: looseStringArray,
  /**
   * Attached skills switched off for this conversation only.
   *
   * The off-list, for the same reason `disabledLorebookIds` is one. Names are
   * unique within a character's attached set, so this needs no scope.
   */
  disabledSkillNames: looseStringArray,
  /** Replaces the card's `system_prompt`, and the app default behind it. Empty means neither. */
  systemPrompt: looseString,
  /** False turns off speech/action/OOC colouring in this conversation's transcript. */
  colorSegments: looseBoolean,
})
export type RoleplaySessionSettings = z.infer<typeof roleplaySessionSettingsSchema>

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
  /**
   * The line this conversation opened with, when it is not the card's.
   *
   * Empty means the card's `first_mes`. A generated opening lives here rather
   * than on the card because it belongs to one session: the card's greeting was
   * written for a first meeting, and once the character has memories each new
   * conversation deserves its own opening without overwriting the author's.
   */
  greeting: looseString,
  /**
   * Absent on every binding written before settings existed, which is why the
   * whole object falls back rather than each field: a binding that failed to
   * parse would unbind a live conversation from its character.
   */
  settings: roleplaySessionSettingsSchema.catch({ disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" }),
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

/**
 * Where an approved memory came from.
 *
 * Not a review state — there is no `pending` here on purpose. A proposal lives
 * in the review UI and is never written, so the store can only ever hold
 * memories a person accepted. `extracted` records that the wording started as
 * model output, which is what the injection budget ranks below the user's own.
 */
export const roleplayMemorySourceSchema = z.enum(["user", "extracted"])
export type RoleplayMemorySource = z.infer<typeof roleplayMemorySourceSchema>

/**
 * One thing a character knows across sessions.
 *
 * Keyed per character rather than per session: the entire point is that it
 * outlives the conversation it came from. `sessionId` is provenance only.
 */
export const roleplayMemoryRecordSchema = z.object({
  id: idString,
  characterId: idString,
  text: looseString,
  source: roleplayMemorySourceSchema.catch("user"),
  /** The conversation this was learned in, when it came from one. */
  sessionId: looseOptionalString,
  createdAt: timestamp,
  updatedAt: timestamp,
})
export type RoleplayMemoryRecord = z.infer<typeof roleplayMemoryRecordSchema>

/**
 * One lorebook entry as stored by this app.
 *
 * The spec-shaped fields keep their snake_case names on purpose: an entry is
 * written straight back out on export, and renaming them here would mean a
 * translation layer in both directions that could only ever lose fidelity.
 *
 * `uid` is the app's own addition. The V2 `id` field is an optional number that
 * community files reuse, leave out, or collide on, so it cannot key an editor
 * row or a trace line — this can.
 */
export const roleplayLorebookEntrySchema = characterBookEntryV3Schema.extend({
  uid: idString,
})
export type RoleplayLorebookEntry = z.infer<typeof roleplayLorebookEntrySchema>

/**
 * A world the character knows about.
 *
 * Stored as its own record rather than inside the card, because the files people
 * actually trade — SillyTavern world info, NovelAI lorebooks, Agnai memory books
 * — are not cards, and because one world usually serves several characters. A
 * card-embedded `character_book` becomes one of these on import, attached to the
 * character it arrived with.
 *
 * The book-level fields are camelCase where the entries are snake_case: these
 * are this app's settings for the book, not fields that round-trip to a card.
 */
export const roleplayLorebookRecordSchema = z.object({
  id: idString,
  name: looseString,
  description: looseString,
  /** How many recent messages keys are matched against. Absent means the app default. */
  scanDepth: looseNumber,
  /** The book's own ceiling in tokens, as the file declared it. Never raises the app's own ceiling. */
  tokenBudget: looseNumber,
  recursiveScanning: looseBoolean,
  entries: z.array(roleplayLorebookEntrySchema).catch([]),
  /** Characters this book is attached to. A book attached to nothing is inert. */
  characterIds: looseStringArray,
  source: roleplayCharacterSourceSchema.catch("authored"),
  /** Which platform's file this came from, for the library to show. */
  importFormat: looseOptionalString,
  createdAt: timestamp,
  updatedAt: timestamp,
})
export type RoleplayLorebookRecord = z.infer<typeof roleplayLorebookRecordSchema>

/**
 * A card as it stood before a revision was applied.
 *
 * Kept so an approved change can be undone. Cards are small, so storing the whole
 * card rather than a patch costs little and makes rollback a copy rather than an
 * inverse-diff — which is the operation most likely to be subtly wrong when it is
 * needed most.
 *
 * The oldest revision for a character is its state before any revision, so it
 * doubles as the baseline a drift comparison is made against.
 */
export const roleplayCardRevisionSchema = z.object({
  id: idString,
  characterId: idString,
  /** The card *before* this revision replaced it. */
  card: characterCardV2Schema,
  /** Field names this revision changed, for rendering the history without diffing. */
  changedFields: looseStringArray,
  createdAt: timestamp,
})
export type RoleplayCardRevision = z.infer<typeof roleplayCardRevisionSchema>
