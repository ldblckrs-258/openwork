/**
 * Every send in this app — roleplay or not — already carries a per-prompt
 * `system` string built by `buildOpenworkEnvSystemContext`. A roleplay turn needs
 * that same channel for the compiled character prompt and for the turn's director
 * text, so the three have to share it.
 *
 * Composing rather than replacing is the requirement: replacing would strip the
 * environment description every other feature assumes is present. And because the
 * environment string is built outside the prompt compiler, it is not counted by
 * the compiler's injection budget — so the only place a combined ceiling can be
 * enforced is here, after all three parts are known.
 */

export const SYSTEM_SECTION_DELIMITER = "\n\n---\n\n";

/**
 * Combined ceiling for the whole `system` string, in characters.
 *
 * A character prompt, a workspace description, and a turn instruction all land
 * in the system message ahead of every message of chat history. Roughly 8k
 * tokens leaves room for a long conversation before the engine starts compacting
 * away the history the character is supposed to remember.
 */
export const COMBINED_SYSTEM_BUDGET_CHARS = 32_000;

const TRUNCATION_NOTICE = "\n\n[…truncated to fit the prompt budget]";

export type ComposeSystemInput = {
  /** Whatever the shared env-context builder produced for this send, if anything. */
  envContext: string | null | undefined;
  /** Output of the Phase 1 prompt compiler. */
  characterPrompt: string;
  /** This turn's out-of-character steering, already extracted from the message. */
  directorText?: string;
  budgetChars?: number;
};

export type ComposedSystem = {
  system: string;
  chars: number;
  /** Sections removed to fit the ceiling, in the order they were dropped. */
  dropped: Array<"envContext">;
  truncated: boolean;
};

function join(sections: string[]): string {
  return sections.filter((section) => section.trim() !== "").join(SYSTEM_SECTION_DELIMITER);
}

/**
 * Order matters: director text goes last so the turn's instruction sits as close
 * to the chat history as this engine allows. The engine appends the whole
 * per-prompt `system` to the front of the conversation, so "last within system"
 * is the nearest position obtainable — see the note in `compile-prompt.ts` about
 * why `post_history_instructions` cannot be honoured at all.
 *
 * Under overflow the environment context is dropped before the character prompt:
 * a roleplay send denies every tool, so the workspace description it exists to
 * support cannot be acted on, whereas losing the character prompt loses the
 * character.
 */
export function composeSystem(input: ComposeSystemInput): ComposedSystem {
  const budget = input.budgetChars ?? COMBINED_SYSTEM_BUDGET_CHARS;
  const env = (input.envContext ?? "").trim();
  const character = input.characterPrompt.trim();
  const director = (input.directorText ?? "").trim();
  const dropped: Array<"envContext"> = [];

  let system = join([env, character, director]);
  if (system.length <= budget) {
    return { system, chars: system.length, dropped, truncated: false };
  }

  if (env) {
    dropped.push("envContext");
    system = join([character, director]);
    if (system.length <= budget) {
      return { system, chars: system.length, dropped, truncated: false };
    }
  }

  const tail = director ? `${SYSTEM_SECTION_DELIMITER}${director}` : "";
  const room = Math.max(0, budget - tail.length - TRUNCATION_NOTICE.length);
  system = `${character.slice(0, room)}${TRUNCATION_NOTICE}${tail}`;
  return { system, chars: system.length, dropped, truncated: true };
}
