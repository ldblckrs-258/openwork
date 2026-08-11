import {
  $applyNodeReplacement,
  $createTextNode,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isElementNode,
  $createRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_BACKSPACE_COMMAND,
  KEY_DOWN_COMMAND,
  TextNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";

import { BLOCK_MARKERS, detectBlockTrigger, triggerLiteral, type AuthoredBlockType } from "@/app/roleplay/blocks";

type SerializedRoleplayBlockNode = Spread<
  {
    blockType: AuthoredBlockType;
    type: "roleplay-block";
    version: 1;
  },
  SerializedTextNode
>;

const CHIP_LABEL: Record<AuthoredBlockType, string> = {
  dialogue: "Say",
  action: "Do",
  director: "OOC",
};

const CHIP_TITLE: Record<AuthoredBlockType, string> = {
  dialogue: "Dialogue — sent as \"quoted\" speech",
  action: "Action — sent as *narrated* action",
  director: "Director — steers the model, never sent as your message",
};

const CHIP_CLASS: Record<AuthoredBlockType, string> = {
  dialogue: "mr-1 inline-flex items-center rounded-full border border-sky-6/35 bg-sky-3/20 px-2 py-0.5 text-[11px] font-medium text-sky-11",
  action: "mr-1 inline-flex items-center rounded-full border border-green-6/35 bg-green-3/20 px-2 py-0.5 text-[11px] font-medium text-green-11",
  director: "mr-1 inline-flex items-center rounded-full border border-amber-6/35 bg-amber-3/20 px-2 py-0.5 text-[11px] font-medium text-amber-11",
};

/**
 * A block marker chip.
 *
 * Its text content is the marker string, not the label, because the composer's
 * whole state is serialized to a flat draft string and rebuilt from it — a chip
 * that rendered without a textual form would vanish on the next round trip.
 * Same arrangement as the existing skill chip, which reads `[skill x]` and
 * displays `/x`.
 */
export class RoleplayBlockNode extends TextNode {
  __blockType: AuthoredBlockType;

  static override getType() {
    return "roleplay-block";
  }

  static override clone(node: RoleplayBlockNode) {
    return new RoleplayBlockNode(node.__blockType, node.__key);
  }

  static override importJSON(serializedNode: SerializedRoleplayBlockNode) {
    return $createRoleplayBlockNode(serializedNode.blockType);
  }

  constructor(blockType: AuthoredBlockType = "dialogue", key?: NodeKey) {
    super(BLOCK_MARKERS[blockType], key);
    this.__blockType = blockType;
  }

  getBlockType(): AuthoredBlockType {
    return this.__blockType;
  }

  override exportJSON(): SerializedRoleplayBlockNode {
    return {
      ...super.exportJSON(),
      blockType: this.__blockType,
      type: "roleplay-block",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.className = CHIP_CLASS[this.__blockType];
    dom.textContent = CHIP_LABEL[this.__blockType];
    dom.contentEditable = "false";
    dom.setAttribute("spellcheck", "false");
    dom.title = CHIP_TITLE[this.__blockType];
    return dom;
  }

  override updateDOM(prevNode: RoleplayBlockNode, dom: HTMLElement) {
    if (prevNode.__blockType !== this.__blockType) {
      dom.className = CHIP_CLASS[this.__blockType];
      dom.textContent = CHIP_LABEL[this.__blockType];
      dom.title = CHIP_TITLE[this.__blockType];
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

export function $createRoleplayBlockNode(blockType: AuthoredBlockType) {
  return $applyNodeReplacement(new RoleplayBlockNode(blockType));
}

export function $isRoleplayBlockNode(node: LexicalNode | null | undefined): node is RoleplayBlockNode {
  return node instanceof RoleplayBlockNode;
}

function $selectAfter(node: TextNode) {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return;
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent() + 1;
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}

/**
 * A line begins at the start of its paragraph or immediately after a line break.
 *
 * Under `PlainTextPlugin` both Enter and Shift+Enter insert a `LineBreakNode`
 * inside the current paragraph rather than starting a new one, so "first child
 * of the paragraph" alone would only ever recognise the first line of a turn.
 */
function $isAtLineStart(node: LexicalNode): boolean {
  const previous = node.getPreviousSibling();
  return previous === null || $isLineBreakNode(previous);
}

function $lineStartNode(from: LexicalNode): LexicalNode | null {
  let node: LexicalNode | null = from;
  while (node) {
    if ($isAtLineStart(node)) return node;
    node = node.getPreviousSibling();
  }
  return null;
}

const BLOCK_SHORTCUT_KEYS: Record<string, AuthoredBlockType> = {
  Digit1: "dialogue",
  Digit2: "action",
  Digit3: "director",
};

/**
 * Wire per-line block triggers into an editor.
 *
 * Returned as a registration function rather than a component so the caller has
 * to make an explicit decision to install it: a session that is not a roleplay
 * session never calls this, and therefore provably never runs any of the logic
 * below. That matters because this is the shared composer every ordinary chat
 * uses, and `"` and `*` are ordinary characters in ordinary prose.
 */
/**
 * Only the most recent revert needs remembering: reverting turns the chip back
 * into the literal character, which would otherwise match the trigger again on
 * the very next transform pass and re-fire the block the user just undid.
 *
 * Held per editor rather than in a closure so the revert and the transform that
 * has to honour it are the same piece of state even when the revert is invoked
 * directly.
 */
const suppressedRevertByEditor = new WeakMap<LexicalEditor, { key: NodeKey | null }>();

export function registerRoleplayBlockTriggers(editor: LexicalEditor): () => void {
  const suppressed = { key: null as NodeKey | null };
  suppressedRevertByEditor.set(editor, suppressed);

  const unregisterTransform = editor.registerNodeTransform(TextNode, (node) => {
    if (node.getType() !== "text") return;
    if (node.getKey() === suppressed.key) return;
    if (!$isAtLineStart(node)) return;
    const trigger = detectBlockTrigger(node.getTextContent());
    if (!trigger) return;
    suppressed.key = null;
    const marker = $createRoleplayBlockNode(trigger.type);
    node.replace(marker);
    $selectAfter(marker);
  });

  const unregisterBackspace = editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    () => $revertRoleplayBlockAtCursor(editor),
    COMMAND_PRIORITY_CRITICAL,
  );

  const unregisterShortcut = editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return false;
      const blockType = BLOCK_SHORTCUT_KEYS[event.code];
      if (!blockType) return false;
      if (!$setRoleplayBlockTypeForLine(blockType)) return false;
      event.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );

  return () => {
    unregisterTransform();
    unregisterBackspace();
    unregisterShortcut();
  };
}

/**
 * Turn the block chip immediately before the cursor back into the character the
 * user actually typed.
 *
 * A punctuation trigger has to cost exactly one keystroke to undo, because the
 * characters that fire it are ordinary punctuation and the design accepts that
 * it will sometimes fire when the user meant prose. Slash-triggered chips have
 * no single literal to restore, so they delete like every other chip.
 */
export function $revertRoleplayBlockAtCursor(editor: LexicalEditor): boolean {
  const suppressed = suppressedRevertByEditor.get(editor);
  if (!suppressed) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchorNode = selection.anchor.getNode();
  const candidate = $isElementNode(anchorNode)
    ? anchorNode.getChildAtIndex(selection.anchor.offset - 1)
    : selection.anchor.offset === 0
      ? anchorNode.getPreviousSibling()
      : null;
  if (!$isRoleplayBlockNode(candidate)) return false;
  const literal = triggerLiteral(candidate.getBlockType());
  if (!literal) {
    candidate.remove();
    return true;
  }
  const restored = $createTextNode(literal);
  candidate.replace(restored);
  suppressed.key = restored.getKey();
  $selectAfter(restored);
  return true;
}

/**
 * Set, change, or clear the block type of the line the cursor is on.
 *
 * This is the keyboard-only path: the triggers require starting a line, but a
 * user who has already typed a line must be able to retype it as dialogue
 * without reaching for the mouse.
 */
export function $setRoleplayBlockTypeForLine(blockType: AuthoredBlockType): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const anchorNode = selection.anchor.getNode();
  const from = $isElementNode(anchorNode)
    ? anchorNode.getChildAtIndex(selection.anchor.offset) ?? anchorNode.getChildAtIndex(selection.anchor.offset - 1)
    : anchorNode;
  const start = from ? $lineStartNode(from) : null;

  if ($isRoleplayBlockNode(start)) {
    if (start.getBlockType() === blockType) {
      start.remove();
      return true;
    }
    const replacement = $createRoleplayBlockNode(blockType);
    start.replace(replacement);
    $selectAfter(replacement);
    return true;
  }

  const marker = $createRoleplayBlockNode(blockType);
  if (start) {
    start.insertBefore(marker);
  } else if ($isElementNode(anchorNode)) {
    anchorNode.append(marker);
  } else {
    return false;
  }
  $selectAfter(marker);
  return true;
}
