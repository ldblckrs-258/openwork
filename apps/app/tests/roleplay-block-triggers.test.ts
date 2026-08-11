import { describe, expect, test } from "bun:test";
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode, createEditor, type LexicalEditor } from "lexical";

import { BLOCK_MARKERS } from "../src/app/roleplay/blocks";
import {
  $revertRoleplayBlockAtCursor,
  $setRoleplayBlockTypeForLine,
  RoleplayBlockNode,
  registerRoleplayBlockTriggers,
} from "../src/react-app/domains/session/surface/composer/roleplay-block-node";

// No root element is attached, so Lexical never reconciles to the DOM. Node
// transforms still run, which is the only part under test here.
function editorWith(options: { roleplay: boolean }): LexicalEditor {
  const editor = createEditor({
    namespace: "roleplay-block-trigger-spec",
    nodes: [RoleplayBlockNode],
    onError: (error) => {
      throw error;
    },
  });
  if (options.roleplay) registerRoleplayBlockTriggers(editor);
  return editor;
}

function typeLine(editor: LexicalEditor, text: string) {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      $getRoot().clear().append(paragraph);
    },
    { discrete: true },
  );
}

function draft(editor: LexicalEditor): string {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((child) => child.getTextContent())
      .join("\n"),
  );
}

describe("roleplay block triggers", () => {
  test("a line-start quotation mark becomes a dialogue block", () => {
    const editor = editorWith({ roleplay: true });

    typeLine(editor, '"');

    expect(draft(editor)).toBe(BLOCK_MARKERS.dialogue);
  });

  test("a quotation mark mid-line is left alone", () => {
    // Quoting inside dialogue must not spawn a nested block; the guard is what
    // makes shipping punctuation triggers survivable at all.
    const editor = editorWith({ roleplay: true });

    typeLine(editor, 'He said "hello"');

    expect(draft(editor)).toBe('He said "hello"');
  });

  test("all three triggers install", () => {
    for (const [character, marker] of [['"', BLOCK_MARKERS.dialogue], ["*", BLOCK_MARKERS.action], ["[", BLOCK_MARKERS.director]] as const) {
      const editor = editorWith({ roleplay: true });
      typeLine(editor, character);
      expect(draft(editor)).toBe(marker);
    }
  });

  test("a slash trigger becomes the same block as its punctuation twin", () => {
    const editor = editorWith({ roleplay: true });

    typeLine(editor, "/ooc ");

    expect(draft(editor)).toBe(BLOCK_MARKERS.director);
  });

  test("one keystroke reverts a punctuation trigger, and it does not re-fire", () => {
    // Residual risk the design accepts: a user starting an ordinary line with a
    // quotation mark still gets a block. The undo is what keeps that cheap — and
    // it has to stay undone, or the transform re-fires on the restored text.
    const editor = editorWith({ roleplay: true });

    typeLine(editor, '"');
    expect(draft(editor)).toBe(BLOCK_MARKERS.dialogue);

    editor.update(
      () => {
        const paragraph = $getRoot().getLastChild();
        if ($isElementNode(paragraph)) paragraph.select(1, 1);
        $revertRoleplayBlockAtCursor(editor);
      },
      { discrete: true },
    );
    expect(draft(editor)).toBe('"');

    editor.update(() => $getRoot().getLastChild()?.markDirty(), { discrete: true });
    expect(draft(editor)).toBe('"');
  });

  test("the block type of the current line is switchable without the mouse", () => {
    const editor = editorWith({ roleplay: true });

    typeLine(editor, "she waits");
    editor.update(
      () => {
        $getRoot().getLastChild()?.selectEnd();
        $setRoleplayBlockTypeForLine("action");
      },
      { discrete: true },
    );

    expect(draft(editor)).toBe(`${BLOCK_MARKERS.action}she waits`);
  });

  test("applying the same block type again clears it", () => {
    const editor = editorWith({ roleplay: true });

    typeLine(editor, "she waits");
    editor.update(
      () => {
        $getRoot().getLastChild()?.selectEnd();
        $setRoleplayBlockTypeForLine("action");
        $setRoleplayBlockTypeForLine("action");
      },
      { discrete: true },
    );

    expect(draft(editor)).toBe("she waits");
  });

  test("an ordinary session does not run the trigger logic at all", () => {
    // This is the load-bearing assertion for the shared composer: `"` and `*`
    // are ordinary characters in ordinary prose, and every non-roleplay chat in
    // the app uses this same editor. The logic is not merely inert here — it is
    // never registered.
    const editor = editorWith({ roleplay: false });

    typeLine(editor, '"');
    expect(draft(editor)).toBe('"');

    typeLine(editor, "*");
    expect(draft(editor)).toBe("*");

    typeLine(editor, "/ooc ");
    expect(draft(editor)).toBe("/ooc ");
  });
});
