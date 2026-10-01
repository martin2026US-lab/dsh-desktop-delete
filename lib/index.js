import { realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";

export const name = "dsh-desktop-delete";
export const inject = ["connection", "webServer", "workspaceRegistry", "agents", "sessions", "sessionPersistence", "dshHomePath"];
export const API = "/desktop-delete/api";
const fail = (message, code = "DELETE_REFUSED") => Object.assign(new Error(message), { code });

export async function resolveDirectory(ctx, id) {
  const persistence = ctx.sessionPersistence;
  const snapshot = await persistence.stat(id);
  if (snapshot?.header?.id !== id || snapshot.header.origin === "subagent") throw fail("会话不存在，或属于子任务。");
  // The selected backend owns path encoding. Never build a path from an input id.
  let path = await persistence.resolveCurrentLog?.(id);
  if (path === undefined && typeof persistence.locate === "function") {
    // For historical v0-v3 logs, resolveCurrentLog deliberately returns no
    // path until write-open publishes migration. locate() names the current
    // generation in the SAME session directory using the validated header.
    // Only use its directory; the current-generation file need not exist yet.
    const location = persistence.locate(snapshot.header);
    if (location?.kind === "jsonl") path = location.path;
  }
  if (typeof path !== "string" || !/^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(basename(path))) {
    throw fail("无法安全定位该会话的存储目录，已取消删除。");
  }
  const root = await realpath(ctx.dshHomePath("sessions"));
  const directory = await realpath(dirname(path));
  const rel = relative(root, directory);
  // 0.2.0 JSONL layout: sessions / encoded-workspace / encoded-session.
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).length !== 2) {
    throw fail("拒绝删除 Harness 会话目录之外的数据。");
  }
  return directory;
}

async function idle(agent, timeoutMs) {
  let timer;
  try {
    await Promise.race([agent.whenIdle(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail("任务未能停止，请稍后重试。", "SESSION_BUSY")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// 0.2.0-rc.2 has no public close-one-session method. Feature-detect the exact
// lifecycle entries and JSONL writer; refuse rather than touching other agents.
function liveCapabilities(ctx, id) {
  const live = ctx.sessions.get(id);
  if (!live) return undefined;
  const agent = ctx.agents.get(id);
  const sessionEntry = ctx.sessions.store?.get(id);
  const agentEntry = ctx.agents.store?.get(id);
  const writers = ctx.sessionPersistence.tracker?.writers;
  if (!agent || agent.session !== live || !agent.runMaintenance || !agent.scope?.dispose ||
      sessionEntry?.session !== live || agentEntry?.agent !== agent ||
      typeof ctx.sessions.detachEntered !== "function" || typeof ctx.agents.detachEntered !== "function" ||
      !(writers instanceof Map) || typeof ctx.sessionPersistence.open !== "function") {
    throw fail("当前会话的生命周期不支持安全删除。", "SESSION_BUSY");
  }
  return { live, agent, sessionEntry, agentEntry, writers };
}

export async function deleteSession(ctx, id, deleted = new Set(), options = {}) {
  const registry = ctx.workspaceRegistry;
  const lifecycle = liveCapabilities(ctx, id);
  const originallyArchived = registry.archivedSessionIds.includes(id);
  const originallyPinned = registry.pinnedSessionIds.includes(id);
  const owners = registry.list().filter((workspace) => workspace.sessionIds.includes(id));
  // Blocks future wakes first; registered providers stop jobs, subagents and
  // schedules for this identity. A cold id is validated by archiveSession.
  let committed = false;
  const operation = async () => {
    if (lifecycle) await ctx.sessions.flush(lifecycle.live);
    const directory = await resolveDirectory(ctx, id);
    const quarantine = `${directory}.delete-${randomBytes(6).toString("hex")}`;
    const detached = [];
    let moved = false;
    let closed = false;
    let writer;
    try {
      if (lifecycle) {
        writer = lifecycle.writers.get(id);
        if (typeof writer?.close !== "function") throw fail("会话写入句柄无法安全关闭。", "SESSION_BUSY");
        closed = true;
        await writer.close();
      } else {
        // A different Host/CLI may own a cold session. Acquire the backend's
        // exclusive write lease before attempting deletion; never bypass it.
        // For historical logs, write-open also publishes Harness' validated
        // migration while holding that lease, before we remove any artifacts.
        const lease = await ctx.sessionPersistence.open(id, "write");
        await lease.close();
      }
      await rename(directory, quarantine);
      moved = true;
      for (const workspace of owners) {
        await workspace.detachSession(id);
        detached.push(workspace);
      }
      await registry.unpinSession(id);
      await registry.unarchiveSession(id);
      // Quarantine is the checked directory plus a random suffix in the same
      // parent; recursive removal can only address that exact session artifact.
      await rm(quarantine, { recursive: true });
      committed = true;
      deleted.add(id);
    } catch (error) {
      const failures = [];
      if (moved) {
        try { await rename(quarantine, directory); } catch (rollback) { failures.push(rollback); }
      }
      for (const workspace of detached) {
        try { await workspace.attachSession(id); } catch (rollback) { failures.push(rollback); }
      }
      if (closed) {
        try { await ctx.sessionPersistence.open(id, "write"); } catch (rollback) { failures.push(rollback); }
      }
      if (failures.length) throw new AggregateError([error, ...failures], "删除失败，恢复未完成；请保留日志并检查会话数据。");
      throw error;
    }
    lifecycle?.agent.cancel({ kind: "disposed" });
  };
  try {
    await registry.archiveSession(id, { stopActivity: true });
    if (lifecycle) {
      const deadline = Date.now() + (options.timeoutMs ?? 15000);
      for (;;) {
        lifecycle.agent.cancel({ kind: "disposed" });
        await idle(lifecycle.agent, Math.max(1, deadline - Date.now()));
        try { await lifecycle.agent.runMaintenance(operation); break; }
        catch (error) {
          if (!/already has active work/.test(String(error?.message)) || Date.now() >= deadline) throw error;
        }
      }
    } else { await operation(); }
  } catch (error) {
    if (!committed) {
      // Restore the original visible/archive/pin state after a refused delete.
      try {
        if (originallyArchived) await registry.archiveSession(id);
        else await registry.unarchiveSession(id);
        if (originallyPinned) await registry.pinSession(id);
      } catch (rollback) { throw new AggregateError([error, rollback], "删除失败，会话状态恢复未完成。"); }
    }
    throw error;
  }
  if (lifecycle) {
    // Dispose only after leaving maintenance (disposing inside it would wait
    // for its own idle barrier). Removal prevents live catalog/search revival.
    try { await lifecycle.agent.scope.dispose(); }
    catch (error) { ctx.logger.warn(`desktop-delete: scope cleanup: ${error}`); }
    ctx.agents.detachEntered(lifecycle.agentEntry);
    ctx.sessions.detachEntered(lifecycle.sessionEntry);
  }
  ctx.emit("api-session/removed", id);
  return { sessionId: id, deleted: true };
}

export function apply(ctx) {
  const deleted = new Set();
  const pending = new Map();
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix", path: API,
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      const admission = ctx.connection.admit(req);
      if ("rejection" in admission) return send(admission.rejection, { ok: false, error: "unauthorized or untrusted request" });
      const route = new URL(req.url, "http://localhost").pathname;
      if (req.method !== "POST" || route !== `${API}/delete`) return send(405, { ok: false, error: "method not allowed" });
      try {
        if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) throw fail("需要 JSON 请求。");
        let data = "";
        for await (const chunk of req) {
          data += chunk;
          if (Buffer.byteLength(data) > 4096) throw fail("请求过大。");
        }
        const { sessionId, confirm } = JSON.parse(data);
        if (confirm !== true || typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 512 || sessionId.includes("\0")) throw fail("需要有效会话 ID 和删除确认。");
        if (deleted.has(sessionId)) return send(200, { ok: true, result: { sessionId, deleted: true } });
        let work = pending.get(sessionId);
        if (!work) {
          work = deleteSession(ctx, sessionId, deleted).finally(() => pending.delete(sessionId));
          pending.set(sessionId, work);
        }
        return send(200, { ok: true, result: await work });
      } catch (error) {
        ctx.logger.warn(`desktop-delete: ${error}`);
        return send(400, { ok: false, code: error.code, error: error.message });
      }
    }
  }), "desktop-delete: API");
}
