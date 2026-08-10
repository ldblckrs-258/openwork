/**
 * The send-path half of the roleplay tool-denial boundary.
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
 * wire. Two rules hold it:
 *
 *   1. Every roleplay send passes `tools: {"*": false}` explicitly. Omitting the
 *      field is not equivalent — and `tools: {}` is a no-op, not a deny-all.
 *   2. Nothing merges a caller-supplied tool map into it. There is no parameter
 *      here to pass one, and that is the point.
 *
 * `agent` is hardcoded rather than read from the user's selected-agent
 * preference. That preference is global and persisted, so a user whose saved
 * agent is `build` would otherwise run an untrusted card's compiled prompt
 * against an agent with no denial at all — invisible in manual testing, because
 * a developer with `roleplay` selected never reproduces it.
 */

export const ROLEPLAY_AGENT = "roleplay";

/** Wildcard, not an enumeration: unlisted tool ids stay enabled, and the id set drifts. */
export const ROLEPLAY_DENY_ALL_TOOLS: Readonly<Record<string, boolean>> = Object.freeze({ "*": false });

export type RoleplayPromptOptions = {
  agent: string;
  tools: Record<string, boolean>;
  system: string;
};

/**
 * Build the denial-bearing half of a roleplay `session.promptAsync` call.
 *
 * Spread this over the send parameters *last*, so nothing downstream can
 * reintroduce a widening `tools` map or an unpinned agent.
 */
export function roleplayPromptOptions(system: string): RoleplayPromptOptions {
  return {
    agent: ROLEPLAY_AGENT,
    tools: { ...ROLEPLAY_DENY_ALL_TOOLS },
    system,
  };
}

/**
 * True when a tool map would expose any tool at all.
 *
 * Exists so the boundary is assertable from a spec rather than reviewed by eye:
 * any `true`, including the wildcard, widens access.
 */
export function toolMapGrantsAccess(tools: Record<string, boolean> | undefined): boolean {
  if (!tools) return true;
  const entries = Object.entries(tools);
  if (entries.length === 0) return true;
  if (entries.some(([, enabled]) => enabled)) return true;
  return tools["*"] !== false;
}
