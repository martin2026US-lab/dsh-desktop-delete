import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

function fixture({ current = true, ok = true } = {}) {
  const calls = [];
  const slots = new Map();
  const byId = { target: {}, other: {} };
  let retained = current ? 1 : 0;
  let plugin;
  runInNewContext(source, {
    window: { __ModuleLoader__: { load({ factory }) {
      plugin = factory((name) => {
        if (name === "react") return { createElement() {} };
        if (name === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: () => ({ set() {} }) };
        if (name === "@deepseek-ai/dsh-client-ui-primitives") return {};
        throw new Error(`Unexpected module: ${name}`);
      });
    } } },
    document: { createElement: () => ({ remove() {} }), head: { appendChild() {} } },
    fetch: async (path, options) => {
      calls.push(["fetch", path, JSON.parse(options.body)]);
      assert.equal(retained, 0, "release the current main view before deleting");
      return { ok, json: async () => ({ ok, error: ok ? undefined : "writer held by another Host" }) };
    },
    setTimeout, Date,
  });
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register() {}, bind: () => (key) => key },
    sessions: {
      list: { getSnapshot: () => ({ byId }), subscribe() {} },
      retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: retained } }) }),
      handleSessionRemoved(id) { calls.push(["removed", id]); delete byId[id]; },
      async refresh() { calls.push(["refresh"]); },
    },
    workspaces: { list: { getSnapshot: () => ({ items: [
      { workspaceId: "unrelated", sessionIds: ["other"] },
      { workspaceId: "owner", sessionIds: ["target"] },
    ] }) } },
    uiWorkspace: { startSession(id) { calls.push(["navigate", id]); retained = 0; } },
    slots: { inject: (_name, fn) => fn(), register: (spec) => slots.set(spec.name, spec) },
  });
  return { remove: slots.get("shell.overlay").inject().remove, calls, byId };
}

test("current conversation switches to its owning workspace before deletion", async () => {
  const f = fixture();
  await f.remove("target");
  assert.deepEqual(f.calls, [
    ["navigate", "owner"],
    ["fetch", "/desktop-delete/api/delete", { sessionId: "target", confirm: true }],
    ["removed", "target"], ["refresh"],
  ]);
  assert.ok(f.byId.other);
  assert.equal(f.byId.target, undefined);
});

test("deleting a background conversation leaves navigation alone", async () => {
  const f = fixture({ current: false });
  await f.remove("target");
  assert.equal(f.calls.some(([name]) => name === "navigate"), false);
  assert.equal(f.byId.target, undefined);
});

test("a refused delete keeps the conversation in the client catalog", async () => {
  const f = fixture({ ok: false });
  await assert.rejects(f.remove("target"), /writer held/);
  assert.ok(f.byId.target);
  assert.equal(f.calls.some(([name]) => name === "removed" || name === "refresh"), false);
});
