import type { CharacterCardV2, RoleplayPersona } from "@openwork/types/roleplay";

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
};
