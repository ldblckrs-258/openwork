import { describe, expect, test } from "vitest";
import {
  BLOCK_MARKERS,
  compileBlocks,
  compileDraftText,
  detectBlockTrigger,
  matchBlockMarker,
  parseBlocks,
  serializeBlocks,
  triggerLiteral,
} from "../../../apps/app/src/app/roleplay/blocks.ts";

describe("trigger detection", () => {
  test("a punctuation trigger fires only at the start of a line", () => {
    // Without this guard, quoting anything inside dialogue spawns a nested
    // block — and quotation marks are ordinary prose.
    expect(detectBlockTrigger('"')?.type).toBe("dialogue");
    expect(detectBlockTrigger('He said "')).toBeNull();
    expect(detectBlockTrigger('"You are late.')).toBeNull();
  });

  test("all three punctuation triggers map to their block type", () => {
    expect(detectBlockTrigger('"')?.type).toBe("dialogue");
    expect(detectBlockTrigger("*")?.type).toBe("action");
    expect(detectBlockTrigger("[")?.type).toBe("director");
  });

  test("slash triggers need their trailing space so partial words do not fire", () => {
    expect(detectBlockTrigger("/say ")?.type).toBe("dialogue");
    expect(detectBlockTrigger("/say")).toBeNull();
    expect(detectBlockTrigger("/says ")).toBeNull();
  });

  test("a punctuation trigger reports the literal it consumed so one keystroke restores it", () => {
    // The undo is what makes shipping punctuation triggers safe: a user who
    // starts an ordinary line with a quotation mark pays one Backspace.
    expect(triggerLiteral("dialogue")).toBe('"');
    expect(triggerLiteral("action")).toBe("*");
    expect(triggerLiteral("director")).toBe("[");
  });
});

describe("compilation", () => {
  test("dialogue and action reach the message in authored order", () => {
    // Action-then-dialogue reads differently from dialogue-then-action, so the
    // model is an ordered list rather than three fixed fields.
    const actionFirst = compileDraftText(`${BLOCK_MARKERS.action}straightens papers\n${BLOCK_MARKERS.dialogue}You're late.`);
    const dialogueFirst = compileDraftText(`${BLOCK_MARKERS.dialogue}You're late.\n${BLOCK_MARKERS.action}straightens papers`);

    expect(actionFirst.messageText).toBe('*straightens papers*\n"You\'re late."');
    expect(dialogueFirst.messageText).toBe('"You\'re late."\n*straightens papers*');
  });

  test("director text leaves on its own channel and never appears in the message", () => {
    // Steering that shares a channel with in-character content gets treated as
    // scene content or echoed back at the user.
    const compiled = compileDraftText(
      `${BLOCK_MARKERS.dialogue}Where is the key?\n${BLOCK_MARKERS.director}keep her evasive`,
    );

    expect(compiled.directorText).toBe("keep her evasive");
    expect(compiled.messageText).toBe('"Where is the key?"');
    expect(compiled.messageText).not.toContain("evasive");
  });

  test("action text reaches the model verbatim between its delimiters", () => {
    const compiled = compileDraftText(`${BLOCK_MARKERS.action}I reach for the ledger, slowly`);

    expect(compiled.messageText).toBe("*I reach for the ledger, slowly*");
  });

  test("text the user already delimited is not delimited twice", () => {
    expect(compileDraftText(`${BLOCK_MARKERS.dialogue}"Fine."`).messageText).toBe('"Fine."');
    expect(compileDraftText(`${BLOCK_MARKERS.action}*shrugs*`).messageText).toBe("*shrugs*");
  });

  test("untriggered text survives verbatim rather than being promoted to dialogue", () => {
    // A roleplay turn is still free text; silently quoting a line the user did
    // not mark as speech would put words in their character's mouth.
    const compiled = compileDraftText("she waits by the door");

    expect(compiled.messageText).toBe("she waits by the door");
    expect(compiled.blocks).toEqual([{ type: "plain", text: "she waits by the door" }]);
  });

  test("an unmarked line continues the block above it", () => {
    // Otherwise a dialogue block wrapped over two lines compiles as one quoted
    // line followed by a bare one.
    const compiled = compileDraftText(`${BLOCK_MARKERS.dialogue}Hello.\nAre you well?`);

    expect(compiled.messageText).toBe('"Hello.\nAre you well?"');
  });

  test("empty blocks are dropped instead of emitting stray delimiters", () => {
    expect(compileBlocks([{ type: "dialogue", text: "   " }, { type: "director", text: "" }])).toEqual({
      messageText: "",
      directorText: "",
    });
  });

  test("a director-only turn produces steering and no message at all", () => {
    // The send path has to notice this case specifically: its "is there anything
    // to send" check reads the message text, which is empty here, so without a
    // director-aware guard the instruction is silently dropped.
    const compiled = compileDraftText(`${BLOCK_MARKERS.director}skip ahead to the next morning`);

    expect(compiled.messageText).toBe("");
    expect(compiled.directorText).toBe("skip ahead to the next morning");
  });
});

describe("draft round trip", () => {
  test("blocks survive the composer's flat-string codec", () => {
    // The composer serializes its whole state to one string and rebuilds from
    // it, so a chip with no textual form would vanish on the next save/restore.
    const blocks = parseBlocks(`${BLOCK_MARKERS.action}waits\n${BLOCK_MARKERS.dialogue}Well?\n${BLOCK_MARKERS.director}be curt`);

    expect(serializeBlocks(blocks)).toBe(`${BLOCK_MARKERS.action}waits\n${BLOCK_MARKERS.dialogue}Well?\n${BLOCK_MARKERS.director}be curt`);
    expect(parseBlocks(serializeBlocks(blocks))).toEqual(blocks);
  });

  test("a multi-line block round-trips without gaining a marker", () => {
    const original = `${BLOCK_MARKERS.dialogue}One.\nTwo.`;

    expect(serializeBlocks(parseBlocks(original))).toBe(original);
  });

  test("the editor recognises only a leading marker, so marker-like prose stays text", () => {
    expect(matchBlockMarker(`${BLOCK_MARKERS.dialogue}hi`)?.type).toBe("dialogue");
    expect(matchBlockMarker(`he wrote ${BLOCK_MARKERS.dialogue} on the board`)).toBeNull();
  });
});
