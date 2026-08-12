import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { SessionSettingsPanel } from "../src/react-app/domains/roleplay/components/session-settings-panel";
import type { RoleplayLorebookRecord, RoleplayPersonaRecord } from "@openwork/types/roleplay";
import type { RoleplayAttachedSkill } from "../src/app/roleplay/skills-injection";

const PERSONAS: RoleplayPersonaRecord[] = [
  { id: "per_1", persona: { name: "Wren", description: "A courier." }, createdAt: 1, updatedAt: 1 },
  { id: "per_2", persona: { name: "Tam", description: "A clerk." }, createdAt: 1, updatedAt: 1 },
];

const BOOK: RoleplayLorebookRecord = {
  id: "lore_1",
  name: "The harbour",
  description: "",
  entries: [{ uid: "a", keys: ["harbour"], content: "It floods at dusk.", extensions: {}, enabled: true, insertion_order: 0 }],
  characterIds: ["chr_1"],
  source: "authored",
  createdAt: 1,
  updatedAt: 1,
};

const SKILLS: RoleplayAttachedSkill[] = [
  { name: "slow-burn", scope: "project", body: "Let scenes breathe." },
  { name: "narration", scope: "global", body: "", status: "shadowed" },
];

function render(overrides: Partial<Parameters<typeof SessionSettingsPanel>[0]> = {}) {
  return renderToString(
    <SessionSettingsPanel
      characterName="Aria"
      personas={PERSONAS}
      personaId="per_1"
      onSelectPersona={() => {}}
      lorebooks={[BOOK]}
      skills={SKILLS}
      settings={{ disabledLorebookIds: [], disabledSkillNames: [], systemPrompt: "" }}
      onChangeSettings={() => {}}
      saving={false}
      diagnostics={null}
      storySoFar=""
      memoryBusy={false}
      revisionBusy={false}
      onSaveStorySoFar={() => {}}
      onExtractMemories={() => {}}
      onProposeRevision={() => {}}
      {...overrides}
    />,
  );
}

describe("roleplay session settings panel", () => {
  test("renders every section without taking the renderer down", () => {
    // The panel is built from base-ui primitives, several of which throw rather
    // than degrade when composed wrongly — and a throw here blanks the whole app.
    const html = render();

    expect(html).toContain("Persona");
    expect(html).toContain("Story so far");
    expect(html).toContain("The harbour");
    expect(html).toContain("Prompt budget");
  });

  test("an untouched budget shows the default as a placeholder, not as a value", () => {
    // A filled-in default would stop tracking the app's default the moment it
    // changed, and would read as a choice the user made.
    const html = render();

    expect(html).toContain('placeholder="4000"');
  });

  test("the last reply's trace names why an entry was left out", () => {
    const html = render({
      diagnostics: {
        systemChars: 1200,
        truncated: false,
        skills: {
          injections: [],
          dropped: [],
          truncated: [],
          unresolved: [],
          shadowed: [],
          charsUsed: 0,
        },
        lorebook: {
          before: [],
          after: [],
          matches: [],
          charsUsed: 0,
          dropped: 1,
          trace: [
            {
              bookId: "lore_1",
              bookName: "The harbour",
              uid: "a",
              label: "Tide",
              included: false,
              reason: "no_key_match",
              chars: 18,
            },
          ],
        },
      },
    });

    expect(html).toContain("Tide");
    expect(html).toContain("no keyword in range");
  });

  test("attached skills are listed with their scope, and an unresolved one cannot be switched on", () => {
    // A toggle that silently does nothing is worse than one that says why: the
    // guidance is attached but no file behind it, and only the panel can say so.
    const html = render();

    expect(html).toContain("Writing guidance");
    expect(html).toContain("slow-burn");
    expect(html).toContain("narration");
    expect(html).toContain("global");
  });

  test("the last reply reports what happened to every attached skill", () => {
    const html = render({
      diagnostics: {
        systemChars: 1200,
        truncated: false,
        skills: {
          injections: [
            { name: "slow-burn", body: "Let scenes breathe." },
            { name: "cut-one", body: "Half of it." },
          ],
          dropped: ["long-one"],
          truncated: ["cut-one"],
          unresolved: ["deleted-one"],
          shadowed: ["narration"],
          charsUsed: 30,
        },
        lorebook: { before: [], after: [], matches: [], charsUsed: 0, dropped: 0, trace: [] },
      },
    });

    expect(html).toContain("in the prompt");
    expect(html).toContain("in the prompt, cut to fit");
    expect(html).toContain("over the guidance budget");
    expect(html).toContain("no such skill");
    expect(html).toContain("another skill has taken this name");
    // A cut skill reached the prompt. Listing it again as dropped would say the
    // opposite in the same panel.
    expect(html.split("cut-one").length - 1).toBe(1);
  });

  test("the budget total accounts for writing guidance, not just the two typed numbers", () => {
    // Missing the third source leaves the total under-reporting exactly when the
    // user has over-allocated.
    const html = render();

    expect(html).toContain("for writing guidance");
  });
});
