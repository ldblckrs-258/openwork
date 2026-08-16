import { describe, expect, test } from "vitest";
import {
  applyCardEdit,
  createBlankCharacter,
  duplicateCharacter,
  validateCharacter,
} from "../../../apps/app/src/app/roleplay/character-draft.ts";
import { joinExampleMessages, splitExampleMessages } from "../../../apps/app/src/app/roleplay/macros.ts";
import { compilePrompt } from "../../../apps/app/src/app/roleplay/compile-prompt.ts";

function filled() {
  const blank = createBlankCharacter("chr_1", 1_700_000_000);
  return applyCardEdit(blank, { name: "Aria", first_mes: "You're late." }, 1_700_000_001);
}

describe("validation", () => {
  test("a blank character cannot be saved, and says which fields are missing", () => {
    const errors = validateCharacter(createBlankCharacter("chr_1", 1));

    expect(errors.map((error) => error.field)).toEqual(expect.arrayContaining(["name", "first_mes"]));
    for (const error of errors) expect(error.message).not.toBe("");
  });

  test("name is required because it is what {{char}} resolves to", () => {
    const nameless = applyCardEdit(
      createBlankCharacter("chr_1", 1),
      { first_mes: "Hi.", description: "{{char}} guards the archive." },
      2,
    );

    expect(validateCharacter(nameless).some((error) => error.field === "name")).toBe(true);
    expect(compilePrompt(nameless.card, { name: "Wren", description: "" })).toContain("Character guards the archive.");
  });

  test("first message is required because the character speaks first", () => {
    const silent = applyCardEdit(createBlankCharacter("chr_1", 1), { name: "Aria" }, 2);

    expect(validateCharacter(silent).some((error) => error.field === "first_mes")).toBe(true);
  });

  test("a filled character validates clean", () => {
    expect(validateCharacter(filled())).toEqual([]);
  });
});

describe("editing", () => {
  test("editing the name keeps {{char}} substitution in step for authored characters", () => {
    const edited = applyCardEdit(filled(), { name: "Wren" }, 5);

    expect(edited.charSubstitutionName).toBe("Wren");
  });

  test("editing the name of an imported card does not overwrite its V3 nickname", () => {
    const imported = { ...filled(), source: "imported" as const, charSubstitutionName: "The Archivist" };
    const edited = applyCardEdit(imported, { name: "Aria of the Stacks" }, 6);

    expect(edited.card.data.name).toBe("Aria of the Stacks");
    expect(edited.charSubstitutionName).toBe("The Archivist");
  });

  test("an edit bumps updatedAt so the library can order by recency", () => {
    expect(applyCardEdit(filled(), { scenario: "A library." }, 9_999).updatedAt).toBe(9_999);
  });
});

describe("duplication", () => {
  test("a duplicate is a distinct, editable, authored character", () => {
    const copy = duplicateCharacter({ ...filled(), source: "imported" }, "chr_2", 42);

    expect(copy.id).toBe("chr_2");
    expect(copy.card.data.name).toBe("Aria copy");
    expect(copy.source).toBe("authored");
    expect(copy.createdAt).toBe(42);
  });

  test("duplicating a deleted character revives it rather than copying the tombstone", () => {
    const copy = duplicateCharacter({ ...filled(), deletedAt: 5 }, "chr_3", 43);

    expect(copy.deletedAt).toBeUndefined();
  });
});

describe("example dialogue blocks", () => {
  test("blocks round-trip through the <START> separators the editor writes", () => {
    const blocks = ["{{user}}: Hello\n{{char}}: Mm.", "{{user}}: Still open?\n{{char}}: Barely."];
    const joined = joinExampleMessages(blocks);

    expect(joined).toContain("<START>");
    expect(splitExampleMessages(joined)).toEqual(blocks);
  });

  test("empty blocks are dropped rather than emitting a stray separator", () => {
    expect(joinExampleMessages(["", "   "])).toBe("");
    expect(splitExampleMessages(joinExampleMessages(["one", "", "two"]))).toEqual(["one", "two"]);
  });

  test("joined blocks compile into separate examples", () => {
    const character = applyCardEdit(filled(), { mes_example: joinExampleMessages(["A: one", "B: two"]) }, 7);
    const compiled = compilePrompt(character.card, { name: "Wren", description: "" });

    expect(compiled).toContain("# Example Dialogue");
    expect(compiled).toContain("A: one");
    expect(compiled).toContain("B: two");
    expect(compiled).not.toContain("<START>");
  });
});
