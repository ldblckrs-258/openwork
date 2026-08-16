import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import type { RoleplaySceneState, SceneRecord } from "@openwork/types/roleplay";
import { SceneStateHud } from "../src/react-app/domains/roleplay/components/scene-state-hud";
import { SceneRecordEditor } from "../src/react-app/domains/roleplay/components/scene-record-editor";

function record(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return { id: "sr_1", type: "clothes", name: "silk blouse", state: "worn", description: "", ...overrides };
}

function scene(records: SceneRecord[], revision = 0): RoleplaySceneState {
  return { records, revision, updatedAt: 1_700_000_000 };
}

function hud(state: RoleplaySceneState, overrides: { error?: string | null; busy?: boolean } = {}) {
  return renderToStaticMarkup(
    <SceneStateHud
      state={state}
      busy={overrides.busy ?? false}
      error={overrides.error ?? null}
      onPatch={() => {}}
      onDismissError={() => {}}
    />,
  );
}

describe("collapsed, the panel is a pill and nothing else", () => {
  test("no record text is rendered until it is opened", () => {
    // The panel floats over the transcript, so anything wider than a pill sits
    // on the sentence the user is reading. The collapsed state used to carry a
    // line per type; it carries none, and the coloured dots do that job in a
    // fraction of the width.
    const markup = hud(
      scene([
        record({ id: "sr_1", name: "silk blouse", state: "displaced" }),
        record({ id: "sr_2", name: "pencil skirt", state: "worn" }),
        record({ id: "sr_3", type: "pose", name: "", state: "kneeling on the rug" }),
      ]),
    );

    expect(markup).not.toContain("silk blouse");
    expect(markup).not.toContain("kneeling on the rug");
    // The editing controls belong to the expanded panel; none of them are
    // rendered until it is opened.
    expect(markup).not.toContain("Add record");
  });

  test("it carries the count, so the size of the scene is legible without opening it", () => {
    const markup = hud(scene([record({ id: "sr_1" }), record({ id: "sr_2" })]));

    expect(markup).toContain("Scene");
    expect(markup).toContain(">2<");
  });

  test("one dot per type, in the type's own colour", () => {
    // The dots are what let the pill be this small: the colour a type wears here
    // is the colour it wears in the expanded rows, so "the amber one moved" is
    // information before anything is opened.
    const markup = hud(
      scene([record({ id: "sr_1", type: "clothes" }), record({ id: "sr_2", type: "location", name: "the pier" })]),
    );

    expect(markup).toContain("bg-amber-9");
    expect(markup).toContain("bg-cyan-9");
  });

  test("the dot row is capped, so a busy scene cannot stretch the pill", () => {
    const markup = hud(
      scene([
        record({ id: "sr_1", type: "clothes" }),
        record({ id: "sr_2", type: "pose" }),
        record({ id: "sr_3", type: "location" }),
        record({ id: "sr_4", type: "toys" }),
        record({ id: "sr_5", type: "climax", count: 1 }),
        record({ id: "sr_6", type: "body_parts" }),
      ]),
    );

    expect(markup).toContain("+2");
  });
});

describe("expanded, nothing is truncated", () => {
  // The expanded panel is behind a click, and this app has no DOM harness — so
  // the invariant is asserted against the source instead. That is narrower than
  // a render test but it is not weaker for this particular rule: truncation can
  // only be reintroduced by writing one of these affordances, and there is no
  // legitimate use of any of them in a panel whose whole job is to show a record
  // the user has to make a decision about.
  // Comments stripped first. The component's own docblock explains that it does
  // not truncate, and a guard that matched that sentence would fail on the very
  // prose describing the rule it enforces.
  const source = readFileSync(
    new URL("../src/react-app/domains/roleplay/components/scene-state-hud.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("no clipping utility appears anywhere in the component", () => {
    expect(source).not.toContain("truncate");
    expect(source).not.toContain("line-clamp");
    expect(source).not.toContain("text-ellipsis");
  });

  test("no `title` attribute stands in for text that did not fit", () => {
    // A tooltip carrying the full value is the tell that the visible value was
    // cut. It also puts the record's state behind a hover, which is unreachable
    // on a touch device and unreadable to a screen reader.
    expect(source).not.toContain("title={");
  });

  test("record fields wrap rather than being held to one line", () => {
    expect(source).toContain("break-words");
    expect(source).not.toContain("whitespace-nowrap");
  });
});

describe("a refused edit", () => {
  test("is reported in the panel rather than reverting the row silently", () => {
    // The refusal that matters says a turn landed while the user was typing. A
    // panel that snapped back to the model's version instead would read as the
    // edit never having taken.
    const markup = hud(scene([record()]), {
      error: "patch: computed against revision 3, but the scene is at revision 4",
    });

    expect(markup).toContain("but the scene is at revision 4");
    expect(markup).toContain("Dismiss scene error");
  });

  test("is visible while the panel is still collapsed", () => {
    // Collapsed is the default state, so a refusal only shown to an open panel
    // is a refusal most users would never see.
    expect(hud(scene([record()]), { error: "Nope." })).toContain("Nope.");
  });
});

describe("authoring a character's opening scene", () => {
  test("the type field offers the known types without refusing anything else", () => {
    // A select here would quietly close the open type set at the one place a
    // person would extend it.
    const markup = renderToStaticMarkup(
      <SceneRecordEditor records={[record({ id: "sr_1", type: "weather", name: "rain" })]} onChange={() => {}} />,
    );

    expect(markup).toContain("<datalist");
    expect(markup).toContain('value="clothes"');
    expect(markup).toContain('value="weather"');
    expect(markup).not.toContain("<select");
  });

  test("an empty scene says so rather than rendering as a broken list", () => {
    const markup = renderToStaticMarkup(<SceneRecordEditor records={[]} onChange={() => {}} />);

    expect(markup).toContain("No records");
  });

  test("every row control is reachable by name", () => {
    const markup = renderToStaticMarkup(
      <SceneRecordEditor records={[record({ id: "sr_1" }), record({ id: "sr_2" })]} onChange={() => {}} />,
    );

    expect(markup).toContain("Record 1 type");
    expect(markup).toContain("Record 1 state");
    expect(markup).toContain("Remove record 2");
    expect(markup).toContain("Move record 2 up");
  });
});
