import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeRoot = process.env.DSH_RUNTIME_ROOT;
if (!runtimeRoot) throw new Error('Set DSH_RUNTIME_ROOT to an extracted Harness 0.2.0-rc.2 runtime containing node_modules. See test/integration/README.md.');

export function runtimeModule(name) {
  return import(pathToFileURL(join(resolve(runtimeRoot), 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href);
}

const [{ Context }, { default: Sessions }, { default: Agents }, { default: AgentLoop },
  { default: Projections }, { default: SystemPrompt }, { default: Jsonl },
  { default: Storage }, StorageJson, StorageDomain, { default: Workspaces }] = await Promise.all([
  'cordis', 'dsh-session', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-projection',
  'dsh-system-prompt', 'dsh-session-persistence-jsonl', 'dsh-storage',
  'dsh-storage-json', 'dsh-storage-domain', 'dsh-workspace'
].map(runtimeModule));

export async function runtime(root, { compression = 'none' } = {}) {
  const ctx = new Context();
  ctx.provide('dshHomePath', (...parts) => join(root, ...parts));
  ctx.provide('llm', {}); ctx.provide('tools', {});
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Sessions); await ctx.plugin(Agents); await ctx.plugin(Projections);
  await ctx.plugin(Jsonl, {root:join(root,'sessions'),compression});
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, {root:join(root,'storages')});
  await ctx.plugin(StorageDomain,{backend:'json'});
  await ctx.plugin(Workspaces);
  await ctx.plugin(AgentLoop,{agents:[]});
  return ctx;
}
