import type {
  CharacterCardV2,
  RoleplayLorebookRecord,
  RoleplayMemoryRecord,
  RoleplayPersona,
} from "@openwork/types/roleplay";

/**
 * What the chat surface needs to know to render a session as roleplay.
 *
 * Its presence *is* the gate: a session with no binding gets `null` here and
 * takes the ordinary chat path through the composer and the send path alike.
 */
export type RoleplaySurfaceState = {
  characterName: string;
  card: CharacterCardV2;
  persona: RoleplayPersona;
  /**
   * The card's opening line.
   *
   * The engine has no way to write an assistant message, so this is rendered by
   * the client as the transcript's first entry rather than existing in session
   * history. It is included in the compiled prompt so the model still knows what
   * it opened with.
   */
  greeting: string;
  /** User-authored continuity notes; compiled into `system` on every turn. */
  storySoFar: string;
  /** Approved memories for this character; budgeted, then compiled into `system`. */
  memories: RoleplayMemoryRecord[];
  /**
   * Set while the opening line is being written for this session.
   *
   * Blocks the composer and replaces the greeting with an indicator: the card's
   * greeting is about to be replaced, so showing it and accepting a reply
   * against it would start the scene twice.
   */
  greetingPending: boolean;
  /** Lorebooks attached to this character; matched against the transcript each turn. */
  lorebooks: RoleplayLorebookRecord[];
  /** Which character the session is bound to, so a memory approved mid-chat knows where to go. */
  characterId: string;
};
