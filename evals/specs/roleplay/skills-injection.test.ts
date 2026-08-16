import { describe, expect, test } from "vitest";
import {
  MAX_ATTACHED_SKILLS,
  MAX_SKILL_BODY_CHARS,
  SKILL_BUDGET_CHARS,
  classifyResolvedSkill,
  selectSkillInjections,
  stripSkillFrontmatter,
  type RoleplayAttachedSkill,
} from "../../../apps/app/src/app/roleplay/skills-injection.ts";

function skill(overrides: Partial<RoleplayAttachedSkill> = {}): RoleplayAttachedSkill {
  return { name: "slow-burn", scope: "project", body: "Let scenes breathe.", ...overrides };
}

describe("frontmatter", () => {
  test("a leading YAML block is stripped, the body is not", () => {
    const body = stripSkillFrontmatter("---\nname: slow-burn\ndescription: pacing\n---\n\nLet scenes breathe.");

    expect(body).toBe("Let scenes breathe.");
  });

  test("a horizontal rule inside a body is not mistaken for frontmatter", () => {
    const body = stripSkillFrontmatter("Let scenes breathe.\n\n---\n\nThen cut.");

    expect(body).toBe("Let scenes breathe.\n\n---\n\nThen cut.");
  });

  test("a body with no frontmatter survives unchanged", () => {
    expect(stripSkillFrontmatter("Let scenes breathe.")).toBe("Let scenes breathe.");
  });
});

describe("every lookup outcome resolves, so the composer never deadlocks", () => {
  test("a ref that looked up nothing resolves as missing rather than staying pending", () => {
    expect(classifyResolvedSkill({ name: "gone", scope: "project" }, null)).toEqual({
      name: "gone",
      scope: "project",
      body: "",
      status: "missing",
    });
  });

  test("a ref resolved in another scope resolves as shadowed, keeping the attached scope", () => {
    expect(
      classifyResolvedSkill({ name: "narration", scope: "global" }, { scope: "project", content: "Other text." }),
    ).toEqual({ name: "narration", scope: "global", body: "", status: "shadowed" });
  });

  test("a ref resolved in its own scope carries the body and no status", () => {
    expect(
      classifyResolvedSkill({ name: "slow-burn", scope: "project" }, { scope: "project", content: "Let scenes breathe." }),
    ).toEqual({ name: "slow-burn", scope: "project", body: "Let scenes breathe." });
  });
});

describe("resolution failures are reported, never substituted", () => {
  test("a ref that resolves to no skill is skipped and reported", () => {
    const selection = selectSkillInjections([skill({ name: "gone", status: "missing" }), skill()]);

    expect(selection.unresolved).toEqual(["gone"]);
    expect(selection.injections.map((entry) => entry.name)).toEqual(["slow-burn"]);
  });

  test("a ref that resolves in a different scope than it was attached from is unresolved", () => {
    const selection = selectSkillInjections([skill({ name: "narration", scope: "global", status: "shadowed" })]);

    expect(selection.shadowed).toEqual(["narration"]);
    expect(selection.injections).toEqual([]);
    expect(selection.unresolved).toEqual([]);
  });

  test("an unresolved ref does not consume a slot a live skill would have had", () => {
    const attached: RoleplayAttachedSkill[] = [
      ...Array.from({ length: MAX_ATTACHED_SKILLS }, (_, index) =>
        skill({ name: `dead-${index}`, status: "missing" as const }),
      ),
      skill({ name: "alive" }),
    ];

    const selection = selectSkillInjections(attached);

    expect(selection.injections.map((entry) => entry.name)).toEqual(["alive"]);
    expect(selection.dropped).toEqual([]);
  });
});

describe("caps and budget", () => {
  test("the section never exceeds the budget, however many skills are attached", () => {
    const attached = Array.from({ length: MAX_ATTACHED_SKILLS }, (_, index) =>
      skill({ name: `skill-${index}`, body: "x".repeat(2_000) }),
    );

    const selection = selectSkillInjections(attached);

    expect(selection.charsUsed).toBeLessThanOrEqual(SKILL_BUDGET_CHARS);
    expect(selection.injections).toHaveLength(3);
    expect(selection.dropped).toHaveLength(MAX_ATTACHED_SKILLS - 3);
  });

  test("a body over the per-body cap is truncated and reported, not dropped whole", () => {
    const selection = selectSkillInjections([skill({ body: "x".repeat(MAX_SKILL_BODY_CHARS + 500) })]);

    expect(selection.truncated).toEqual(["slow-burn"]);
    expect(selection.dropped).toEqual([]);
    expect(selection.injections).toHaveLength(1);
    expect(selection.injections[0]?.body).toHaveLength(SKILL_BUDGET_CHARS);
  });

  test("truncated and dropped are disjoint: a name is cut, or absent, never both", () => {
    const selection = selectSkillInjections([
      skill({ name: "first", body: "x".repeat(MAX_SKILL_BODY_CHARS + 500) }),
      skill({ name: "second", body: "y".repeat(1_000) }),
    ]);

    expect(selection.truncated).toEqual(["first"]);
    expect(selection.dropped).toEqual(["second"]);
    expect(selection.truncated.filter((name) => selection.dropped.includes(name))).toEqual([]);
  });

  test("more than the count cap drops the overflow in attach order", () => {
    const attached = Array.from({ length: MAX_ATTACHED_SKILLS + 2 }, (_, index) =>
      skill({ name: `skill-${index}`, body: "short" }),
    );

    const selection = selectSkillInjections(attached);

    expect(selection.injections).toHaveLength(MAX_ATTACHED_SKILLS);
    expect(selection.dropped).toEqual([`skill-${MAX_ATTACHED_SKILLS}`, `skill-${MAX_ATTACHED_SKILLS + 1}`]);
  });

  test("the budget fills in attach order, cutting whatever straddles the boundary", () => {
    const selection = selectSkillInjections(
      [skill({ name: "a", body: "x".repeat(80) }), skill({ name: "b", body: "y".repeat(80) })],
      { budgetChars: 100 },
    );

    expect(selection.injections.map((entry) => entry.name)).toEqual(["a", "b"]);
    expect(selection.injections[1]?.body).toHaveLength(20);
    expect(selection.truncated).toEqual(["b"]);
    expect(selection.charsUsed).toBe(100);
  });

  test("attach order decides how much of each skill survives", () => {
    const forward = selectSkillInjections(
      [skill({ name: "a", body: "x".repeat(120) }), skill({ name: "b", body: "y".repeat(80) })],
      { budgetChars: 100 },
    );
    const reversed = selectSkillInjections(
      [skill({ name: "b", body: "y".repeat(80) }), skill({ name: "a", body: "x".repeat(120) })],
      { budgetChars: 100 },
    );

    expect(forward.injections.map((entry) => entry.name)).toEqual(["a"]);
    expect(forward.dropped).toEqual(["b"]);
    expect(reversed.injections.map((entry) => entry.name)).toEqual(["b", "a"]);
    expect(reversed.truncated).toEqual(["a"]);
  });

  test("an empty body contributes no section and no report", () => {
    const selection = selectSkillInjections([skill({ body: "---\nname: empty\n---\n" })]);

    expect(selection.injections).toEqual([]);
    expect(selection.dropped).toEqual([]);
  });
});

describe("determinism", () => {
  test("identical input selects identically", () => {
    const attached = [skill({ name: "a" }), skill({ name: "b", body: "Be terse." })];

    expect(selectSkillInjections(attached)).toEqual(selectSkillInjections(attached));
  });
});
