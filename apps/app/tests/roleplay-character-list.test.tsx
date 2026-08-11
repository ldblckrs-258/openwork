import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { CharacterList } from "../src/react-app/domains/roleplay/pages/character-list";
import type { RoleplayCharacterRecord } from "@openwork/types/roleplay";

function character(overrides: Partial<RoleplayCharacterRecord["card"]["data"]> = {}): RoleplayCharacterRecord {
  return {
    id: "chr_1",
    card: {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Aria",
        description: "The archivist.",
        personality: "",
        scenario: "",
        first_mes: "You're late.",
        mes_example: "",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: ["The library is shut.\nCome back tomorrow."],
        tags: [],
        creator: "",
        character_version: "",
        extensions: {},
        ...overrides,
      },
    },
    charSubstitutionName: "Aria",
    source: "authored",
    createdAt: 1,
    updatedAt: 1,
  };
}

function render(record: RoleplayCharacterRecord) {
  return renderToString(
    <CharacterList
      characters={[record]}
      loading={false}
      lorebookCounts={{}}
      canWriteOpening
      onCreate={() => {}}
      onOpen={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
      onStartChat={() => {}}
      onImport={() => {}}
      onOpenMemories={() => {}}
      onOpenRevisions={() => {}}
    />,
  );
}

describe("character list", () => {
  test("renders a row with its actions", () => {
    const html = render(character());

    expect(html).toContain("Aria");
    expect(html).toContain("Start a chat with Aria from a different opening");
  });

});
