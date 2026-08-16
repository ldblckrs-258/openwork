import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import type { RoleplaySceneChangeRecord } from "@openwork/types/roleplay";
import { SceneChangeRail } from "../src/components/chat/scene-change-rail";

function change(overrides: Partial<RoleplaySceneChangeRecord> = {}): RoleplaySceneChangeRecord {
  return { id: "sr_1", type: "clothes", name: "silk blouse", state: "unbuttoned", kind: "changed", ...overrides };
}

function rail(records: RoleplaySceneChangeRecord[]) {
  return renderToStaticMarkup(<SceneChangeRail records={records} />);
}

describe("at rest it is one quiet line", () => {
  // A reader is reading. A row of chips under every paragraph is a second thing
  // competing with the first, and in a long scene it doubles the height of the
  // transcript with bookkeeping.
  test("no record text is rendered until it is opened", () => {
    const markup = rail([change(), change({ id: "sr_2", type: "location", name: "the pier", state: "empty" })]);

    expect(markup).not.toContain("silk blouse");
    expect(markup).not.toContain("the pier");
    expect(markup).toContain('aria-expanded="false"');
    // Not mounted behind a style, either. A collapsed note left in the DOM would
    // put every chip in a long scene into the accessibility tree and into a
    // find-in-page the reader did not ask for — so the chip surfaces themselves
    // must be absent, not merely invisible.
    expect(markup).not.toContain("bg-amber-3");
    expect(markup).not.toContain("bg-cyan-3");
  });

  test("it carries the count, so the size of the change is legible without opening it", () => {
    const markup = rail([change(), change({ id: "sr_2" }), change({ id: "sr_3" })]);

    expect(markup).toContain(">3<");
  });

  test("one dot per kind of thing that moved, in that kind's own colour", () => {
    // The colours are the ones the panel already taught the reader, so
    // "something about clothes changed here" is legible without opening
    // anything. That is what lets the resting state be this small.
    const markup = rail([change({ type: "clothes" }), change({ id: "sr_2", type: "location", name: "the pier" })]);

    expect(markup).toContain("bg-amber-9");
    expect(markup).toContain("bg-cyan-9");
  });

  test("two records of one kind share a dot, so the row counts kinds rather than records", () => {
    const markup = rail([change({ type: "clothes" }), change({ id: "sr_2", type: "clothes", name: "pencil skirt" })]);

    expect(markup.match(/bg-amber-9/g) ?? []).toHaveLength(1);
    expect(markup).toContain(">2<");
  });

  test("an open type set cannot grow the row without bound", () => {
    // Every type nobody anticipated shares the neutral, which caps this at the
    // six known kinds plus one. The count beside it is what keeps the collapsing
    // from losing anything.
    const invented = ["weather", "mood", "music", "smell"].map((type, index) =>
      change({ id: `sr_${index}`, type, name: type }),
    );
    const markup = rail(invented);

    expect(markup.match(/bg-slate-9/g) ?? []).toHaveLength(1);
    expect(markup).toContain(">4<");
  });
});

describe("a reply that changed nothing", () => {
  test("renders no rail at all, not an empty one", () => {
    // A hairline with nothing under it reads as a rendering fault, and it would
    // appear under every reply in a session that tracks no state.
    expect(rail([])).toBe("");
  });
});

describe("the disclosure itself", () => {
  const source = readFileSync(new URL("../src/components/chat/scene-change-rail.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("opens closed", () => {
    // The ask, and the reason for the whole shape: bookkeeping does not get to
    // interrupt a scene by default.
    expect(source).toContain("useState(false)");
  });

  test("is reachable by keyboard and says what it controls", () => {
    expect(source).toContain("aria-expanded");
    expect(source).toContain("aria-controls");
    expect(source).toContain("focus-visible:ring-2");
  });

  test("the trigger is big enough to hit on a touch screen", () => {
    // The row is 16px tall and a finger needs 44. An invisible box is the only
    // way to have both at a density where a taller control would out-weigh the
    // prose above it.
    expect(source).toContain("before:-inset-3");
  });

  test("motion is state-conveying only, and stops for a reader who asked it to", () => {
    expect(source).not.toContain("transition: all");
    expect(source).not.toContain("animate-");
    expect(source).toContain("motion-reduce:transition-none");
  });
});

describe("opened, it is a note in a margin rather than the panel", () => {
  const source = readFileSync(new URL("../src/components/chat/scene-change-rail.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("a long name wraps rather than being cut", () => {
    // This is allowed to be shorter than the truth in one way only — it caps the
    // number of chips and says so. Cutting a garment's name in half would make a
    // chip that lies about state.
    expect(source).toContain("break-words");
    expect(source).not.toContain("truncate");
    expect(source).not.toContain("line-clamp");
    expect(source).not.toContain("title={");
  });

  test("an inventory is capped, and the remainder is counted out loud", () => {
    expect(source).toContain("+{hidden} more");
  });

  test("a record the reply introduced reads as an addition", () => {
    expect(source).toContain('`+ ${name}`');
  });

  test("a record with no name falls back to its type rather than rendering an empty chip", () => {
    expect(source).toContain("sceneTypeLabel(record.type)");
  });
});
