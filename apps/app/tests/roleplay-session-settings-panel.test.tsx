import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { SessionSettingsPanel } from "../src/react-app/domains/roleplay/components/session-settings-panel";
import type { RoleplayLorebookRecord, RoleplayPersonaRecord } from "@openwork/types/roleplay";

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

function render(overrides: Partial<Parameters<typeof SessionSettingsPanel>[0]> = {}) {
  return renderToString(
    <SessionSettingsPanel
      characterName="Aria"
      personas={PERSONAS}
      personaId="per_1"
      onSelectPersona={() => {}}
      lorebooks={[BOOK]}
      settings={{ disabledLorebookIds: [], systemPrompt: "" }}
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
});
