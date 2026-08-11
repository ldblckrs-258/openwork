import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { planSwipe } from "../../../apps/app/src/app/roleplay/swipe.ts";
import type { RoleplayTurnRecord } from "../../../packages/types/src/roleplay.ts";

/**
 * Regenerate, asserted against the engine that destroys the thing being
 * regenerated.
 *
 * The unit specs cover the decisions; these cover the claims that only the real
 * engine can settle, and that `reports/swipe-semantics-spike.md` found the plan
 * had wrong. A mock provider stands in for the model so replies are identifiable
 * (`REPLY-1`, `REPLY-2`, …) and no credentials are needed.
 */

const OPENCODE_BIN = join(homedir(), ".opencode", "bin", "opencode");
const PROVIDER_PORT = 4935;
const ENGINE_PORT = 4936;

const available = existsSync(OPENCODE_BIN);

let workspace = "";
let engine: ChildProcess | undefined;
let providerServer: Server | undefined;
let replyCount = 0;

function startProvider(): Promise<void> {
  return new Promise((resolve) => {
    providerServer = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        if (request.url?.includes("/chat/completions")) {
          replyCount += 1;
          const chunk = (delta: unknown, finish?: string) =>
            `data: ${JSON.stringify({
              id: "c",
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "spec-model",
              choices: [{ index: 0, delta, finish_reason: finish ?? null }],
            })}\n\n`;
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write(chunk({ role: "assistant", content: `REPLY-${replyCount}` }));
          response.write(chunk({}, "stop"));
          response.write("data: [DONE]\n\n");
          response.end();
          return;
        }
        if (request.url?.includes("/models")) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ object: "list", data: [{ id: "spec-model", object: "model" }] }));
          return;
        }
        response.writeHead(404);
        response.end("{}");
      });
    }).listen(PROVIDER_PORT, "127.0.0.1", () => resolve());
  });
}

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const url = new URL(`http://127.0.0.1:${ENGINE_PORT}${path}`);
  url.searchParams.set("directory", workspace);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

type EngineMessage = { info: { id: string; role: string }; parts?: Array<{ type: string; text?: string }> };

async function messages(sessionId: string): Promise<EngineMessage[]> {
  return ((await api(`/session/${sessionId}/message`)).data as EngineMessage[]) ?? [];
}

function textOf(message: EngineMessage | undefined): string {
  return (message?.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
}

function lastOf(list: EngineMessage[], role: string): EngineMessage | undefined {
  return [...list].reverse().find((message) => message.info.role === role);
}

const MODEL = { providerID: "specmock", modelID: "spec-model" };

function turnFor(list: EngineMessage[], userText: string): RoleplayTurnRecord {
  return {
    turnId: "turn_spec",
    sessionId: "ses_spec",
    messageId: lastOf(list, "user")?.info.id ?? "",
    userText,
    blocks: [{ type: "dialogue", text: userText }],
    alternatives: [],
    activeAlternative: 0,
    createdAt: 1,
  };
}

async function seedSession(): Promise<string> {
  const session = (await api("/session", { method: "POST", body: { title: "swipe" } })).data as { id: string };
  await api(`/session/${session.id}/message`, { method: "POST", body: { model: MODEL, parts: [{ type: "text", text: "TURN-1" }] } });
  await api(`/session/${session.id}/message`, { method: "POST", body: { model: MODEL, parts: [{ type: "text", text: "TURN-2" }] } });
  return session.id;
}

beforeAll(async () => {
  if (!available) return;
  workspace = await mkdtemp(join(tmpdir(), "openwork-swipe-"));
  const config = {
    plugin: [],
    mcp: {},
    provider: {
      specmock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Spec Mock",
        options: { baseURL: `http://127.0.0.1:${PROVIDER_PORT}/v1`, apiKey: "spec" },
        models: { "spec-model": { name: "Spec Model" } },
      },
    },
  };
  const configPath = join(workspace, "config.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");

  await startProvider();
  engine = spawn(OPENCODE_BIN, ["serve", "--port", String(ENGINE_PORT), "--hostname", "127.0.0.1"], {
    cwd: workspace,
    env: { ...process.env, OPENCODE_CONFIG: configPath },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${ENGINE_PORT}/app`)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}, 120_000);

afterAll(async () => {
  engine?.kill();
  providerServer?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!available)("regenerate against the real engine", () => {
  test("reverting at a reply moves the cursor to the user message, not the reply", async () => {
    // This is why swipe cannot "keep the user message and discard the reply" by
    // reverting, and therefore why the user's text has to be re-sent.
    const sid = await seedSession();
    const before = await messages(sid);
    const reply = lastOf(before, "assistant");
    const user = lastOf(before, "user");

    const reverted = await api(`/session/${sid}/revert`, { method: "POST", body: { messageID: reply?.info.id } });

    expect((reverted.data as { revert?: { messageID?: string } })?.revert?.messageID).toBe(user?.info.id);
  });

  test("regenerating does not duplicate the user's message", async () => {
    const sid = await seedSession();
    const before = await messages(sid);
    const userTurnsBefore = before.filter((message) => message.info.role === "user").length;
    const plan = planSwipe({
      turn: turnFor(before, "TURN-2"),
      currentReply: { text: textOf(lastOf(before, "assistant")), messageId: lastOf(before, "assistant")!.info.id },
      now: 1,
    });

    await api(`/session/${sid}/revert`, { method: "POST", body: { messageID: plan.revertMessageId } });
    await api(`/session/${sid}/message`, { method: "POST", body: { model: MODEL, parts: [{ type: "text", text: plan.userText }] } });

    const after = await messages(sid);
    expect(after.filter((message) => message.info.role === "user")).toHaveLength(userTurnsBefore);
    expect(textOf(lastOf(after, "user"))).toBe("TURN-2");
  });

  test("regenerating with empty parts would blank the user's message", async () => {
    // Documents why `planSwipe` carries `userText`. If the engine ever starts
    // rejecting empty parts this fails loudly rather than leaving dead defence.
    const sid = await seedSession();
    const before = await messages(sid);

    await api(`/session/${sid}/revert`, { method: "POST", body: { messageID: lastOf(before, "assistant")?.info.id } });
    await api(`/session/${sid}/message`, { method: "POST", body: { model: MODEL, parts: [] } });

    expect(textOf(lastOf(await messages(sid), "user"))).toBe("");
  });

  test("the replaced reply is destroyed, so the app-side copy is the only one left", async () => {
    const sid = await seedSession();
    const before = await messages(sid);
    const original = textOf(lastOf(before, "assistant"));
    const plan = planSwipe({
      turn: turnFor(before, "TURN-2"),
      currentReply: { text: original, messageId: lastOf(before, "assistant")!.info.id },
      now: 1,
    });

    await api(`/session/${sid}/revert`, { method: "POST", body: { messageID: plan.revertMessageId } });
    await api(`/session/${sid}/message`, { method: "POST", body: { model: MODEL, parts: [{ type: "text", text: plan.userText }] } });

    const after = await messages(sid);
    expect(after.some((message) => textOf(message) === original)).toBe(false);
    expect(plan.turn.alternatives[0]?.text).toBe(original);
  });

  test("a failed regenerate destroys the reply too, and unrevert cannot bring it back", async () => {
    // The finding that decided the design. Rolling back by restoring the revert
    // cursor is impossible: there is no cursor and no message left by the time
    // the failure surfaces.
    const sid = await seedSession();
    const before = await messages(sid);
    const original = textOf(lastOf(before, "assistant"));

    await api(`/session/${sid}/revert`, { method: "POST", body: { messageID: lastOf(before, "assistant")?.info.id } });
    const failed = await api(`/session/${sid}/message`, {
      method: "POST",
      body: { model: { providerID: "nope", modelID: "nope" }, parts: [{ type: "text", text: "TURN-2" }] },
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);

    await api(`/session/${sid}/unrevert`, { method: "POST" });
    const after = await messages(sid);

    expect(after.some((message) => textOf(message) === original)).toBe(false);
    expect((((await api(`/session/${sid}`)).data) as { revert?: unknown } | undefined)?.revert ?? null).toBeNull();
  });

  test("branching copies the conversation and leaves the original intact", async () => {
    const sid = await seedSession();
    const before = await messages(sid);

    const forked = (await api(`/session/${sid}/fork`, { method: "POST", body: {} })).data as { id: string };
    const branch = await messages(forked.id);

    expect(branch.map(textOf)).toEqual(before.map(textOf));
    expect(branch.map((message) => message.info.id)).not.toEqual(before.map((message) => message.info.id));
    expect((await messages(sid)).map(textOf)).toEqual(before.map(textOf));
  });

  test("compaction is available and appends rather than replacing history", async () => {
    const sid = await seedSession();
    const before = await messages(sid);

    const summarized = await api(`/session/${sid}/summarize`, {
      method: "POST",
      body: { providerID: MODEL.providerID, modelID: MODEL.modelID },
    });

    expect(summarized.status).toBe(200);
    expect((await messages(sid)).length).toBeGreaterThan(before.length);
  });
});
