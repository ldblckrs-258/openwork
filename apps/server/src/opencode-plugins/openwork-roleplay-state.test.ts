import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as plugin from "./openwork-roleplay-state.js";
import { OpenWorkRoleplayState } from "./openwork-roleplay-state.js";

type ToolExecute = (args: unknown, context: Record<string, unknown>) => Promise<string>;

type Call = { url: string; method: string; body: unknown };

const WORKSPACE = { id: "ws_1", path: "/tmp/workspace-one" };

let calls: Call[] = [];
let sceneStateResponse: unknown = { applied: [], rejected: [], revision: 1, noop: false };
let originalFetch: typeof fetch;

async function tool(): Promise<ToolExecute> {
  const plugin = await OpenWorkRoleplayState();
  return plugin.tool.roleplay_state_update.execute as ToolExecute;
}

function roleplayContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent: "roleplay",
    sessionID: "ses_1",
    messageID: "msg_1",
    directory: WORKSPACE.path,
    ...overrides,
  };
}

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  sceneStateResponse = { applied: [], rejected: [], revision: 1, noop: false };
  process.env.OPENWORK_SERVER_URL = "http://127.0.0.1:9999";
  process.env.OPENWORK_SERVER_TOKEN = "test-token";
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/workspaces")) {
      return new Response(JSON.stringify({ items: [WORKSPACE] }), { status: 200 });
    }
    if (url.includes("/scene-state")) {
      return new Response(JSON.stringify(sceneStateResponse), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the scene-state tool refuses what it must", () => {
  test("an agent other than roleplay gets nothing, and nothing is sent", async () => {
    // `plugin[]` is engine-wide, so this tool is advertised in ordinary coding
    // sessions too. This is the execution-time half of keeping it out of them.
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ id: "sr_1", state: "removed" }] }, roleplayContext({ agent: "openwork" })));

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("roleplay session");
    expect(calls).toHaveLength(0);
  });

  test("a call with no session has nothing to change", async () => {
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ id: "sr_1", state: "removed" }] }, roleplayContext({ sessionID: undefined })));

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("a missing server is reported to the model rather than thrown at the turn", async () => {
    // A rejected promise here reads as a failed turn. Losing the reply because
    // bookkeeping failed is far worse than the model being told so.
    delete process.env.OPENWORK_SERVER_URL;
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ id: "sr_1", state: "removed" }] }, roleplayContext()));

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("launched by OpenWork");
  });

  test("a server error is reported to the model rather than thrown at the turn", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) return new Response(JSON.stringify({ items: [WORKSPACE] }), { status: 200 });
      return new Response(JSON.stringify({ message: "This session is not a roleplay session" }), { status: 404 });
    }) as typeof fetch;
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ id: "sr_1", state: "removed" }] }, roleplayContext()));

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("not a roleplay session");
  });
});

describe("the tool cannot be pointed at another conversation", () => {
  test("the session written is the context's, and a session named in the args is not a parameter at all", async () => {
    const execute = await tool();

    await execute(
      { upsert: [{ id: "sr_1", state: "removed" }], sessionId: "ses_victim", sessionID: "ses_victim", workspaceId: "ws_other" },
      roleplayContext(),
    );

    const write = calls.find((call) => call.url.includes("/scene-state"));
    expect(write?.url).toContain("/roleplay/sessions/ses_1/scene-state");
    expect(write?.url).toContain("/workspace/ws_1/");
    expect(JSON.stringify(write?.body)).not.toContain("ses_victim");
  });
});

describe("per-reply budgets, which a prompt instruction cannot enforce", () => {
  test("a fourth creation in one reply is refused, and the first three go through", async () => {
    const execute = await tool();
    const context = roleplayContext({ messageID: "msg_budget_creates" });

    await execute({ upsert: [{ type: "toys", name: "one" }, { type: "toys", name: "two" }] }, context);
    const second = parse(await execute({ upsert: [{ type: "toys", name: "three" }, { type: "toys", name: "four" }] }, context));

    const writes = calls.filter((call) => call.url.includes("/scene-state"));
    expect(JSON.stringify(writes.at(-1)?.body)).toContain("three");
    expect(JSON.stringify(writes.at(-1)?.body)).not.toContain("four");
    expect((second.rejected as string[]).some((reason) => reason.includes("created per reply"))).toBe(true);
  });

  test("a second delta for the same record in the same reply is dropped, not re-applied", async () => {
    const execute = await tool();
    const context = roleplayContext({ messageID: "msg_budget_count" });

    await execute({ upsert: [{ id: "sr_1", countDelta: 1 }] }, context);
    const second = parse(await execute({ upsert: [{ id: "sr_1", countDelta: 1 }] }, context));

    expect(second.ok).toBe(false);
    expect((second.rejected as string[]).some((reason) => reason.includes("already counted once"))).toBe(true);
    expect(calls.filter((call) => call.url.includes("/scene-state"))).toHaveLength(1);
  });

  test("the rest of a repeated upsert still lands when only its count was refused", async () => {
    const execute = await tool();
    const context = roleplayContext({ messageID: "msg_budget_partial" });

    await execute({ upsert: [{ id: "sr_1", countDelta: 1 }] }, context);
    await execute({ upsert: [{ id: "sr_1", countDelta: 1, state: "spent" }] }, context);

    const write = calls.filter((call) => call.url.includes("/scene-state")).at(-1);
    expect(JSON.stringify(write?.body)).toContain("spent");
    expect(JSON.stringify(write?.body)).not.toContain("countDelta");
  });

  test("the budget is per reply, so the next message starts fresh", async () => {
    const execute = await tool();

    await execute({ upsert: [{ id: "sr_1", countDelta: 1 }] }, roleplayContext({ messageID: "msg_a" }));
    const next = parse(await execute({ upsert: [{ id: "sr_1", countDelta: 1 }] }, roleplayContext({ messageID: "msg_b" })));

    expect(next.ok).toBe(true);
    expect(calls.filter((call) => call.url.includes("/scene-state"))).toHaveLength(2);
  });
});

describe("what the model is told back", () => {
  test("a created record's server-minted id comes back in the same call", async () => {
    sceneStateResponse = {
      applied: [{ id: "sr_7", type: "toys", name: "blindfold", state: "in use" }],
      rejected: [],
      revision: 3,
      noop: false,
    };
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ type: "toys", name: "blindfold", state: "in use" }] }, roleplayContext()));

    expect(result.ok).toBe(true);
    expect(result.applied).toEqual([{ id: "sr_7", type: "toys", name: "blindfold", state: "in use" }]);
    expect(result.revision).toBe(3);
  });

  test("the server's refusals and the tool's own are both surfaced", async () => {
    sceneStateResponse = { applied: [], rejected: ["upsert[0]: unknown record id \"sr_9\""], revision: 2, noop: false };
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ id: "sr_9", state: "gone" }] }, roleplayContext({ messageID: "msg_reject" })));

    expect((result.rejected as string[])[0]).toContain("sr_9");
  });

  test("an empty patch says so instead of reporting a silent success", async () => {
    const execute = await tool();

    const result = parse(await execute({ upsert: [] }, roleplayContext()));

    expect(result.noop).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("a turn that ends", () => {
  test("every successful result tells the model the reply ends the turn", async () => {
    const execute = await tool();

    const result = parse(await execute({ upsert: [{ id: "sr_1", state: "removed" }] }, roleplayContext({ messageID: "msg_note_ok" })));

    expect(result.note).toContain("ends your turn");
  });

  test("a refusal says it too, because a refused call gets the same extra pass", async () => {
    const execute = await tool();
    const context = roleplayContext({ messageID: "msg_note_refused" });
    for (let index = 0; index < 5; index += 1) {
      await execute({ upsert: [{ id: "sr_1", state: `step ${index}` }] }, context);
    }

    const result = parse(await execute({ upsert: [{ id: "sr_1", state: "again" }] }, context));

    expect(result.ok).toBe(false);
    expect(result.note).toContain("ends your turn");
  });

  test("a reply cannot call forever, so a model that answers every result with another call still stops", async () => {
    const execute = await tool();
    const context = roleplayContext({ messageID: "msg_call_cap" });

    const results = [];
    for (let index = 0; index < 7; index += 1) {
      results.push(parse(await execute({ upsert: [{ id: "sr_1", state: `step ${index}` }] }, context)));
    }

    expect(results.filter((result) => result.ok === true)).toHaveLength(5);
    expect(results.at(-1)?.ok).toBe(false);
    expect((results.at(-1)?.rejected as string[])[0]).toContain("already recorded");
  });

  test("the cap is per reply, so the next message starts fresh", async () => {
    const execute = await tool();
    for (let index = 0; index < 6; index += 1) {
      await execute({ upsert: [{ id: "sr_1", state: `step ${index}` }] }, roleplayContext({ messageID: "msg_cap_first" }));
    }

    const next = parse(await execute({ upsert: [{ id: "sr_1", state: "fresh" }] }, roleplayContext({ messageID: "msg_cap_second" })));

    expect(next.ok).toBe(true);
  });
});

describe("the module's exports are the plugin and nothing else", () => {
  test("exporting anything that is not a plugin factory would drop the tool entirely", () => {
    // The engine calls every named export of a plugin module as a plugin
    // factory. Exporting a schema or a helper for a test to reach therefore does
    // not merely add a symbol: the call throws, the module fails to load, and
    // `roleplay_state_update` is advertised to nobody — with the only visible
    // symptom being a roleplay turn that carries no tools. Found exactly that
    // way, so it is a tripwire now rather than a comment.
    expect(Object.keys(plugin)).toEqual(["OpenWorkRoleplayState"]);
  });
});

describe("the model cannot remove a record", () => {
  test("a call that names a removal sends a body without one", async () => {
    // The shared patch schema the server applies does carry a `remove`, because
    // the person reading the scene needs one — a record the model invented has to
    // be clearable by someone. This is the boundary that keeps it out of the
    // model's reach, so it is asserted rather than assumed.
    //
    // Asserted through `execute` rather than by exporting the argument schema:
    // the engine calls every named export of a plugin module as a plugin
    // factory, so an export that is not one drops the plugin entirely. This is
    // also the path that actually matters — the body is built from the parse
    // result, so a field the schema does not carry cannot survive the trip.
    const execute = await tool();

    await execute({ upsert: [{ id: "sr_1", state: "removed" }], remove: ["sr_1"] }, roleplayContext());

    const scene = calls.find((call) => call.url.includes("/scene-state"));
    expect(scene?.body).toEqual({ patch: { upsert: [{ id: "sr_1", state: "removed" }] } });
  });

  test("a call that asks only for a removal reaches the server as nothing at all", async () => {
    const execute = await tool();

    const result = parse(await execute({ remove: ["sr_1"] }, roleplayContext()));

    expect(result.noop).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
