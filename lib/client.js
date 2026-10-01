window.__ModuleLoader__.load({
  id: "dsh-desktop-delete",
  factory: (require) => {
    const React = require("react");
    const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
    const { MenuItemButton, Modal, Button } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    const NS = "desktopDelete";
    const zh = { label: "删除对话", title: "删除这条对话？", description: "将永久删除「{title}」的历史记录；运行中的任务也会停止。此操作无法撤销。", cancel: "取消", confirm: "删除对话", pending: "正在删除…", failed: "删除失败：{message}", close: "关闭", navigation: "无法关闭当前对话，请关闭相关页面后重试。" };
    const en = { label: "Delete conversation", title: "Delete this conversation?", description: 'Permanently delete the history of “{title}” and stop its running tasks. This cannot be undone.', cancel: "Cancel", confirm: "Delete conversation", pending: "Deleting…", failed: "Delete failed: {message}", close: "Close", navigation: "Could not close the current conversation. Close its pages and retry." };

    function Trash() {
      return h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true },
        h("path", { d: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" }));
    }
    function Menu({ sessionId, displayTitle, useMenuOpenState, requestDelete, t }) {
      const [, setMenuOpen] = useMenuOpenState();
      return h(MenuItemButton, {
        icon: h(Trash), danger: true, separatorBefore: true,
        onSelect: () => { setMenuOpen(false); requestDelete({ sessionId, displayTitle }); }
      }, t("label"));
    }
    function Overlay({ useDeleteRequest, settleDelete, remove, t }) {
      const request = useDeleteRequest((state) => state);
      return request ? h(Form, { key: request.sessionId, request, settleDelete, remove, t }) : null;
    }
    function Form({ request, settleDelete, remove, t }) {
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const close = () => { if (!busy) settleDelete(); };
      const confirm = async () => {
        if (busy) return;
        setBusy(true); setError(null);
        try { await remove(request.sessionId); settleDelete(); }
        catch (reason) { setError(reason.message ?? String(reason)); setBusy(false); }
      };
      return h(Modal, {
        open: true, onClose: close, closeLabel: t("close"), title: t("title"),
        description: t("description", { title: request.displayTitle }),
        footer: h(React.Fragment, null,
          h(Button, { variant: "outline", disabled: busy, onClick: close, autoFocus: true }, t("cancel")),
          h(Button, { disabled: busy, className: "dsdd-confirm", onClick: confirm }, t(busy ? "pending" : "confirm")))
      }, error ? h("div", { role: "alert", className: "dsdd-danger" }, t("failed", { message: error })) : null);
    }
    function apply(ctx) {
      const request = createSnapshotStore(null);
      const deleted = new Set();
      let filtering = false;
      const filter = () => {
        if (filtering) return;
        filtering = true;
        try {
          const state = ctx.sessions.list.getSnapshot();
          for (const id of deleted) if (state.byId[id]) ctx.sessions.handleSessionRemoved(id);
        } finally { filtering = false; }
      };
      ctx.effect(() => ctx.sessions.list.subscribe(filter), "desktop-delete: catalog filter");
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "desktop-delete: locale");
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = ".dsdd-danger{color:var(--dsw-alias-state-error-primary,#d92d20)!important}.dsdd-confirm{color:#fff!important;background:#d92d20!important;border-color:#d92d20!important}";
        document.head.appendChild(style);
        return () => style.remove();
      }, "desktop-delete: style");
      const remove = async (id) => {
        if ((ctx.sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0) {
          const owner = ctx.workspaces.list.getSnapshot().items.find((workspace) => workspace.sessionIds.includes(id));
          ctx.uiWorkspace.startSession(owner?.id);
          const deadline = Date.now() + 5000;
          while ((ctx.sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0) {
            if (Date.now() >= deadline) throw new Error(ctx.locale.bind(NS)("navigation"));
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        const response = await fetch("/desktop-delete/api/delete", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: id, confirm: true })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`);
        deleted.add(id);
        ctx.sessions.handleSessionRemoved(id);
        await ctx.sessions.refresh().catch(() => {});
        filter();
      };
      ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
        name: "sidebar.workspaces.session.menu.item", id: "desktop-delete", order: 500, locale: NS,
        inject: () => ({ requestDelete: (target) => request.set(target) })
      }, Menu));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay", id: "desktop-delete-confirm", locale: NS,
        inject: () => ({ hooks: { deleteRequest: request }, settleDelete: () => request.set(null), remove })
      }, Overlay));
    }
    return { apply, inject: ["slots", "locale", "sessions", "workspaces", "uiWorkspace"] };
  }
});
