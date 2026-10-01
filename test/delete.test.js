import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply, deleteSession, resolveDirectory } from "../lib/index.js";

async function fixture(t, { live = false, archived = false, pinned = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "dsdd-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = "target";
  const dir = join(root, "sessions", "workspace", id);
  const log = join(dir, "session.v4.jsonl");
  await mkdir(dir, { recursive: true }); await writeFile(log, "disposable history\n");
  const other = join(root, "sessions", "workspace", "other");
  await mkdir(other, {recursive:true}); await writeFile(join(other,"session.v4.jsonl"), "keep me");
  const calls = [];
  const session = { id };
  const writer = { async close() { calls.push("close"); } };
  const agent = { session, cancel() { calls.push("cancel"); }, async whenIdle() {}, async runMaintenance(fn) { calls.push("maintenance"); return fn(); }, scope: { async dispose() { calls.push("dispose"); } } };
  const sessionEntry = {session}; const agentEntry = {agent};
  const owner = { sessionIds: [id, "other"], async detachSession(s) { this.sessionIds = this.sessionIds.filter(x => x !== s); }, async attachSession(s) { this.sessionIds.push(s); } };
  const registry = { archivedSessionIds: archived ? [id] : [], pinnedSessionIds: pinned ? [id] : [], list: () => [owner],
    async archiveSession(s, options) { calls.push(`archive:${options?.stopActivity === true}`); if (!this.archivedSessionIds.includes(s)) this.archivedSessionIds.push(s); this.pinnedSessionIds = this.pinnedSessionIds.filter(x => x !== s); },
    async unarchiveSession(s) { this.archivedSessionIds = this.archivedSessionIds.filter(x => x !== s); },
    async unpinSession(s) { this.pinnedSessionIds = this.pinnedSessionIds.filter(x => x !== s); },
    async pinSession(s) { this.pinnedSessionIds.push(s); }
  };
  const ctx = { connection:{admit:()=>({peer:{}})}, workspaceRegistry:registry, dshHomePath:(...p)=>join(root,...p), logger:{warn(){}}, emit(name,id) { calls.push(`${name}:${id}`); },
    sessions:{get:()=>live?session:undefined,store:new Map([[id,sessionEntry]]),async flush(){calls.push("flush");},detachEntered(entry){assert.equal(entry,sessionEntry);calls.push("detach-session");}},
    agents:{get:()=>agent,store:new Map([[id,agentEntry]]),detachEntered(entry){assert.equal(entry,agentEntry);calls.push("detach-agent");}},
    sessionPersistence:{async stat(){return {header:{id}};},async resolveCurrentLog(){return log;},tracker:{writers:new Map([[id,writer]])},async open(s,mode){assert.equal(s,id);assert.equal(mode,"write");calls.push("open");return writer;}}
  };
  return {ctx,id,dir,log,root,calls,registry,owner,agent,other};
}

test("cold delete removes durable history and metadata, preserving another session", async t => {
  const f=await fixture(t,{pinned:true}); const deleted=new Set();
  assert.deepEqual(await deleteSession(f.ctx,f.id,deleted),{sessionId:f.id,deleted:true});
  await assert.rejects(access(f.dir));
  assert.equal(await readFile(join(f.other,"session.v4.jsonl"),"utf8"),"keep me");
  assert.deepEqual(f.owner.sessionIds,["other"]); assert.deepEqual(f.registry.pinnedSessionIds,[]); assert.deepEqual(f.registry.archivedSessionIds,[]); assert.ok(deleted.has(f.id));
});
test("live delete flushes before closing and disposes only the exact lifecycle", async t => {
  const f=await fixture(t,{live:true}); await deleteSession(f.ctx,f.id);
  assert.ok(f.calls.indexOf("flush")<f.calls.indexOf("close"));
  assert.ok(f.calls.indexOf("close")<f.calls.indexOf("dispose"));
  assert.deepEqual(f.calls.slice(-4),["dispose","detach-agent","detach-session","api-session/removed:target"]);
});
test("failure after quarantine restores bytes, ownership, archive and pin state", async t => {
  const f=await fixture(t,{live:true,pinned:true}); f.owner.detachSession=async()=>{throw new Error("metadata write failed");};
  await assert.rejects(deleteSession(f.ctx,f.id),/metadata write failed/);
  assert.equal(await readFile(f.log,"utf8"),"disposable history\n");
  assert.deepEqual(f.registry.archivedSessionIds,[]); assert.deepEqual(f.registry.pinnedSessionIds,[f.id]);
  assert.ok(f.calls.includes("open")); assert.ok(!f.calls.includes("dispose"));
});
test("refusal preserves an originally archived session", async t => {
  const f=await fixture(t,{archived:true}); f.ctx.sessionPersistence.open=async()=>{throw new Error("foreign writer");};
  await assert.rejects(deleteSession(f.ctx,f.id),/foreign writer/); await access(f.log); assert.deepEqual(f.registry.archivedSessionIds,[f.id]);
});
test("live foreign lifecycle is refused before any state or file mutation", async t => {
  const f=await fixture(t,{live:true}); f.ctx.agents.store=new Map();
  await assert.rejects(deleteSession(f.ctx,f.id),{code:"SESSION_BUSY"}); await access(f.log); assert.deepEqual(f.calls,[]);
});
test("a stuck agent times out without closing its writer or removing data", async t => {
  const f=await fixture(t,{live:true,pinned:true}); f.agent.whenIdle=()=>new Promise(()=>{});
  await assert.rejects(deleteSession(f.ctx,f.id,new Set(),{timeoutMs:10}),{code:"SESSION_BUSY"});
  await access(f.log); assert.ok(!f.calls.includes("close")); assert.deepEqual(f.registry.pinnedSessionIds,[f.id]);
});
test("flush failure preserves the original writer and data", async t => {
  const f=await fixture(t,{live:true}); f.ctx.sessions.flush=async()=>{throw new Error("disk full");};
  await assert.rejects(deleteSession(f.ctx,f.id),/disk full/); await access(f.log); assert.ok(!f.calls.includes("close"));
});
test("reject paths outside the managed root, the root itself, and project directories", async t => {
  const f=await fixture(t);
  for (const path of [join(f.root,"session.v4.jsonl"),join(f.root,"sessions","session.v4.jsonl"),join(f.root,"sessions","workspace","session.v4.jsonl")]) {
    f.ctx.sessionPersistence.resolveCurrentLog=async()=>path; await assert.rejects(resolveDirectory(f.ctx,f.id),/拒绝/);
  }
  await access(f.log);
});
test("a mismatched identity, subagent, or unknown storage format is refused", async t => {
  const f=await fixture(t);
  f.ctx.sessionPersistence.stat=async()=>({header:{id:"other"}}); await assert.rejects(resolveDirectory(f.ctx,f.id));
  f.ctx.sessionPersistence.stat=async()=>({header:{id:f.id,origin:"subagent"}}); await assert.rejects(resolveDirectory(f.ctx,f.id));
  f.ctx.sessionPersistence.stat=async()=>({header:{id:f.id}}); f.ctx.sessionPersistence.resolveCurrentLog=async()=>undefined; await assert.rejects(resolveDirectory(f.ctx,f.id));
});
test("historical generation uses the JSONL backend locator when no current log exists", async t => {
  const f=await fixture(t);
  f.ctx.sessionPersistence.resolveCurrentLog=async()=>undefined;
  f.ctx.sessionPersistence.locate=header=>{assert.equal(header.id,f.id);return {kind:"jsonl",path:f.log};};
  assert.equal(await resolveDirectory(f.ctx,f.id),await realpath(f.dir));
  await deleteSession(f.ctx,f.id);await assert.rejects(access(f.dir));
});
test("historical locator still refuses foreign roots and non-JSONL storage",async t=>{
  const f=await fixture(t);f.ctx.sessionPersistence.resolveCurrentLog=async()=>undefined;
  f.ctx.sessionPersistence.locate=()=>({kind:"other",path:f.log});await assert.rejects(resolveDirectory(f.ctx,f.id));
  f.ctx.sessionPersistence.locate=()=>({kind:"jsonl",path:join(f.root,"session.v4.jsonl")});await assert.rejects(resolveDirectory(f.ctx,f.id),/拒绝/);await access(f.log);
});
test("API requires confirmation and POST, deduplicates concurrent delete requests", async t => {
  const f=await fixture(t); let handler;
  f.ctx.effect=fn=>fn(); f.ctx.webServer={register(route){handler=route.handler;return()=>{};}}; apply(f.ctx);
  const call=async(body,method="POST")=>{
    const req=Readable.from([JSON.stringify(body)]); req.url="/desktop-delete/api/delete";req.method=method;req.headers={"content-type":"application/json"};
    let status;let payload; const res={writeHead(n){status=n;},end(text){payload=JSON.parse(text);}};
    await handler(req,res);return {status,payload};
  };
  assert.equal((await call({sessionId:f.id})).status,400); await access(f.log);
  f.ctx.connection.admit=()=>({rejection:401});
  assert.equal((await call({sessionId:f.id,confirm:true})).status,401); await access(f.log);
  f.ctx.connection.admit=()=>({rejection:403});
  assert.equal((await call({sessionId:f.id,confirm:true})).status,403); await access(f.log);
  f.ctx.connection.admit=()=>({peer:{}});
  assert.equal((await call({sessionId:f.id,confirm:true},"GET")).status,405); await access(f.log);
  const results=await Promise.all([call({sessionId:f.id,confirm:true}),call({sessionId:f.id,confirm:true})]);
  assert.ok(results.every(x=>x.status===200)); assert.equal(f.calls.filter(x=>x.startsWith("archive:")).length,1);
  assert.equal((await call({sessionId:f.id,confirm:true})).status,200);
});
