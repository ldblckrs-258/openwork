import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildOpenworkRuntimeConfigObjectFromSnapshot } from "../../../apps/server/src/openwork-runtime-config.ts";
import {
  generatedCharacterRecord,
  parseGeneratedCard,
} from "../../../apps/app/src/app/roleplay/generation/parse-generated.ts";
import {
  buildCreatorRequest,
  buildInterviewRequest,
} from "../../../apps/app/src/app/roleplay/generation/prompts.ts";
import { validateCharacter } from "../../../apps/app/src/app/roleplay/character-draft.ts";

/**
 * The Phase 7 gate: character generation is an untrusted prompt like any other.
 *
 * Asserted against what the engine actually assembles, using the real binary and
 * the real shipped agent config, with a local OpenAI-compatible server standing
 * in for the provider. The unit spec proves `buildCreatorRequest` *carries* the
 * denial; only this one proves the engine honours it once the request is sent.
 */

const OPENCODE_BIN = join(homedir(), ".opencode", "bin", "opencode");
const PROVIDER_PORT = 4933;
const ENGINE_PORT = 4934;

const available = existsSync(OPENCODE_BIN);

const GENERATED_CARD = {
  name: "Aria",
  description: "The night archivist.",
  personality: "guarded, dry",
  scenario: "A rain-soaked library, ten minutes past closing.",
  first_mes: '*She does not look up.* "You\'re late."',
  mes_example: "<START>\n{{user}}: Is the east wing open?\n{{char}}: \"It is not.\"",
  alternate_greetings: ["*The door is already locked.*"],
  tags: ["mystery"],
  creator_notes: "Quiet scenes.",
};

let workspace = "";
let engine: ChildProcess | undefined;
let providerServer: Server | undefined;
let captures: { tools: string[]; messages: { role: string; content: string }[] }[] = [];
/** What the mock provider answers with. Set per test. */
let reply = "OK";

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
          response.write(chunk({ role: "assistant", content: reply }));
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

type RunResult = {
  tools: string[];
  systemContent: string;
  userContent: string;
  text: string;
};

/**
 * Send one generation request the way the route does: create a scratch session,
 * prompt once, read the reply text, delete the session.
 */
async function run(body: Record<string, unknown>): Promise<RunResult> {
  captures = [];
  const session = (await api("/session", { method: "POST", body: { title: "Character generation" } })) as { id: string };
  let text = "";
  try {
    const result = (await api(`/session/${session.id}/message`, {
      method: "POST",
      body: { model: MODEL, ...body },
    })) as { parts?: { type: string; text?: string }[] };
    text = (result.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  } finally {
    await api(`/session/${session.id}`, { method: "DELETE" }).catch(() => undefined);
  }
  const captured = captures.at(-1);
  return {
    tools: captured?.tools ?? [],
    systemContent: (captured?.messages ?? []).filter((message) => message.role === "system").map((message) => message.content).join("\n"),
    userContent: (captured?.messages ?? []).filter((message) => message.role === "user").map((message) => message.content).join("\n"),
    text,
  };
}

function wire(request: { agent: string; tools: Record<string, boolean>; system: string; text: string }) {
  const { text, ...promptOptions } = request;
  return { parts: [{ type: "text", text }], ...promptOptions };
}

beforeAll(async () => {
  if (!available) return;
  workspace = await mkdtemp(join(tmpdir(), "openwork-generation-"));

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

describe.skipIf(!available)("character generation on the wire", () => {
  test("a generation call is offered no tools", async () => {
    reply = JSON.stringify(GENERATED_CARD);
    const result = await run(wire(buildCreatorRequest({ idea: "a night archivist who guards one shelf" })));

    expect(result.tools).toEqual([]);
  });

  test("the control proves this engine would otherwise offer tools", async () => {
    // Without it, "no tools" is indistinguishable from a broken harness.
    reply = "OK";
    const result = await run({ parts: [{ type: "text", text: "a night archivist" }] });

    expect(result.tools.length).toBeGreaterThan(0);
  });

  test("the interview call is denied too, not only the card-writing one", async () => {
    // Two calls, one boundary. The interview reads the same untrusted idea and is
    // the easier one to forget.
    reply = JSON.stringify({ questions: [{ id: "tone", question: "Warm or hostile?", suggestions: ["Warm", "Hostile"] }] });
    const result = await run(wire(buildInterviewRequest("a night archivist")));

    expect(result.tools).toEqual([]);
  });

  test("the idea reaches the model as a message and the instructions as system", async () => {
    // The split is the point: instructions are identical on every call, so an
    // idea can add to what the model is told but never replace it.
    reply = JSON.stringify(GENERATED_CARD);
    const result = await run(wire(buildCreatorRequest({ idea: "a night archivist who guards one shelf" })));

    expect(result.systemContent).toContain("Return exactly one JSON object");
    expect(result.systemContent).not.toContain("guards one shelf");
    expect(result.userContent).toContain("guards one shelf");
  });

  test("a reply travels through the engine and parses into a saveable character", async () => {
    // End to end: what the provider emitted is what `parseGeneratedCard` reads.
    // The unit spec feeds the parser directly and so cannot catch the engine
    // reshaping, wrapping, or trimming the text on its way back.
    reply = JSON.stringify(GENERATED_CARD);
    const result = await run(wire(buildCreatorRequest({ idea: "a night archivist" })));

    const parsed = parseGeneratedCard(result.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateCharacter(generatedCharacterRecord(parsed.card, "chr_slow", 1))).toEqual([]);
    expect(parsed.card.data.first_mes).toContain("You're late.");
  });

  test("a model that answers with prose instead of a card fails cleanly", async () => {
    // The failure the user is most likely to hit on a weak model. It must surface
    // as a failed generation, never as a blank character.
    reply = "I'd be happy to help you build a character!";
    const result = await run(wire(buildCreatorRequest({ idea: "a night archivist" })));

    expect(parseGeneratedCard(result.text).ok).toBe(false);
  });
});
