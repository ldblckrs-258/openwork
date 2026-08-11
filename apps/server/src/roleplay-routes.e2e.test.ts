import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
});

async function startOpenworkServer() {
  const root = await mkdtemp(join(tmpdir(), "openwork-roleplay-routes-"));
  roots.push(root);
  process.env.OPENWORK_RUNTIME_DB = join(root, "runtime.sqlite");

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, token: config.token };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function characterBody(id: string, name = "Aria") {
  return {
    character: {
      id,
      card: {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name,
          description: "A wandering archivist.",
          personality: "Curious.",
          scenario: "A library.",
          first_mes: "You're late.",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          alternate_greetings: [],
          tags: [],
          creator: "",
          character_version: "",
          extensions: {},
        },
      },
      charSubstitutionName: name,
      source: "authored",
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

describe("roleplay routes", () => {
  test("a character round-trips through create, list, read, and delete", async () => {
    const { base, token } = await startOpenworkServer();

    const empty = await fetch(`${base}/workspace/ws_1/roleplay/characters`, { headers: auth(token) });
    expect(empty.status).toBe(200);
    expect((await empty.json()).characters).toEqual([]);

    const created = await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(characterBody("char_1")),
    });
    expect(created.status).toBe(200);

    const listed = await (await fetch(`${base}/workspace/ws_1/roleplay/characters`, { headers: auth(token) })).json();
    expect(listed.characters).toHaveLength(1);
    expect(listed.characters[0].card.data.name).toBe("Aria");

    const read = await (await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, { headers: auth(token) })).json();
    expect(read.character.id).toBe("char_1");

    const deleted = await (await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, {
      method: "DELETE",
      headers: auth(token),
    })).json();
    expect(deleted.deleted).toBe(true);

    // Tombstoned rather than removed: gone from the library, still readable by id
    // so a session bound to it can still render its transcript.
    const afterDelete = await (await fetch(`${base}/workspace/ws_1/roleplay/characters`, { headers: auth(token) })).json();
    expect(afterDelete.characters).toEqual([]);
    const stillReadable = await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, { headers: auth(token) });
    expect(stillReadable.status).toBe(200);
  });

  test("an unknown character is a 404, not an empty success", async () => {
    const { base, token } = await startOpenworkServer();

    const missing = await fetch(`${base}/workspace/ws_1/roleplay/characters/char_nope`, { headers: auth(token) });
    expect(missing.status).toBe(404);
  });

  test("an invalid character is rejected at the edge with a 400", async () => {
    // A store-level throw would surface as a 500 for what is really a bad request,
    // and the client would have no field to point the user at.
    const { base, token } = await startOpenworkServer();

    const response = await fetch(`${base}/workspace/ws_1/roleplay/characters/char_bad`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ character: { id: "", card: {} } }),
    });
    expect(response.status).toBe(400);
  });

  test("a body whose id disagrees with the path is rejected", async () => {
    // Otherwise the record silently lands under a different key than the caller
    // addressed, and the next read looks like the write vanished.
    const { base, token } = await startOpenworkServer();

    const response = await fetch(`${base}/workspace/ws_1/roleplay/characters/char_path`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(characterBody("char_body")),
    });
    expect(response.status).toBe(400);
  });

  test("privilege-bearing card keys are stripped before the record is stored", async () => {
    const { base, token } = await startOpenworkServer();
    const hostile = characterBody("char_hostile");
    Object.assign(hostile.character.card.data, { permission: { bash: "allow" }, tools: { bash: true } });

    const created = await fetch(`${base}/workspace/ws_1/roleplay/characters/char_hostile`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(hostile),
    });
    expect(created.status).toBe(200);

    const stored = await (await fetch(`${base}/workspace/ws_1/roleplay/characters/char_hostile`, { headers: auth(token) })).json();
    expect(stored.character.card.data).not.toHaveProperty("permission");
    expect(stored.character.card.data).not.toHaveProperty("tools");
  });

  test("personas round-trip and delete", async () => {
    const { base, token } = await startOpenworkServer();
    const body = { persona: { id: "persona_1", persona: { name: "Wren", description: "A courier." }, createdAt: 1, updatedAt: 1 } };

    expect((await fetch(`${base}/workspace/ws_1/roleplay/personas/persona_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(body),
    })).status).toBe(200);

    const listed = await (await fetch(`${base}/workspace/ws_1/roleplay/personas`, { headers: auth(token) })).json();
    expect(listed.personas).toHaveLength(1);
    expect(listed.personas[0].persona.name).toBe("Wren");

    const deleted = await (await fetch(`${base}/workspace/ws_1/roleplay/personas/persona_1`, {
      method: "DELETE",
      headers: auth(token),
    })).json();
    expect(deleted.deleted).toBe(true);
  });

  test("a session binding round-trips and carries its character with it", async () => {
    // The binding is what makes a session a roleplay session, and the send path
    // needs the character in the same response — a second round trip would let
    // a turn be composed against a character the client had not loaded yet.
    const { base, token } = await startOpenworkServer();
    await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(characterBody("char_1")),
    });

    const unbound = await (await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, { headers: auth(token) })).json();
    expect(unbound.binding).toBeNull();

    const bound = await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ binding: { sessionId: "ses_1", characterId: "char_1", personaId: "persona_1", boundAt: 5 } }),
    });
    expect(bound.status).toBe(200);

    const read = await (await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, { headers: auth(token) })).json();
    expect(read.binding.characterId).toBe("char_1");
    expect(read.character.card.data.name).toBe("Aria");
    expect(read.characterDeleted).toBe(false);
  });

  test("deleting the bound character leaves the session readable and says so", async () => {
    const { base, token } = await startOpenworkServer();
    await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(characterBody("char_1")),
    });
    await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ binding: { sessionId: "ses_1", characterId: "char_1", personaId: "persona_1", boundAt: 5 } }),
    });
    await fetch(`${base}/workspace/ws_1/roleplay/characters/char_1`, { method: "DELETE", headers: auth(token) });

    const read = await (await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, { headers: auth(token) })).json();
    expect(read.binding.characterId).toBe("char_1");
    expect(read.characterDeleted).toBe(true);
  });

  test("a turn's blocks are stored against its message so a regenerate can recompose it", async () => {
    // Director text lives in `system`, not in message history. Without this the
    // steering silently disappears on the first swipe and the character appears
    // to ignore an instruction the user just gave.
    const { base, token } = await startOpenworkServer();
    const record = {
      record: {
        messageId: "msg_1",
        sessionId: "ses_1",
        blocks: [
          { type: "action", text: "straightens papers" },
          { type: "director", text: "keep her evasive" },
        ],
        createdAt: 7,
      },
    };

    expect((await fetch(`${base}/workspace/ws_1/roleplay/messages/msg_1/blocks`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(record),
    })).status).toBe(200);

    const read = await (await fetch(`${base}/workspace/ws_1/roleplay/messages/msg_1/blocks`, { headers: auth(token) })).json();
    expect(read.blocks).toEqual(record.record.blocks);
  });

  test("clearing a binding also drops the turns stored for that session", async () => {
    const { base, token } = await startOpenworkServer();
    await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ binding: { sessionId: "ses_1", characterId: "char_1", personaId: "persona_1", boundAt: 5 } }),
    });
    await fetch(`${base}/workspace/ws_1/roleplay/messages/msg_1/blocks`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ record: { messageId: "msg_1", sessionId: "ses_1", blocks: [{ type: "plain", text: "hi" }], createdAt: 7 } }),
    });

    const cleared = await (await fetch(`${base}/workspace/ws_1/roleplay/sessions/ses_1`, {
      method: "DELETE",
      headers: auth(token),
    })).json();
    expect(cleared.cleared).toBe(true);

    const orphaned = await (await fetch(`${base}/workspace/ws_1/roleplay/messages/msg_1/blocks`, { headers: auth(token) })).json();
    expect(orphaned.blocks).toBeNull();
  });

  test("characters are isolated per workspace", async () => {
    const { base, token } = await startOpenworkServer();
    await fetch(`${base}/workspace/ws_1/roleplay/characters/char_a`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify(characterBody("char_a")),
    });

    const otherWorkspace = await fetch(`${base}/workspace/ws_missing/roleplay/characters`, { headers: auth(token) });
    expect(otherWorkspace.status).not.toBe(200);
  });
});
