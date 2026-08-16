/**
 * The send-path half of the roleplay tool boundary.
 *
 * Agent config is a backstop, not a control. Proven against a live engine
 * (`reports/tool-denial-spike.md`): a per-prompt `tools` map does not intersect
 * with agent-level or session-level denial, it **overrides** it, and it can
 * widen. An agent configured `permission: {"*": "deny"}` that receives a prompt
 * carrying `tools: {"*": true}` is offered all twelve tools. A session-wide
 * deny-all that receives `tools: {read: true}` was likewise restored to all
 * twelve — a map naming one tool cancelled the whole ruleset.
 *
 * So the boundary lives here, at the last place that decides what goes on the
 * wire. The invariant is not "no tool is ever offered" — one is, to the turn
 * path. It is narrower and stricter than that:
 *
 *   1. The maps are frozen module constants. There are exactly two of them, and
 *      neither is built from anything a caller passes in.
 *   2. The only choice a caller has is *which* of the two fixed maps is used,
 *      and the one option that exists can only narrow — from the turn map to
 *      deny-all. There is no argument, anywhere, that widens.
 *   3. Every send passes a map explicitly. Omitting the field is not equivalent,
 *      and `tools: {}` is a no-op rather than a deny-all.
 *
 * The split into two functions is the point of the file. `roleplayPromptOptions`
 * is shared by five generation callers — greeting, memory extraction, the two
 * character-generation prompts, and revise — every one of which processes
 * untrusted card text and model output. Widening the shared constant in place
 * would have handed the tool to all five.
 *
 * `agent` is hardcoded rather than read from the user's selected-agent
 * preference. That preference is global and persisted, so a user whose saved
 * agent is `build` would otherwise run an untrusted card's compiled prompt
 * against an agent with no denial at all — invisible in manual testing, because
 * a developer with `roleplay` selected never reproduces it.
 */

import { ROLEPLAY_STATE_TOOL } from "@openwork/types/roleplay";

export const ROLEPLAY_AGENT = "roleplay";

/** The one tool a roleplay turn may reach, and the only `true` in this file. */
export { ROLEPLAY_STATE_TOOL };

/** Wildcard, not an enumeration: unlisted tool ids stay enabled, and the id set drifts. */
export const ROLEPLAY_DENY_ALL_TOOLS: Readonly<Record<string, boolean>> =
  Object.freeze({ "*": false });

/**
 * Deny-all *plus* one named allow.
 */
export const ROLEPLAY_TURN_TOOLS: Readonly<Record<string, boolean>> =
  Object.freeze({
    "*": false,
    [ROLEPLAY_STATE_TOOL]: true,
  });

export type RoleplayPromptOptions = {
  agent: string;
  tools: Record<string, boolean>;
  system: string;
};

/**
 * Build a roleplay send that carries no tools at all.
 */
export function roleplayPromptOptions(system: string): RoleplayPromptOptions {
  return {
    agent: ROLEPLAY_AGENT,
    tools: { ...ROLEPLAY_DENY_ALL_TOOLS },
    system,
  };
}

/**
 * Build the one send that may carry the scene-state tool.
 */
export function roleplayTurnPromptOptions(
  system: string,
  options?: { denyTools?: boolean },
): RoleplayPromptOptions {
  return {
    agent: ROLEPLAY_AGENT,
    tools: {
      ...(options?.denyTools ? ROLEPLAY_DENY_ALL_TOOLS : ROLEPLAY_TURN_TOOLS),
    },
    system,
  };
}

/**
 * True when a tool map would expose any tool at all.
 */
export function toolMapGrantsAccess(
  tools: Record<string, boolean> | undefined,
): boolean {
  if (!tools) return true;
  const entries = Object.entries(tools);
  if (entries.length === 0) return true;
  if (entries.some(([, enabled]) => enabled)) return true;
  return tools["*"] !== false;
}

/**
 * True when a tool map exposes exactly `ids` and nothing else.
 */
export function toolMapGrantsOnly(
  tools: Record<string, boolean> | undefined,
  ids: readonly string[],
): boolean {
  if (!tools) return false;
  if (tools["*"] !== false) return false;
  const granted = Object.entries(tools)
    .filter(([id, enabled]) => enabled && id !== "*")
    .map(([id]) => id)
    .sort();
  const expected = [...ids].sort();
  return (
    granted.length === expected.length &&
    granted.every((id, index) => id === expected[index])
  );
}
