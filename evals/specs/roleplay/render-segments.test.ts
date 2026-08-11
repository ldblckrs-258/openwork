import { describe, expect, test } from "vitest";
import { segmentRoleplayText } from "../../../apps/app/src/app/roleplay/render-segments.ts";
import { substituteMacros } from "../../../apps/app/src/app/roleplay/macros.ts";

function kinds(text: string): string[] {
  return segmentRoleplayText(text).map((segment) => segment.kind);
}

function textOf(text: string, kind: string): string[] {
  return segmentRoleplayText(text)
    .filter((segment) => segment.kind === kind)
    .map((segment) => segment.text);
}

describe("reading conventions", () => {
  test("speech keeps its quotes", () => {
    // Colour alone would not survive a copy-paste out of the transcript.
    expect(textOf('She looked up. "You\'re late," she said.', "speech")).toEqual(['"You\'re late,"']);
  });

  test("curly quotes read as speech too", () => {
    // What a model writes when it is being typographically tidy.
    expect(textOf("“You're late,” she said.", "speech")).toEqual(["“You're late,”"]);
  });

  test("action drops its asterisks, single or double", () => {
    // They rendered as italics with no asterisks under the markdown renderer
    // this replaces; keeping them would read as a regression.
    expect(textOf("*shrugs* and **turns away**", "action")).toEqual(["shrugs", "turns away"]);
  });

  test("brackets and doubled parentheses are out of character", () => {
    expect(textOf("[are you still there?]", "ooc")).toEqual(["[are you still there?]"]);
    expect(textOf("((be right back))", "ooc")).toEqual(["((be right back))"]);
    expect(textOf("(OOC: one moment)", "ooc")).toEqual(["(OOC: one moment)"]);
  });

  test("an ordinary parenthetical stays narration", () => {
    // The load-bearing exclusion: prose is full of these, and colouring them as
    // out-of-character would be wrong far more often than right.
    expect(kinds("She paused (again) before answering.")).toEqual(["narration"]);
  });

  test("everything between the markers is narration", () => {
    expect(kinds('The door opened. "Hello." *steps inside*')).toEqual([
      "narration",
      "speech",
      "narration",
      "action",
    ]);
  });
});

describe("robustness", () => {
  test("an unterminated quote stops at the end of its line", () => {
    // Otherwise one stray quote recolours every paragraph after it.
    const segments = segmentRoleplayText('"She never finished the\nThe next line is ordinary prose.');

    expect(segments.map((segment) => segment.kind)).toEqual(["narration"]);
  });

  test("an empty pair of delimiters stays prose rather than becoming an invisible span", () => {
    expect(kinds('He said "" and left.')).toEqual(["narration"]);
  });

  test("plain prose is one segment", () => {
    expect(segmentRoleplayText("Nothing marked here at all.")).toEqual([
      { kind: "narration", text: "Nothing marked here at all." },
    ]);
  });

  test("empty text produces no segments", () => {
    expect(segmentRoleplayText("")).toEqual([]);
  });

  test("no character of the input is lost or duplicated", () => {
    // The renderer prints these segments in order, so anything dropped here is
    // text that silently disappears from the transcript.
    const source = 'Rain. "Come in," *she stepped back* [ooc: brb] (again) **now**';
    const segments = segmentRoleplayText(source);
    const rebuilt = segments
      .map((segment) => (segment.kind === "action" ? `*${segment.text}*` : segment.text))
      .join("");

    expect(rebuilt.replace(/\*+/g, "*")).toBe(source.replace(/\*+/g, "*"));
  });
});

describe("macros", () => {
  test("macros are substituted before the text is split", () => {
    // Order matters: substituting afterwards would leave `{{user}}` inside a
    // quoted span untouched.
    const rendered = substituteMacros('"Hello, {{user}}," said {{char}}.', { char: "Aria", user: "Wren" });

    expect(textOf(rendered, "speech")).toEqual(['"Hello, Wren,"']);
    expect(textOf(rendered, "narration")).toEqual([" said Aria."]);
  });

  test("a name that is itself a macro is not expanded twice", () => {
    // The card author picks the name, so this is an injection path if it recurses.
    expect(substituteMacros("I am {{char}}.", { char: "{{user}}", user: "Wren" })).toBe("I am {{user}}.");
  });
});
