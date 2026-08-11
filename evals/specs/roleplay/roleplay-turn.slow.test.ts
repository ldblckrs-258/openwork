import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildOpenworkRuntimeConfigObjectFromSnapshot } from "../../../apps/server/src/openwork-runtime-config.ts";
import { characterCardV2Schema } from "../../../packages/types/src/roleplay.ts";
import { compileDraftText, BLOCK_MARKERS } from "../../../apps/app/src/app/roleplay/blocks.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";

/**
 * What a roleplay turn actually looks like on the wire.
 *
 * The unit specs prove the compiler splits the two channels; this proves the
 * split survives the engine. Director text is the case that matters: it is the
 * one thing the user types that must never reach the message, and every layer
 * between the composer and the provider gets a chance to put it back.
 *
 * A local OpenAI-compatible server stands in for the provider and captures each
 * assembled request, so this needs no credentials and no network — but it drives
 * the real `opencode` binary and the real shipped agent config.
 */

const OPENCODE_BIN = join(homedir(), ".opencode", "bin", "opencode");
const PROVIDER_PORT = 4933;
const ENGINE_PORT = 4934;

const available = existsSync(OPENCODE_BIN);

let workspace = "";
let engine: ChildProcess | undefined;
let providerServer: Server | undefined;
let captures: { tools: string[]; messages: { role: string; content: string }[] }[] = [];

function startProvider(): Promise<void> {
  return new Promise((resolve) => {
    providerServer = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        if (request.url?.includes("/chat/completions")) {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = {};
          }
          const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
          const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
          captures.push({
            tools: tools.map((tool: { function?: { name?: string }; name?: string }) => tool.function?.name ?? tool.name ?? "?"),
            messages: messages.map((message: { role?: string; content?: unknown }) => ({
              role: String(message.role ?? "?"),
              content: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""),
            })),
          });

          // The engine always requests `stream: true`, so responses must be SSE.
          const chunk = (delta: unknown, finish?: string) =>
            `data: ${JSON.stringify({
              id: "chatcmpl-spec",
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "spec-model",
              choices: [{ index: 0, delta, finish_reason: finish ?? null }],
            })}\n\n`;

          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          response.write(chunk({ role: "assistant", content: "Mm." }));
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

        response.writeHead(404, { "content-type": "application/json" });
        response.end("{}");
      });
    }).listen(PROVIDER_PORT, "127.0.0.1", () => resolve());
  });
}

async function waitForEngine(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${ENGINE_PORT}/app`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("opencode engine did not become ready");
}

async function api(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const url = new URL(`http://127.0.0.1:${ENGINE_PORT}${path}`);
  url.searchParams.set("directory", workspace);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

const MODEL = { providerID: "specmock", modelID: "spec-model" };
const ENV_CONTEXT = "<openwork-env>workspace: spec</openwork-env>";
const DIRECTOR = "keep her evasive and do not reveal the ledger";

const CARD = characterCardV2Schema.parse({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "The archivist of a drowned library.",
    personality: "Guarded.",
    first_mes: "You're late, {{user}}.",
  },
});

const PERSONA = { name: "Wren", description: "A courier with a forged pass." };

type Wire = { system: string; user: string; tools: string[] };

async function sendRoleplayTurn(draftText: string): Promise<Wire> {
  captures = [];
  const compiled = compileDraftText(draftText);
  const turn = buildRoleplayTurn({
    card: CARD,
    persona: PERSONA,
    greeting: CARD.data.first_mes,
    directorText: compiled.directorText,
    envContext: ENV_CONTEXT,
  });

  const session = (await api("/session", { method: "POST", body: { title: "roleplay turn" } })) as { id: string };
  await api(`/session/${session.id}/message`, {
    method: "POST",
    body: {
      model: MODEL,
      parts: compiled.messageText ? [{ type: "text", text: compiled.messageText }] : [],
      ...turn.prompt,
    },
  });

  const capture = captures.at(-1);
  return {
    system: (capture?.messages ?? []).filter((message) => message.role === "system").map((message) => message.content).join("\n"),
    user: (capture?.messages ?? []).filter((message) => message.role === "user").map((message) => message.content).join("\n"),
    tools: capture?.tools ?? [],
  };
}

beforeAll(async () => {
  if (!available) return;
  workspace = await mkdtemp(join(tmpdir(), "openwork-roleplay-turn-"));

  const runtimeConfig = buildOpenworkRuntimeConfigObjectFromSnapshot({});
  const config = {
    ...runtimeConfig,
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
  const configPath = join(workspace, "opencode-config.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");

  await startProvider();
  engine = spawn(OPENCODE_BIN, ["serve", "--port", String(ENGINE_PORT), "--hostname", "127.0.0.1"], {
    cwd: workspace,
    env: { ...process.env, OPENCODE_CONFIG: configPath },
    stdio: "ignore",
  });
  await waitForEngine();
}, 120_000);

afterAll(async () => {
  engine?.kill();
  providerServer?.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!available)("a roleplay turn on the wire", () => {
  test("director text reaches the system message and never the user message", async () => {
    const wire = await sendRoleplayTurn(
      `${BLOCK_MARKERS.action}leans on the counter\n${BLOCK_MARKERS.dialogue}Where is the ledger?\n${BLOCK_MARKERS.director}${DIRECTOR}`,
    );

    // The positive assertion first: an empty user message would satisfy every
    // "not.toContain" below without proving anything.
    expect(wire.user).toContain('"Where is the ledger?"');
    expect(wire.system).toContain(DIRECTOR);
    expect(wire.user).not.toContain(DIRECTOR);
    expect(wire.user).not.toContain("evasive");
  });

  test("dialogue and action arrive in the message in authored order", async () => {
    const wire = await sendRoleplayTurn(
      `${BLOCK_MARKERS.action}leans on the counter\n${BLOCK_MARKERS.dialogue}Where is the ledger?`,
    );

    expect(wire.user).toContain("*leans on the counter*");
    expect(wire.user).toContain('"Where is the ledger?"');
    expect(wire.user.indexOf("*leans")).toBeLessThan(wire.user.indexOf('"Where'));
  });

  test("no block marker survives into the message", async () => {
    // The markers exist only so chips survive the composer's flat-string codec.
    // A marker on the wire would read to the model as scene text.
    const wire = await sendRoleplayTurn(`${BLOCK_MARKERS.dialogue}Well?`);

    for (const marker of Object.values(BLOCK_MARKERS)) {
      expect(wire.user).not.toContain(marker);
    }
  });

  test("the character prompt and the environment context share the system message", async () => {
    // Roleplay composes onto the env context rather than replacing it; replacing
    // would strip a string every other feature assumes is present.
    const wire = await sendRoleplayTurn(`${BLOCK_MARKERS.dialogue}Hello.`);

    expect(wire.system).toContain("The archivist of a drowned library.");
    expect(wire.system).toContain(ENV_CONTEXT);
  });

  test("the greeting the client rendered is visible to the model", async () => {
    // It is not in engine history — the engine cannot write an assistant message
    // — so without this the model has no record of having opened the scene.
    const wire = await sendRoleplayTurn(`${BLOCK_MARKERS.dialogue}Hello.`);

    expect(wire.system).toContain("You're late, Wren.");
  });

  test("a director-only turn steers without sending a message", async () => {
    const wire = await sendRoleplayTurn(`${BLOCK_MARKERS.director}skip ahead to the next morning`);

    expect(wire.system).toContain("skip ahead to the next morning");
    expect(wire.user).not.toContain("skip ahead");
  });

  test("the turn is still offered no tools", async () => {
    const wire = await sendRoleplayTurn(`${BLOCK_MARKERS.dialogue}Hello.`);

    expect(wire.tools).toEqual([]);
  });
});
