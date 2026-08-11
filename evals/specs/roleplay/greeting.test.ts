import { describe, expect, test } from "vitest";
import {
  characterCardV2Schema,
  roleplaySessionBindingSchema,
  type RoleplayMemoryRecord,
} from "../../../packages/types/src/roleplay.ts";
import {
  buildGreetingRequest,
  MAX_GREETING_CHARS,
  parseGeneratedGreeting,
  sessionGreeting,
} from "../../../apps/app/src/app/roleplay/greeting.ts";
import {
  ROLEPLAY_AGENT,
  toolMapGrantsAccess,
} from "../../../apps/app/src/app/roleplay/prompt-options.ts";

const CARD = characterCardV2Schema.parse({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "The archivist who never forgets a debt.",
    first_mes: "You're late.",
  },
});

const PERSONA = { name: "Wren", description: "A courier." };

function memory(text: string, overrides: Partial<RoleplayMemoryRecord> = {}): RoleplayMemoryRecord {
  return {
    id: `mem_${text.length}`,
    characterId: "chr_1",
    text,
    source: "user",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("the request", () => {
  test("runs behind the same boundary a roleplay turn does", () => {
    // Generation reads an untrusted card and returns text that goes straight
    // into the transcript, so it is not more trustworthy than a turn.
    const request = buildGreetingRequest({ card: CARD, persona: PERSONA, memories: [] });

    expect(request.agent).toBe(ROLEPLAY_AGENT);
    expect(toolMapGrantsAccess(request.tools, "bash")).toBe(false);
  });

  test("the character, the persona, and what they remember all reach the model", () => {
    const request = buildGreetingRequest({
      card: CARD,
      persona: PERSONA,
      memories: [memory("Wren left a book in the rain.")],
      storySoFar: "They parted badly at the harbour.",
    });

    expect(request.text).toContain("The archivist who never forgets a debt.");
    expect(request.text).toContain("A courier.");
    expect(request.text).toContain("Wren left a book in the rain.");
    expect(request.text).toContain("They parted badly at the harbour.");
  });

  test("the card's own greeting is sent for tone, and labelled as such", () => {
    // Without the label a model treats it as the scene it must continue, and
    // rewrites the same first meeting the memories exist to move past.
    const request = buildGreetingRequest({ card: CARD, persona: PERSONA, memories: [] });

    expect(request.text).toContain("for tone only");
    expect(request.text).toContain("You're late.");
  });

  test("memory is budgeted before it is sent, not after", () => {
    // The generated opening has to come from the context the character will
    // actually play with; an opening built from memories the turn then drops
    // reads as the character forgetting mid-scene.
    const many = Array.from({ length: 80 }, (_, index) => memory(`Fact ${index} `.padEnd(200, "x")));
    const request = buildGreetingRequest({ card: CARD, persona: PERSONA, memories: many });

    expect(request.text.length).toBeLessThan(many.reduce((total, entry) => total + entry.text.length, 0));
  });
});

describe("reading the reply", () => {
  test("prose comes back as written", () => {
    expect(parseGeneratedGreeting("*She looks up.* \"Still raining?\"")).toEqual({
      ok: true,
      text: '*She looks up.* "Still raining?"',
    });
  });

  test("a code fence around prose is unwrapped rather than rejected", () => {
    // A model that fences its answer has still written a usable line; failing
    // would send the user back to the button for a fix the app can make.
    expect(parseGeneratedGreeting('```\n"Still raining?"\n```')).toEqual({ ok: true, text: '"Still raining?"' });
  });

  test("a label the model prefixed is dropped", () => {
    expect(parseGeneratedGreeting("Greeting: You came back.")).toEqual({ ok: true, text: "You came back." });
  });

  test("padded blank lines collapse", () => {
    const parsed = parseGeneratedGreeting("First line.\n\n\n\nSecond line.");

    expect(parsed).toEqual({ ok: true, text: "First line.\n\nSecond line." });
  });

  test("an over-long answer is cut to the cap", () => {
    const parsed = parseGeneratedGreeting("x".repeat(MAX_GREETING_CHARS + 500));

    expect(parsed.ok && parsed.text.length).toBe(MAX_GREETING_CHARS);
  });

  test("an empty answer fails loudly rather than opening on nothing", () => {
    expect(parseGeneratedGreeting("   \n  ").ok).toBe(false);
    expect(parseGeneratedGreeting("```\n\n```").ok).toBe(false);
  });
});

describe("which greeting a session opens with", () => {
  test("the session's own greeting wins", () => {
    expect(sessionGreeting("You came back.", CARD)).toBe("You came back.");
  });

  test("an empty or blank one falls back to the card", () => {
    expect(sessionGreeting("", CARD)).toBe("You're late.");
    expect(sessionGreeting("   ", CARD)).toBe("You're late.");
  });

  test("a binding stored before greetings existed still parses", () => {
    // Bindings are already on disk without this field. Failing to parse one
    // would unbind a live conversation from its character.
    const legacy = roleplaySessionBindingSchema.parse({
      sessionId: "ses_1",
      characterId: "chr_1",
      personaId: "per_1",
      storySoFar: "",
      boundAt: 1,
    });

    expect(legacy.greeting).toBe("");
    expect(sessionGreeting(legacy.greeting, CARD)).toBe("You're late.");
  });
});
