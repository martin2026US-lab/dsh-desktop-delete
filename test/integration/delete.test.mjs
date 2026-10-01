import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, access, rm, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runtime, runtimeModule } from './runtime-fixture.mjs';
import { deleteSession } from '../../lib/index.js';
import { zstdCompressSync } from 'node:zlib';
const { releasedV3SessionFormatCodec } = await runtimeModule('dsh-session-format-v2-to-v3');

async function fixture(t, options = {}) {
  const root=await mkdtemp(join(tmpdir(),'dsdd-integration-'));
  const cwd=join(root,'workspace');await mkdir(cwd);
  const ctx=await runtime(root, options);
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  const workspace=await ctx.workspaceRegistry.create(cwd,'Disposable test');
  const create=async(id)=>{const handle=await ctx.agents.create({sessionId:id,meta:{cwd},agentOptions:{}});await workspace.attachSession(id);return handle;};
  return {root,cwd,ctx,workspace,create};
}

async function legacy(f, id, compression, { invalid = false } = {}) {
  const header = { ...f.ctx.sessions.prepare(id, {meta:{cwd:f.cwd}}).header, version:3, delegationDepth:0 };
  const path = f.ctx.sessionPersistence.locate(header).path.replace('session.v4.', 'session.v3.');
  await mkdir(dirname(path), {recursive:true});
  const event = {type:'session/title', seq:0, time:header.createdAt, data:{title:'Legacy disposable history',source:{kind:'user'},messageSeqs:[]}};
  const rows = [releasedV3SessionFormatCodec.encodeHeader(header, 0), invalid ? {...event,type:'unknown/non-migratable'} : releasedV3SessionFormatCodec.encodeEvent(event)];
  const lines=rows.map(row=>Buffer.from(JSON.stringify(row)+'\n'));
  await writeFile(path, Buffer.concat(compression==='zstd'?lines.map(line=>zstdCompressSync(line)):lines));
  await f.workspace.attachSession(id);
  assert.equal(await f.ctx.sessionPersistence.resolveCurrentLog(id),undefined);
  return path;
}

for (const compression of ['none','zstd']) {
  test(`real v3 ${compression} history deletes without opening the conversation first, including migration and restart`,async t=>{
    const f=await fixture(t,{compression});const path=await legacy(f,'legacy',compression);
    const other=await f.create('keep');await f.ctx.sessions.flush(other.agent.session);
    await f.ctx.workspaceRegistry.pinSession('legacy');
    let migrated=false;
    const originalOpen=f.ctx.sessionPersistence.open.bind(f.ctx.sessionPersistence);
    f.ctx.sessionPersistence.open=async(...args)=>{const handle=await originalOpen(...args);migrated=!!(await f.ctx.sessionPersistence.resolveCurrentLog('legacy'));return handle;};
    await deleteSession(f.ctx,'legacy');assert.equal(migrated,true);
    await assert.rejects(access(dirname(path)),{code:'ENOENT'});
    assert.equal(await f.ctx.sessionPersistence.stat('legacy'),undefined);assert.ok(await f.ctx.sessionPersistence.stat('keep'));
    await f.ctx.fiber.dispose();const restarted=await runtime(f.root,{compression});t.after(()=>restarted.fiber.dispose());
    assert.equal(await restarted.sessionPersistence.stat('legacy'),undefined);
    assert.equal(restarted.workspaceRegistry.list().some(x=>x.sessionIds.includes('legacy')),false);
    assert.ok(await restarted.sessionPersistence.stat('keep'));
  });
}
test('real v3 foreign write lease refuses deletion without migrating or removing the source',async t=>{
  const f=await fixture(t,{compression:'zstd'});const path=await legacy(f,'legacy-locked','zstd');
  const second=await runtime(f.root,{compression:'zstd'});t.after(()=>second.fiber.dispose());
  const lock=await second.sessionPersistence.acquireLease('legacy-locked',undefined,dirname(path));t.after(()=>lock.release());
  const before=await readFile(path);await assert.rejects(deleteSession(f.ctx,'legacy-locked'));
  assert.deepEqual(await readFile(path),before);assert.equal(await f.ctx.sessionPersistence.resolveCurrentLog('legacy-locked'),undefined);
  assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes('legacy-locked'),false);
});
test('real v3 migration failure preserves source bytes and workspace state',async t=>{
  const f=await fixture(t,{compression:'zstd'});const path=await legacy(f,'invalid-legacy','zstd',{invalid:true});
  const before=await readFile(path);await assert.rejects(deleteSession(f.ctx,'invalid-legacy'));
  assert.deepEqual(await readFile(path),before);assert.equal(await f.ctx.sessionPersistence.resolveCurrentLog('invalid-legacy'),undefined);
  assert.ok(f.workspace.sessionIds.includes('invalid-legacy'));assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes('invalid-legacy'),false);
});
test('real Harness live Agent, JSONL history and workspace membership are removed; restart cannot revive them',async t=>{
  const f=await fixture(t);const target=await f.create('target');const other=await f.create('other');
  target.agent.session.append('session/title',{title:'Disposable deletion test'});
  await f.ctx.sessions.flush(target.agent.session);await f.ctx.sessions.flush(other.agent.session);
  const path=await f.ctx.sessionPersistence.resolveCurrentLog('target');await access(path);
  await f.ctx.workspaceRegistry.pinSession('target');
  await deleteSession(f.ctx,'target');
  await assert.rejects(access(dirname(path)),{code:'ENOENT'});
  assert.equal(await f.ctx.sessionPersistence.stat('target'),undefined);
  assert.equal(f.ctx.sessions.get('target'),undefined);assert.equal(f.ctx.agents.get('target'),undefined);
  assert.equal(f.workspace.sessionIds.includes('target'),false);assert.equal(f.ctx.workspaceRegistry.pinnedSessionIds.includes('target'),false);
  assert.ok(f.ctx.agents.get('other'));assert.ok(await f.ctx.sessionPersistence.stat('other'));
  await f.ctx.fiber.dispose();
  const restarted=await runtime(f.root);t.after(()=>restarted.fiber.dispose());
  assert.equal(await restarted.sessionPersistence.stat('target'),undefined);
  assert.equal((await restarted.sessionPersistence.list()).some(x=>x.header.id==='target'),false);
  assert.equal(restarted.workspaceRegistry.list().some(x=>x.sessionIds.includes('target')),false);
  assert.ok(await restarted.sessionPersistence.stat('other'));
});
test('real cold archived session deletes all files and survives a restart',async t=>{
  const f=await fixture(t);const target=await f.create('cold');await f.ctx.sessions.flush(target.agent.session);
  await target.dispose();await f.ctx.workspaceRegistry.archiveSession('cold');
  const path=await f.ctx.sessionPersistence.resolveCurrentLog('cold');await deleteSession(f.ctx,'cold');
  await assert.rejects(access(dirname(path)),{code:'ENOENT'});
  assert.deepEqual(f.ctx.workspaceRegistry.archivedSessionIds,[]);
  await f.ctx.fiber.dispose();const restarted=await runtime(f.root);t.after(()=>restarted.fiber.dispose());
  assert.equal(await restarted.sessionPersistence.stat('cold'),undefined);
});
test('real JSONL writer ownership prevents deletion by another Host',async t=>{
  const f=await fixture(t);const target=await f.create('held');await f.ctx.sessions.flush(target.agent.session);await target.dispose();
  const second=await runtime(f.root);t.after(()=>second.fiber.dispose());
  const foreign=await second.sessionPersistence.open('held','write');t.after(()=>foreign.close());
  const path=await f.ctx.sessionPersistence.resolveCurrentLog('held');
  await assert.rejects(deleteSession(f.ctx,'held'));
  await access(path);assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes('held'),false);
});
test('real live failure restores the writer and subsequent events remain durable',async t=>{
  const f=await fixture(t);const target=await f.create('rollback');await f.ctx.sessions.flush(target.agent.session);
  const path=await f.ctx.sessionPersistence.resolveCurrentLog('rollback');
  const original=f.workspace.detachSession;
  f.workspace.detachSession=async()=>{throw new Error('injected registry failure');};
  await assert.rejects(deleteSession(f.ctx,'rollback'),/injected registry failure/);
  f.workspace.detachSession=original;
  target.agent.session.append('session/title',{title:'Written after rollback'});
  await f.ctx.sessions.flush(target.agent.session);
  assert.match(await readFile(path,'utf8'),/Written after rollback/);
  assert.ok(f.ctx.sessionPersistence.tracker.writers.get('rollback'));
});
