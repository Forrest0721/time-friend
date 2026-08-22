"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  AgentRunDto,
  FolderDto,
  ItemDto,
  ProgressEntryDto,
  TaskGroupDto,
  TaskListDto,
  WeeklyReviewViewDto,
} from "@time-friend/contracts";

import { agentRunEventsUrl, apiMutation, apiRequest, ApiError } from "./api-client";

type MainView = "tasks" | "focus" | "trajectory" | "memory";
type FocusSession = {
  id: string;
  taskId: string | null;
  mode: "pomodoro" | "stopwatch";
  state: "running" | "paused" | "awaiting_feedback" | "completed" | "canceled" | "needs_attention";
  plannedSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  expectedEndAt: string | null;
  baseActiveSeconds: number;
  effectiveSeconds: number | null;
  revision: number;
};
type FocusView = { session: FocusSession; openSegment: unknown | null; serverNow: string };
type FocusRecord = { session: FocusSession; progress: ProgressEntryDto | null };
type TaskExecutionSummary = {
  totalFocusSeconds: number;
  sessionCount: number;
  pomodoroCount: number;
  recentProgress: ProgressEntryDto[];
};
type Bootstrap = {
  user: { id: string; name: string; email: string; timezone: string; agentEnabled: boolean };
  folders: FolderDto[];
  lists: TaskListDto[];
  groups: TaskGroupDto[];
  items: ItemDto[];
  activeFocusSession: FocusView | null;
  pendingReviews: number;
};
type PeriodSnapshot = {
  id: string;
  version: number;
  status: "current" | "stale" | "superseded";
  metrics: {
    focus: { totalSeconds: number; sessionCount: number; pomodoroCount: number; unlinkedSeconds: number; byList: Array<{ listId: string; listName: string; seconds: number }> };
    progress: { completed: number; progressed: number; blocked: number; maintenance: number };
    tasks: { completedIds: string[]; abandonedIds: string[]; plannedButUnfinishedIds: string[] };
    dataQuality: { evidenceCount: number; unlinkedFocusRatio: number; hasEnoughData: boolean };
  };
};
type WeekSummary = {
  period: { id: string; localStartDate: string; localEndDate: string; startsAt: string; endsAt: string; timezone: string };
  snapshots: PeriodSnapshot[];
};
type WeekDetail = WeekSummary & { review: WeeklyReviewViewDto | null };
type ProductMemory = {
  id: string;
  memoryType: string;
  value: Record<string, unknown>;
  status: "active" | "superseded" | "deleted";
  revision: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};
type ProductDirection = {
  id: string;
  name: string;
  description: string;
  state: "candidate" | "active" | "paused" | "ended" | "replaced";
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export default function ConnectedApp() {
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "ready" | "error">("checking");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<MainView>("tasks");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeFocus, setActiveFocus] = useState<FocusView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBootstrap = useCallback(async () => {
    const data = await apiRequest<Bootstrap>("/api/v1/bootstrap");
    setBootstrap(data);
    setActiveFocus(data.activeFocusSession);
    setSelectedListId((current) => current ?? data.lists.find((list) => list.isInbox)?.id ?? data.lists[0]?.id ?? null);
    setAuthState("ready");
  }, []);

  useEffect(() => {
    void apiRequest<{ user?: unknown } | null>("/api/auth/get-session")
      .then((session) => session?.user ? loadBootstrap() : setAuthState("unauthenticated"))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) setAuthState("unauthenticated");
        else {
          setMessage(errorMessage(error));
          setAuthState("error");
        }
      });
  }, [loadBootstrap]);

  async function perform<T>(work: () => Promise<T>, success?: string): Promise<T | null> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await work();
      if (success) setMessage(success);
      return result;
    } catch (error) {
      setMessage(errorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (authState === "checking") return <CenteredState title="正在带回你的时间记录" detail="任务、专注与轨迹正在汇合。" />;
  if (authState === "unauthenticated") return <AuthPanel onAuthenticated={loadBootstrap} />;
  if (authState === "error" || !bootstrap) {
    return <CenteredState title="暂时没有连接上见时" detail={message ?? "请确认服务端已启动，然后重试。"} action={() => location.reload()} />;
  }

  const selectedItem = bootstrap.items.find((item) => item.id === selectedItemId) ?? null;
  const activeTasks = bootstrap.items.filter((item) => item.kind === "task" && item.status === "pending");

  async function createOrganization(kind: "folder" | "list" | "group") {
    const name = window.prompt(kind === "folder" ? "文件夹名称" : kind === "list" ? "清单名称" : "分组名称")?.trim();
    if (!name) return;
    await perform(async () => {
      if (kind === "folder") await apiMutation("/api/v1/folders", "POST", { name });
      if (kind === "list") await apiMutation("/api/v1/lists", "POST", { name, folderId: null, learningPolicy: "include" });
      if (kind === "group" && selectedListId) await apiMutation(`/api/v1/lists/${selectedListId}/groups`, "POST", { name });
      await loadBootstrap();
    }, `${name}已创建`);
  }

  async function updateOrganization(
    kind: "folder" | "list" | "group",
    resource: FolderDto | TaskListDto | TaskGroupDto,
    action: "rename" | "archive",
  ) {
    if (action === "archive" && "isInbox" in resource && resource.isInbox) return;
    const name = action === "rename" ? window.prompt("新的名称", resource.name)?.trim() : null;
    if (action === "rename" && !name) return;
    if (action === "archive" && !window.confirm(`归档「${resource.name}」？内容不会被删除。`)) return;
    const path = kind === "folder" ? "folders" : kind === "list" ? "lists" : "groups";
    await perform(
      () => apiMutation(`/api/v1/${path}/${resource.id}`, "PATCH", {
        ...(action === "rename" ? { name } : { archived: true }),
        expectedRevision: resource.revision,
      }),
      action === "rename" ? "名称已更新" : "已归档",
    );
    if (action === "archive" && kind === "list" && selectedListId === resource.id) setSelectedListId(null);
    await loadBootstrap();
  }

  async function reorderOrganization(kind: "folder" | "list" | "group", id: string, direction: -1 | 1, listId?: string) {
    const rows = kind === "folder"
      ? bootstrap!.folders.filter((entry) => !entry.archivedAt)
      : kind === "list"
        ? bootstrap!.lists.filter((entry) => !entry.archivedAt)
        : bootstrap!.groups.filter((entry) => !entry.archivedAt && entry.listId === listId);
    const ordered = [...rows].sort((left, right) => left.positionKey.localeCompare(right.positionKey));
    const index = ordered.findIndex((entry) => entry.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    const path = kind === "folder" ? "/api/v1/folders/reorder" : kind === "list" ? "/api/v1/lists/reorder" : `/api/v1/lists/${listId}/groups/reorder`;
    await perform(() => apiMutation(path, "POST", { ids: ordered.map((entry) => entry.id) }), "顺序已更新");
    await loadBootstrap();
  }

  async function createItem(input: { title: string; kind: "task" | "note"; groupId: string | null; parentTaskId: string | null }) {
    if (!selectedListId) return;
    const created = await perform(
      () => apiMutation<ItemDto>("/api/v1/items", "POST", { listId: selectedListId, ...input }),
      input.kind === "note" ? "笔记已保存" : input.parentTaskId ? "子任务已添加" : "任务已添加",
    );
    if (!created) return;
    setBootstrap((current) => current ? { ...current, items: [...current.items, created] } : current);
    setSelectedItemId(created.id);
  }

  async function transition(item: ItemDto) {
    if (item.kind !== "task" || item.status === null) return;
    const command = item.status === "completed" ? "reopen" : item.status === "abandoned" ? "resume" : "complete";
    const updated = await perform(() => apiMutation<ItemDto>(`/api/v1/tasks/${item.id}/${command}`, "POST", { expectedRevision: item.revision }));
    if (updated) replaceItem(updated);
  }

  async function commandTask(item: ItemDto, command: "complete" | "reopen" | "abandon" | "resume") {
    if (item.kind !== "task") return;
    const updated = await perform(() => apiMutation<ItemDto>(`/api/v1/tasks/${item.id}/${command}`, "POST", { expectedRevision: item.revision }));
    if (updated) replaceItem(updated);
  }

  async function saveItem(item: ItemDto, input: { title: string; plannedOn: string | null; priority: ItemDto["priority"]; body: string }) {
    const updated = await perform(
      () => apiMutation<ItemDto>(`/api/v1/items/${item.id}`, "PATCH", {
        title: input.title,
        ...(item.kind === "task" ? { plannedOn: input.plannedOn } : {}),
        ...(item.kind === "task" ? { priority: input.priority } : {}),
        contentDoc: textToContentDocument(input.body),
        expectedRevision: item.revision,
      }),
      "内容已保存",
    );
    if (updated) replaceItem(updated);
  }

  async function moveItem(item: ItemDto, direction: -1 | 1) {
    const scope = bootstrap!.items
      .filter((entry) => entry.listId === item.listId && entry.groupId === item.groupId && entry.parentTaskId === item.parentTaskId)
      .sort((left, right) => left.positionKey.localeCompare(right.positionKey));
    const index = scope.findIndex((entry) => entry.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= scope.length) return;
    [scope[index], scope[target]] = [scope[target]!, scope[index]!];
    await perform(
      () => apiMutation(`/api/v1/items/reorder`, "POST", {
        listId: item.listId,
        groupId: item.groupId,
        parentTaskId: item.parentTaskId,
        ids: scope.map((entry) => entry.id),
      }),
      "顺序已更新",
    );
    await loadBootstrap();
  }

  function replaceItem(item: ItemDto) {
    setBootstrap((current) => current ? { ...current, items: current.items.map((entry) => entry.id === item.id ? item : entry) } : current);
  }

  async function startFocus(taskId: string | null, mode: "pomodoro" | "stopwatch", plannedSeconds: number | null) {
    const started = await perform(() => apiMutation<FocusView>("/api/v1/focus-sessions", "POST", {
      taskId,
      mode,
      ...(mode === "pomodoro" ? { plannedSeconds } : {}),
    }));
    if (!started) return;
    setActiveFocus(started);
    setView("focus");
  }

  async function focusCommand(command: "pause" | "resume" | "finish" | "cancel") {
    if (!activeFocus) return;
    const result = await perform(() => apiMutation<FocusView>(
      `/api/v1/focus-sessions/${activeFocus.session.id}/${command}`,
      "POST",
      { expectedRevision: activeFocus.session.revision },
    ));
    if (result) setActiveFocus(result);
  }

  async function focusFeedback(input: {
    outcome: "completed" | "progressed" | "blocked" | "maintenance" | null;
    note: string;
    nextStep: string;
    completeTask: boolean;
    effectiveSeconds?: number;
  }) {
    if (!activeFocus) return;
    const result = await perform(() => apiMutation<{ session: FocusSession; task: ItemDto | null }>(
      `/api/v1/focus-sessions/${activeFocus.session.id}/feedback`,
      "POST",
      {
        outcome: input.outcome,
        note: input.note || null,
        nextStep: input.nextStep || null,
        completeTask: input.completeTask,
        ...(input.effectiveSeconds === undefined
          ? {}
          : { effectiveSeconds: input.effectiveSeconds, adjustmentReason: "结束专注时由用户修正" }),
        expectedRevision: activeFocus.session.revision,
      },
    ), "这段真实投入已经进入轨迹");
    if (!result) return;
    if (result.task) replaceItem(result.task);
    setActiveFocus(null);
    setView("tasks");
  }

  async function toggleAgent() {
    const enabled = !bootstrap!.user.agentEnabled;
    if (!enabled && !window.confirm("关闭后将停止自动周复盘，也不能手动生成新的 Agent 解释。已确认的轨迹与记忆仍会保留。继续吗？")) return;
    const updated = await perform(
      () => apiMutation<{ userId: string; agentEnabled: boolean; updatedAt: string }>(
        "/api/v1/settings/agent",
        "PATCH",
        { agentEnabled: enabled },
      ),
      enabled ? "Agent 分析已开启" : "Agent 分析已关闭；任务、专注和历史轨迹不受影响",
    );
    if (!updated) return;
    setBootstrap((current) => current ? { ...current, user: { ...current.user, agentEnabled: updated.agentEnabled } } : current);
  }

  async function exportAccountData() {
    const exported = await perform(() => apiRequest<Record<string, unknown>>("/api/v1/account/export"), "个人数据已导出");
    if (!exported) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `time-friend-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    const confirmation = window.prompt("此操作会撤销登录并永久删除任务、专注、轨迹和长期记忆。请输入 DELETE 确认：")?.trim();
    if (confirmation !== "DELETE") return;
    const accepted = await perform(
      () => apiMutation<{ id: string; status: string }>("/api/v1/account", "DELETE", { confirmation: "DELETE" }),
      "账户已冻结，删除任务正在执行",
    );
    if (accepted) window.setTimeout(() => location.reload(), 1_200);
  }

  return (
    <main className="connected-shell" aria-busy={busy}>
      <aside className="connected-sidebar">
        <button className="connected-brand" onClick={() => setView("tasks")}><span>见</span><b>见时</b><small>Time Friend</small></button>
        <nav aria-label="主导航">
          <NavButton active={view === "tasks"} label="行动" meta={`${activeTasks.length}`} onClick={() => setView("tasks")} />
          <NavButton active={view === "focus"} label="专注" meta={activeFocus ? "进行中" : ""} onClick={() => setView("focus")} />
          <NavButton active={view === "trajectory"} label="轨迹" meta={bootstrap.pendingReviews ? String(bootstrap.pendingReviews) : ""} onClick={() => setView("trajectory")} />
          <NavButton active={view === "memory"} label="长期记忆" meta="" onClick={() => setView("memory")} />
        </nav>
        <div className="connected-lists">
          <div className="connected-section-label"><span>空间</span><button onClick={() => createOrganization("folder")} aria-label="新建文件夹">＋</button></div>
          {bootstrap.folders.filter((folder) => !folder.archivedAt).map((folder) => (
            <section key={folder.id}>
              <div className="connected-organization-heading"><h3>{folder.name}</h3><OrganizationActions onRename={() => updateOrganization("folder", folder, "rename")} onArchive={() => updateOrganization("folder", folder, "archive")} onUp={() => reorderOrganization("folder", folder.id, -1)} onDown={() => reorderOrganization("folder", folder.id, 1)} /></div>
              {bootstrap.lists.filter((list) => list.folderId === folder.id && !list.archivedAt).map((list) => (
                <div className="connected-organization-row" key={list.id}><ListButton list={list} selected={selectedListId === list.id} count={countPending(bootstrap.items, list.id)} onClick={() => { setSelectedListId(list.id); setView("tasks"); }} /><OrganizationActions compact onRename={() => updateOrganization("list", list, "rename")} onArchive={list.isInbox ? undefined : () => updateOrganization("list", list, "archive")} onUp={() => reorderOrganization("list", list.id, -1)} onDown={() => reorderOrganization("list", list.id, 1)} /></div>
              ))}
            </section>
          ))}
          {bootstrap.lists.filter((list) => list.folderId === null && !list.archivedAt).map((list) => (
            <div className="connected-organization-row" key={list.id}><ListButton list={list} selected={selectedListId === list.id} count={countPending(bootstrap.items, list.id)} onClick={() => { setSelectedListId(list.id); setView("tasks"); }} /><OrganizationActions compact onRename={() => updateOrganization("list", list, "rename")} onArchive={list.isInbox ? undefined : () => updateOrganization("list", list, "archive")} onUp={() => reorderOrganization("list", list.id, -1)} onDown={() => reorderOrganization("list", list.id, 1)} /></div>
          ))}
          <button className="connected-add-list" onClick={() => createOrganization("list")}>＋ 新清单</button>
        </div>
        <div className="connected-account"><span>{initials(bootstrap.user.name)}</span><div><b>{bootstrap.user.name}</b><small>{bootstrap.user.email}</small></div><p><button className={bootstrap.user.agentEnabled ? "agent-on" : ""} onClick={toggleAgent}>{bootstrap.user.agentEnabled ? "Agent 开" : "Agent 关"}</button><button onClick={exportAccountData}>导出</button><button onClick={() => void apiRequest("/api/auth/sign-out", { method: "POST" }).then(() => location.reload())}>退出</button><button className="delete-account" onClick={deleteAccount}>删号</button></p></div>
      </aside>

      <section className="connected-workspace">
        {message && <div className="connected-message" role="status"><span>{message}</span><button onClick={() => setMessage(null)}>×</button></div>}
        {view === "tasks" && (
          <TaskWorkspace
            data={bootstrap}
            selectedListId={selectedListId}
            selectedItem={selectedItem}
            onSelectItem={setSelectedItemId}
            onCreate={createItem}
            onTransition={transition}
            onCommandTask={commandTask}
            onSave={saveItem}
            onStartFocus={(id) => startFocus(id, "pomodoro", 25 * 60)}
            onMove={moveItem}
            onCreateGroup={() => createOrganization("group")}
            onUpdateOrganization={updateOrganization}
            onReorderOrganization={reorderOrganization}
            onReload={loadBootstrap}
            perform={perform}
          />
        )}
        {view === "focus" && (
          <FocusWorkspace
            key={activeFocus?.session.id ?? "idle"}
            tasks={activeTasks}
            active={activeFocus}
            onStart={startFocus}
            onCommand={focusCommand}
            onFeedback={focusFeedback}
            perform={perform}
          />
        )}
        {view === "trajectory" && <TrajectoryWorkspace agentEnabled={bootstrap.user.agentEnabled} onToggleAgent={toggleAgent} perform={perform} />}
        {view === "memory" && <MemoryWorkspace perform={perform} />}
      </section>
    </main>
  );
}

function TaskWorkspace({ data, selectedListId, selectedItem, onSelectItem, onCreate, onTransition, onCommandTask, onSave, onStartFocus, onMove, onCreateGroup, onUpdateOrganization, onReorderOrganization, onReload, perform }: {
  data: Bootstrap;
  selectedListId: string | null;
  selectedItem: ItemDto | null;
  onSelectItem(id: string): void;
  onCreate(input: { title: string; kind: "task" | "note"; groupId: string | null; parentTaskId: string | null }): Promise<void>;
  onTransition(item: ItemDto): Promise<void>;
  onCommandTask(item: ItemDto, command: "complete" | "reopen" | "abandon" | "resume"): Promise<void>;
  onSave(item: ItemDto, input: { title: string; plannedOn: string | null; priority: ItemDto["priority"]; body: string }): Promise<void>;
  onStartFocus(id: string): Promise<void>;
  onMove(item: ItemDto, direction: -1 | 1): Promise<void>;
  onCreateGroup(): void;
  onUpdateOrganization(kind: "folder" | "list" | "group", resource: FolderDto | TaskListDto | TaskGroupDto, action: "rename" | "archive"): Promise<void>;
  onReorderOrganization(kind: "folder" | "list" | "group", id: string, direction: -1 | 1, listId?: string): Promise<void>;
  onReload(): Promise<void>;
  perform<T>(work: () => Promise<T>, success?: string): Promise<T | null>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"task" | "note">("task");
  const [groupId, setGroupId] = useState<string>("");
  const [parentTaskId, setParentTaskId] = useState<string>("");
  const list = data.lists.find((entry) => entry.id === selectedListId) ?? null;
  const groups = data.groups.filter((entry) => entry.listId === selectedListId && !entry.archivedAt);
  const items = data.items.filter((entry) => entry.listId === selectedListId && !entry.deletedAt);
  const topLevel = items.filter((entry) => entry.parentTaskId === null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await onCreate({ title: title.trim(), kind, groupId: groupId || null, parentTaskId: kind === "task" && parentTaskId ? parentTaskId : null });
    setTitle("");
    setParentTaskId("");
  }

  async function toggleLearning() {
    if (!list) return;
    await perform(
      () => apiMutation(`/api/v1/lists/${list.id}`, "PATCH", {
        learningPolicy: list.learningPolicy === "include" ? "exclude" : "include",
        expectedRevision: list.revision,
      }),
      list.learningPolicy === "include" ? "此清单已从轨迹学习中排除" : "此清单重新参与轨迹学习",
    );
    await onReload();
  }

  return <div className={`connected-task-layout ${selectedItem ? "with-detail" : ""}`}>
    <section className="connected-task-main">
      <header className="connected-page-header"><div><span>快速组织，安静执行</span><h1>{list?.name ?? "行动"}</h1><p>{list?.learningPolicy === "exclude" ? "此清单不会进入 Agent 的统计、证据和记忆。" : "不需要先决定目标归属，真实行动会在轨迹里慢慢显现。"}</p></div><div><button className="connected-secondary" onClick={toggleLearning}>{list?.learningPolicy === "exclude" ? "恢复学习" : "排除学习"}</button><button className="connected-secondary" onClick={onCreateGroup}>＋ 分组</button></div></header>
      <form className="connected-composer" onSubmit={submit}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "note" ? "记下一段说明、检查事项或资料" : "添加任务，按 Enter 保存"} aria-label="标题" />
        <select value={kind} onChange={(event) => setKind(event.target.value as "task" | "note")}><option value="task">任务</option><option value="note">笔记</option></select>
        <select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">无分组</option>{groups.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        {kind === "task" && <select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}><option value="">顶层任务</option>{topLevel.filter((entry) => entry.kind === "task").map((entry) => <option key={entry.id} value={entry.id}>作为「{entry.title}」的子任务</option>)}</select>}
        <button>添加</button>
      </form>
      {groupsWithUngrouped(groups).map((group) => {
        const current = topLevel.filter((item) => item.groupId === group.id);
        const open = current.filter((item) => item.status !== "completed" && item.status !== "abandoned");
        const completed = current.filter((item) => item.status === "completed");
        const abandoned = current.filter((item) => item.status === "abandoned");
        const groupRecord = group.id ? groups.find((entry) => entry.id === group.id) : null;
        if (current.length === 0 && group.id === null) return null;
        return <section className="connected-group" key={group.id ?? "ungrouped"}>
          <div className="connected-group-title"><h2>{group.name}</h2><span>{open.length}</span>{groupRecord && <OrganizationActions compact onRename={() => onUpdateOrganization("group", groupRecord, "rename")} onArchive={() => onUpdateOrganization("group", groupRecord, "archive")} onUp={() => onReorderOrganization("group", groupRecord.id, -1, groupRecord.listId)} onDown={() => onReorderOrganization("group", groupRecord.id, 1, groupRecord.listId)} />}</div>
          {open.map((item) => <ItemRow key={item.id} item={item} subtasks={items.filter((entry) => entry.parentTaskId === item.id)} onSelect={onSelectItem} onTransition={onTransition} onFocus={onStartFocus} onMove={onMove} />)}
          {completed.length > 0 && <details className="connected-completed"><summary>已完成 · {completed.length}</summary>{completed.map((item) => <ItemRow key={item.id} item={item} subtasks={items.filter((entry) => entry.parentTaskId === item.id)} onSelect={onSelectItem} onTransition={onTransition} onFocus={onStartFocus} onMove={onMove} />)}</details>}
          {abandoned.length > 0 && <details className="connected-completed abandoned"><summary>已放弃 · {abandoned.length}</summary>{abandoned.map((item) => <ItemRow key={item.id} item={item} subtasks={items.filter((entry) => entry.parentTaskId === item.id)} onSelect={onSelectItem} onTransition={onTransition} onFocus={onStartFocus} onMove={onMove} />)}</details>}
        </section>;
      })}
      {items.length === 0 && <EmptyState title="这里还很安静" detail="先写下一个任务或一条笔记。方向不需要现在决定。" />}
    </section>
    {selectedItem && selectedItem.listId === selectedListId && <ItemDetail key={`${selectedItem.id}:${selectedItem.revision}`} item={selectedItem} lists={data.lists.filter((entry) => !entry.archivedAt)} groups={data.groups.filter((entry) => !entry.archivedAt)} onSave={onSave} onCommand={onCommandTask} onStartFocus={onStartFocus} onReload={onReload} onClose={() => onSelectItem("")} perform={perform} />}
  </div>;
}

function ItemRow({ item, subtasks, onSelect, onTransition, onFocus, onMove }: {
  item: ItemDto; subtasks: ItemDto[]; onSelect(id: string): void; onTransition(item: ItemDto): Promise<void>; onFocus(id: string): Promise<void>; onMove(item: ItemDto, direction: -1 | 1): Promise<void>;
}) {
  return <article className={`connected-item ${item.status === "completed" ? "completed" : ""} ${item.status === "abandoned" ? "abandoned" : ""} ${item.kind === "note" ? "note" : ""}`}>
    {item.kind === "task" ? <button className="connected-check" onClick={() => onTransition(item)} aria-label={`切换${item.title}完成状态`}>{item.status === "completed" ? "✓" : ""}</button> : <span className="connected-note-mark">文</span>}
    <button className="connected-item-copy" onClick={() => onSelect(item.id)}><b>{item.title}</b><small>{item.kind === "note" ? item.contentText || "独立笔记" : [item.plannedOn, `${subtasks.filter((entry) => entry.status === "completed").length}/${subtasks.length} 子任务`].filter(Boolean).join(" · ")}</small></button>
    <div className="connected-row-actions"><button onClick={() => onMove(item, -1)} aria-label="上移">↑</button><button onClick={() => onMove(item, 1)} aria-label="下移">↓</button>{item.kind === "task" && item.status === "pending" && <button className="connected-focus-mini" onClick={() => onFocus(item.id)}>专注</button>}</div>
    {subtasks.length > 0 && <div className="connected-subtasks">{subtasks.map((subtask) => <button key={subtask.id} onClick={() => onSelect(subtask.id)}><span onClick={(event) => { event.stopPropagation(); void onTransition(subtask); }}>{subtask.status === "completed" ? "✓" : "○"}</span>{subtask.title}</button>)}</div>}
  </article>;
}

function ItemDetail({ item, lists, groups, onSave, onCommand, onStartFocus, onReload, onClose, perform }: {
  item: ItemDto;
  lists: TaskListDto[];
  groups: TaskGroupDto[];
  onSave(item: ItemDto, input: { title: string; plannedOn: string | null; priority: ItemDto["priority"]; body: string }): Promise<void>;
  onCommand(item: ItemDto, command: "complete" | "reopen" | "abandon" | "resume"): Promise<void>;
  onStartFocus(id: string): Promise<void>;
  onReload(): Promise<void>;
  onClose(): void;
  perform<T>(work: () => Promise<T>, success?: string): Promise<T | null>;
}) {
  const [title, setTitle] = useState(item.title);
  const [plannedOn, setPlannedOn] = useState(item.plannedOn ?? "");
  const [priority, setPriority] = useState<ItemDto["priority"]>(item.priority);
  const [listId, setListId] = useState(item.listId);
  const [groupId, setGroupId] = useState(item.groupId ?? "");
  const [body, setBody] = useState(contentDocumentToText(item.contentDoc));
  const [timeline, setTimeline] = useState<Array<{ id: string; eventType: string; occurredAt: string }>>([]);
  const [summary, setSummary] = useState<TaskExecutionSummary | null>(null);
  const [progress, setProgress] = useState<ProgressEntryDto[]>([]);
  const [progressNote, setProgressNote] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [outcome, setOutcome] = useState<"progressed" | "blocked" | "maintenance" | "note">("progressed");

  const readExecution = useCallback(async () => {
    if (item.kind !== "task") return null;
    return Promise.all([
      apiRequest<{ items: typeof timeline }>(`/api/v1/tasks/${item.id}/timeline?limit=30`),
      apiRequest<TaskExecutionSummary>(`/api/v1/tasks/${item.id}/execution-summary`),
      apiRequest<{ items: ProgressEntryDto[] }>(`/api/v1/tasks/${item.id}/progress?limit=20`),
    ]);
  }, [item.id, item.kind]);

  const loadExecution = useCallback(async () => {
    const result = await readExecution();
    if (!result) return;
    const [events, executionSummary, progressPage] = result;
    setTimeline(events.items);
    setSummary(executionSummary);
    setProgress(progressPage.items);
  }, [readExecution]);

  useEffect(() => {
    void readExecution().then((result) => {
      if (!result) return;
      const [events, executionSummary, progressPage] = result;
      setTimeline(events.items);
      setSummary(executionSummary);
      setProgress(progressPage.items);
    }).catch(() => undefined);
  }, [readExecution]);

  async function saveAll() {
    let current = item;
    if (listId !== item.listId || groupId !== (item.groupId ?? "")) {
      const moved = await perform(() => apiMutation<ItemDto>(`/api/v1/items/${item.id}/move`, "POST", {
        listId,
        groupId: groupId || null,
        parentTaskId: item.parentTaskId,
        positionKey: item.positionKey,
        expectedRevision: item.revision,
      }));
      if (!moved) return;
      current = moved;
    }
    await onSave(current, { title: title.trim(), plannedOn: plannedOn || null, priority, body });
    await onReload();
  }

  async function addProgress() {
    if (!progressNote.trim() && !nextStep.trim() && outcome !== "maintenance") return;
    const result = await perform(
      () => apiMutation<ProgressEntryDto>(`/api/v1/tasks/${item.id}/progress`, "POST", { outcome, note: progressNote.trim() || null, nextStep: nextStep.trim() || null }),
      "进展已进入任务动态",
    );
    if (result) {
      setProgressNote("");
      setNextStep("");
      await loadExecution();
    }
  }

  async function editProgress(entry: ProgressEntryDto) {
    const note = window.prompt("修正进展说明", entry.note ?? "");
    if (note === null) return;
    const next = window.prompt("修正下一步", entry.nextStep ?? "");
    if (next === null) return;
    await perform(() => apiMutation(`/api/v1/progress/${entry.id}`, "PATCH", {
      note: note.trim() || null,
      nextStep: next.trim() || null,
      expectedRevision: entry.revision,
    }), "进展已修正");
    await loadExecution();
  }

  async function deleteProgress(entry: ProgressEntryDto) {
    if (!window.confirm("删除这条进展记录？轨迹会标记相关快照过期。")) return;
    await perform(() => apiMutation(`/api/v1/progress/${entry.id}?expectedRevision=${entry.revision}`, "DELETE"), "进展已删除");
    await loadExecution();
  }

  async function deleteItem() {
    if (!window.confirm(`删除「${item.title}」？`)) return;
    const removed = await perform(async () => {
      await apiMutation(`/api/v1/items/${item.id}?expectedRevision=${item.revision}`, "DELETE");
      return true;
    }, "内容已删除");
    if (!removed) return;
    onClose();
    await onReload();
  }

  const availableGroups = groups.filter((entry) => entry.listId === listId);

  return <aside className="connected-detail">
    <div className="connected-detail-top"><span>{item.kind === "note" ? "笔记" : item.parentTaskId ? "子任务" : "任务"}</span><button onClick={onClose}>×</button></div>
    <input className="connected-title-input" value={title} onChange={(event) => setTitle(event.target.value)} />
    {!item.parentTaskId && <div className="connected-field-row"><label className="connected-field">清单<select value={listId} onChange={(event) => { setListId(event.target.value); setGroupId(""); }}>{lists.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label className="connected-field">分组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">未分组</option>{availableGroups.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></div>}
    {item.kind === "task" && <div className="connected-field-row"><label className="connected-field">计划日期<input type="date" value={plannedOn} onChange={(event) => setPlannedOn(event.target.value)} /></label><label className="connected-field">优先级<select value={priority ?? "none"} onChange={(event) => setPriority(event.target.value as ItemDto["priority"])}><option value="none">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div>}
    <label className="connected-field connected-body-field"><span>笔记与检查事项</span><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={"写下上下文，或使用：\n- [ ] 待检查事项\n- [x] 已完成事项"} /></label>
    <button className="connected-primary" onClick={saveAll}>保存内容</button>
    {item.kind === "task" && <>
      <div className="connected-detail-actions">{item.status === "pending" && <><button onClick={() => onStartFocus(item.id)}>开始专注</button><button onClick={() => onCommand(item, "complete")}>完成</button><button onClick={() => onCommand(item, "abandon")}>放弃</button></>}{item.status === "completed" && <button onClick={() => onCommand(item, "reopen")}>重新打开</button>}{item.status === "abandoned" && <button onClick={() => onCommand(item, "resume")}>恢复</button>}</div>
      {summary && <section className="connected-execution-summary"><Fact label="累计专注" value={formatDuration(summary.totalFocusSeconds)} detail={`${summary.sessionCount} 次 · ${summary.pomodoroCount} 个番茄`} /></section>}
      <section className="connected-progress-box"><h3>记录进展</h3><div><select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="progressed">有推进</option><option value="blocked">被阻塞</option><option value="maintenance">维持事务</option><option value="note">仅记录</option></select><input value={progressNote} onChange={(event) => setProgressNote(event.target.value)} placeholder="发生了什么？" /><input value={nextStep} onChange={(event) => setNextStep(event.target.value)} placeholder="下一步（可选）" /><button onClick={addProgress}>记录</button></div></section>
      <section className="connected-progress-history"><h3>最近进展</h3>{progress.map((entry) => <article key={entry.id}><div><b>{outcomeLabel(entry.outcome)}</b><p>{entry.note || "无补充说明"}</p>{entry.nextStep && <small>下一步：{entry.nextStep}</small>}</div><div><button onClick={() => editProgress(entry)}>修正</button><button onClick={() => deleteProgress(entry)}>删除</button></div></article>)}</section>
      <section className="connected-timeline"><h3>动态</h3>{timeline.map((event) => <article key={event.id}><i /><div><b>{eventLabel(event.eventType)}</b><small>{formatDateTime(event.occurredAt)}</small></div></article>)}</section>
    </>}
    <button className="connected-danger" onClick={deleteItem}>删除{item.kind === "note" ? "笔记" : "任务"}</button>
  </aside>;
}

function FocusWorkspace({ tasks, active, onStart, onCommand, onFeedback, perform }: {
  tasks: ItemDto[]; active: FocusView | null; onStart(taskId: string | null, mode: "pomodoro" | "stopwatch", plannedSeconds: number | null): Promise<void>;
  onCommand(command: "pause" | "resume" | "finish" | "cancel"): Promise<void>;
  onFeedback(input: { outcome: "completed" | "progressed" | "blocked" | "maintenance" | null; note: string; nextStep: string; completeTask: boolean; effectiveSeconds?: number }): Promise<void>;
  perform<T>(work: () => Promise<T>, success?: string): Promise<T | null>;
}) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? "");
  const [mode, setMode] = useState<"pomodoro" | "stopwatch">("pomodoro");
  const [minutes, setMinutes] = useState(25);
  const [now, setNow] = useState<number | null>(null);
  const [records, setRecords] = useState<FocusRecord[]>([]);
  const [outcome, setOutcome] = useState<"completed" | "progressed" | "blocked" | "maintenance">("progressed");
  const [note, setNote] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [completeTask, setCompleteTask] = useState(false);
  const [correctedSeconds, setCorrectedSeconds] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { void apiRequest<{ items: FocusRecord[] }>("/api/v1/focus-sessions?limit=20").then((page) => setRecords(page.items)).catch(() => undefined); }, [active?.session.revision]);

  const seconds = active ? focusDisplaySeconds(active.session, now ?? Date.parse(active.serverNow)) : minutes * 60;
  const task = active
    ? tasks.find((entry) => entry.id === active.session.taskId) ?? null
    : tasks.find((entry) => entry.id === taskId) ?? null;

  async function adjust(record: FocusRecord) {
    const next = Number(window.prompt("修正后的有效秒数", String(record.session.effectiveSeconds ?? record.session.baseActiveSeconds)));
    if (!Number.isInteger(next) || next < 0) return;
    await perform(() => apiMutation(`/api/v1/focus-sessions/${record.session.id}/effective-time`, "PATCH", { effectiveSeconds: next, reason: "用户在专注记录中修正", expectedRevision: record.session.revision }), "有效时长已修正");
    const page = await apiRequest<{ items: FocusRecord[] }>("/api/v1/focus-sessions?limit=20");
    setRecords(page.items);
  }

  async function retarget(record: FocusRecord, nextTaskId: string) {
    await perform(() => apiMutation(`/api/v1/focus-sessions/${record.session.id}/task`, "PATCH", {
      taskId: nextTaskId || null,
      expectedRevision: record.session.revision,
    }), nextTaskId ? "专注记录已重新关联" : "专注记录已设为未关联");
    const page = await apiRequest<{ items: FocusRecord[] }>("/api/v1/focus-sessions?limit=20");
    setRecords(page.items);
  }

  async function deleteRecord(record: FocusRecord) {
    if (!window.confirm("删除这条专注记录及其结束反馈？")) return;
    await perform(async () => {
      await apiMutation(`/api/v1/focus-sessions/${record.session.id}?expectedRevision=${record.session.revision}`, "DELETE");
      return true;
    }, "专注记录已删除");
    const page = await apiRequest<{ items: FocusRecord[] }>("/api/v1/focus-sessions?limit=20");
    setRecords(page.items);
  }

  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const todayRecords = records.filter((record) => new Intl.DateTimeFormat("en-CA").format(new Date(record.session.startedAt)) === today);
  const todaySeconds = todayRecords.reduce((total, record) => total + (record.session.effectiveSeconds ?? record.session.baseActiveSeconds), 0);
  const todayPomodoros = todayRecords.filter((record) => record.session.mode === "pomodoro" && record.session.state === "completed").length;

  return <div className="connected-focus-page">
    <header className="connected-page-header"><div><span>只管踏实做</span><h1>专注</h1><p>计时只记录投入；结束时的一句反馈，会成为轨迹最可靠的证据。</p></div></header>
    <section className="connected-focus-stage">
      {!active && <div className="connected-focus-setup"><select value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">暂不关联任务</option>{tasks.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select><div className="connected-mode-switch"><button className={mode === "pomodoro" ? "active" : ""} onClick={() => setMode("pomodoro")}>倒计时</button><button className={mode === "stopwatch" ? "active" : ""} onClick={() => setMode("stopwatch")}>正计时</button></div>{mode === "pomodoro" && <label>分钟<input type="number" min="1" max="720" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /><span className="connected-duration-presets">{[15, 25, 50, 90].map((value) => <button type="button" className={minutes === value ? "active" : ""} key={value} onClick={() => setMinutes(value)}>{value}</button>)}</span></label>}</div>}
      <div className={`connected-timer ${active?.session.state ?? "idle"}`}><small>{active ? stateLabel(active.session.state) : "准备开始"}</small><b>{formatDuration(seconds)}</b><span>{task?.title ?? "先选择一个任务"}</span></div>
      <div className="connected-focus-actions">
        {!active && <button className="connected-primary" onClick={() => onStart(taskId || null, mode, mode === "pomodoro" ? minutes * 60 : null)}>开始专注</button>}
        {active?.session.state === "running" && <><button onClick={() => onCommand("cancel")}>取消</button><button onClick={() => onCommand("pause")}>暂停</button><button className="connected-primary" onClick={() => onCommand("finish")}>结束并记录</button></>}
        {active?.session.state === "paused" && <><button onClick={() => onCommand("cancel")}>取消</button><button className="connected-primary" onClick={() => onCommand("resume")}>继续</button></>}
      </div>
      {active?.session.state === "awaiting_feedback" && <section className="connected-feedback"><h2>这段时间，发生了什么？</h2>{active.session.mode === "pomodoro" && <button className="connected-overtime" onClick={() => onCommand("resume")}>继续额外计时</button>}<div>{(["completed", "progressed", "blocked", "maintenance"] as const).map((value) => <button key={value} className={outcome === value ? "active" : ""} onClick={() => { setOutcome(value); if (value !== "completed") setCompleteTask(false); }}>{outcomeLabel(value)}</button>)}</div><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="留下一句进展，或说明阻塞" /><input value={nextStep} onChange={(event) => setNextStep(event.target.value)} placeholder="下一步（可选）" /><label className="connected-effective-time">有效秒数<input type="number" min="0" max="86400" value={correctedSeconds} placeholder={String(active.session.effectiveSeconds ?? active.session.baseActiveSeconds)} onChange={(event) => setCorrectedSeconds(event.target.value)} /></label>{outcome === "completed" && active.session.taskId && <label className="connected-complete-task"><input type="checkbox" checked={completeTask} onChange={(event) => setCompleteTask(event.target.checked)} />同时完成关联任务</label>}<div className="connected-feedback-submit"><button onClick={() => onFeedback({ outcome: null, note: "", nextStep: "", completeTask: false })}>跳过反馈</button><button className="connected-primary" onClick={() => onFeedback({ outcome, note, nextStep, completeTask, effectiveSeconds: correctedSeconds ? Number(correctedSeconds) : undefined })}>记入轨迹</button></div></section>}
    </section>
    <section className="connected-today-summary"><Fact label="今日专注" value={formatDuration(todaySeconds)} detail={`${todayRecords.length} 次记录`} /><Fact label="今日番茄" value={String(todayPomodoros)} detail="已完成番茄" /></section>
    <section className="connected-records"><div className="connected-group-title"><h2>专注记录</h2><span>{records.length}</span></div>{records.map((record) => <article key={record.session.id}><div><b>{tasks.find((entry) => entry.id === record.session.taskId)?.title ?? "未关联专注"}</b><small>{formatDateTime(record.session.startedAt)} · {formatDuration(record.session.effectiveSeconds ?? record.session.baseActiveSeconds)}</small></div><span>{record.progress ? outcomeLabel(record.progress.outcome) : stateLabel(record.session.state)}</span><select aria-label="重新关联任务" value={record.session.taskId ?? ""} onChange={(event) => retarget(record, event.target.value)}><option value="">未关联</option>{tasks.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>{record.session.state === "completed" && <button onClick={() => adjust(record)}>修正时长</button>}{["completed", "canceled"].includes(record.session.state) && <button onClick={() => deleteRecord(record)}>删除</button>}</article>)}</section>
  </div>;
}

function TrajectoryWorkspace({ agentEnabled, onToggleAgent, perform }: {
  agentEnabled: boolean;
  onToggleAgent(): Promise<void>;
  perform<T>(work: () => Promise<T>, success?: string): Promise<T | null>;
}) {
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WeekDetail | null>(null);
  const [run, setRun] = useState<AgentRunDto | null>(null);
  const [evidenceClaimId, setEvidenceClaimId] = useState<string | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    const next = await apiRequest<WeekDetail>(`/api/v1/trajectory/weeks/${id}`);
    setDetail(next);
  }, []);
  useEffect(() => {
    void apiRequest<{ items: WeekSummary[] }>("/api/v1/trajectory/weeks?limit=20").then((page) => {
      setWeeks(page.items);
      setPeriodId((current) => current ?? page.items[0]?.period.id ?? null);
    });
  }, []);
  useEffect(() => {
    if (!periodId) return;
    void apiRequest<WeekDetail>(`/api/v1/trajectory/weeks/${periodId}`).then(setDetail);
  }, [periodId]);

  async function generate(forceLowData = false) {
    if (!periodId || !agentEnabled) return;
    const requested = await perform(() => apiMutation<AgentRunDto>(`/api/v1/trajectory/weeks/${periodId}/generate`, "POST", { forceLowData }));
    if (!requested) return;
    setRun(requested);
    if (requested.status === "waiting_for_data" || requested.status === "succeeded") {
      if (requested.status === "succeeded") await loadDetail(periodId);
      return;
    }
    watchAgentRun(requested.id, (next) => setRun(next), async (next) => {
      setRun(next);
      await loadDetail(periodId);
    });
  }

  async function decide(claim: WeeklyReviewViewDto["claims"][number], action: "accept" | "edit" | "reject") {
    let body: Record<string, unknown> = {};
    if (action === "accept") body = { remember: window.confirm("要把这条理解记住，用于未来复盘吗？") };
    if (action === "edit") {
      const userRevision = window.prompt("把更准确的理解写下来", claim.userRevision ?? claim.statement)?.trim();
      if (!userRevision) return;
      body = { userRevision, remember: window.confirm("要把这次修正记住吗？") };
    }
    const updated = await perform(() => apiMutation<WeeklyReviewViewDto>(`/api/v1/review-claims/${claim.id}/${action}`, "POST", body));
    if (updated && detail) setDetail({ ...detail, review: updated });
  }

  async function confirmReview() {
    if (!detail?.review?.review) return;
    const updated = await perform(() => apiMutation<WeeklyReviewViewDto>(`/api/v1/reviews/${detail.review!.review!.id}/confirm`, "POST", {}), "这份周轨迹已经确认，新的理解会进入下一周");
    if (updated) setDetail({ ...detail, review: updated });
  }

  async function excludeEvidence(evidence: WeeklyReviewViewDto["claims"][number]["evidence"][number]) {
    const reason = window.prompt("为什么这条记录不应支持当前判断？", "关联到错误方向")?.trim();
    if (!reason) return;
    const remember = window.confirm("以后遇到同一条记录或贡献映射时，也排除这类关联吗？");
    const updated = await perform(() => apiMutation<WeeklyReviewViewDto>(
      `/api/v1/review-evidence/${evidence.id}/exclude`,
      "POST",
      { reason, remember },
    ), remember ? "错误关联已移除，并写入可管理的排除记忆" : "错误关联已从本次判断中移除");
    if (updated && detail) setDetail({ ...detail, review: updated });
  }

  async function commitmentAction(commitment: WeeklyReviewViewDto["commitments"][number], action: "confirm" | "pause" | "drop" | "edit") {
    const updated = action === "edit"
      ? await (() => {
          const title = window.prompt("改写下周重点", commitment.title)?.trim();
          return title ? perform(() => apiMutation<typeof commitment>(`/api/v1/commitments/${commitment.id}`, "PATCH", { title, expectedRevision: commitment.revision })) : Promise.resolve(null);
        })()
      : await perform(() => apiMutation<typeof commitment>(`/api/v1/commitments/${commitment.id}/${action}`, "POST", { expectedRevision: commitment.revision }));
    if (updated && detail?.review) setDetail({ ...detail, review: { ...detail.review, commitments: detail.review.commitments.map((entry) => entry.id === updated.id ? updated : entry) } });
  }

  async function addCommitment() {
    if (!detail?.review?.review) return;
    const title = window.prompt("写下一个自己的下周重点")?.trim();
    if (!title) return;
    const created = await perform(() => apiMutation<WeeklyReviewViewDto["commitments"][number]>(`/api/v1/reviews/${detail.review!.review!.id}/commitments`, "POST", { title }));
    if (created) setDetail({ ...detail, review: { ...detail.review, commitments: [...detail.review.commitments, created] } });
  }

  const snapshot = detail?.snapshots.find((entry) => entry.status === "current" || entry.status === "stale") ?? detail?.snapshots[0] ?? null;
  const currentWeekIndex = weeks.findIndex((entry) => entry.period.id === periodId);
  const previousSnapshot = currentWeekIndex >= 0 ? weeks[currentWeekIndex + 1]?.snapshots.find((entry) => entry.status === "current") ?? null : null;
  const selectedClaim = detail?.review?.claims.find((claim) => claim.id === evidenceClaimId) ?? null;
  const unresolved = detail?.review?.claims.some((claim) => claim.status === "pending") ?? false;

  return <div className="connected-trajectory">
    <header className="connected-page-header"><div><span>见时 · 轨迹</span><h1>从真实行动中，看见方向</h1><p>事实由数据库重算；解释来自 Agent；方向和记忆永远由你确认。</p></div><div className="connected-trajectory-controls"><button className={agentEnabled ? "agent-on" : "agent-off"} onClick={onToggleAgent}>{agentEnabled ? "Agent 分析开启" : "Agent 分析关闭"}</button><select value={periodId ?? ""} onChange={(event) => setPeriodId(event.target.value)}>{weeks.map((week) => <option key={week.period.id} value={week.period.id}>{week.period.localStartDate} — {week.period.localEndDate}</option>)}</select></div></header>
    {!agentEnabled && <section className="connected-agent-disabled"><div><b>Agent 分析已关闭</b><p>你仍可正常组织任务、专注计时、查看事实与历史复盘；系统不会自动或手动生成新的解释。</p></div><button onClick={onToggleAgent}>重新开启</button></section>}
    {!snapshot && <section className="connected-generate"><span>这一周还没有事实快照</span><h2>先把行动整理成一面事实镜子</h2><p>数据足够时，Agent 会在后台生成解释；数据不足时不会为了凑结论而猜测。</p><button className="connected-primary" disabled={!agentEnabled} onClick={() => generate(false)}>生成本周轨迹</button></section>}
    {snapshot && <>
      {snapshot.status === "stale" && <section className="connected-stale"><div><b>这份轨迹所依据的历史记录已经变化</b><p>旧版本和证据仍保留；重新生成会创建新快照与复盘版本，不会覆盖历史。</p></div><button disabled={!agentEnabled} onClick={() => generate(false)}>重新生成</button></section>}
      <section className="connected-facts"><Fact label="真实投入" value={formatDuration(snapshot.metrics.focus.totalSeconds)} detail={`${snapshot.metrics.focus.sessionCount} 次有效会话`} /><Fact label="完成 / 推进" value={`${snapshot.metrics.progress.completed} / ${snapshot.metrics.progress.progressed}`} detail={`${snapshot.metrics.progress.blocked} 次阻塞`} /><Fact label="未关联专注" value={`${Math.round(snapshot.metrics.dataQuality.unlinkedFocusRatio * 100)}%`} detail={snapshot.metrics.dataQuality.hasEnoughData ? "数据足够解释" : "数据仍偏少"} /><div className="connected-distribution"><span>清单投入</span>{snapshot.metrics.focus.byList.map((entry) => <p key={entry.listId}><b>{entry.listName}</b><i><em style={{ width: `${Math.max(6, entry.seconds / Math.max(snapshot.metrics.focus.totalSeconds, 1) * 100)}%` }} /></i><small>{formatDuration(entry.seconds)}</small></p>)}</div></section>
      {previousSnapshot && <p className="connected-period-change">较上一周：专注 {signedDuration(snapshot.metrics.focus.totalSeconds - previousSnapshot.metrics.focus.totalSeconds)}，推进记录 {signedNumber(snapshot.metrics.progress.progressed - previousSnapshot.metrics.progress.progressed)}。</p>}
      {!detail?.review && <section className="connected-generate compact"><h2>{agentEnabled ? (run ? runStatusLabel(run.status) : "事实已经准备好，等待 Agent 解释") : "事实仍在，Agent 暂时保持安静"}</h2>{run?.status === "waiting_for_data" ? <><p>目前还没有达到最低证据阈值。你可以继续记录，或明确要求在限制说明下生成。</p><button disabled={!agentEnabled} onClick={() => generate(true)}>仍然生成低数据复盘</button></> : <button className="connected-primary" disabled={!agentEnabled || (run ? !["failed", "waiting_for_data"].includes(run.status) : false)} onClick={() => generate(false)}>{run?.status === "failed" ? "重试生成" : "生成 Agent 解释"}</button>}</section>}
      {detail?.review && <>
        {detail.review.review?.limitations.length ? <section className="connected-limitations"><b>这份解释的边界</b>{detail.review.review.limitations.map((entry) => <p key={entry}>{entry}</p>)}</section> : null}
        <section className="connected-claims"><div className="connected-section-heading"><div><span>Agent 的解释</span><h2>{detail.review.claims.length} 个有证据的判断</h2></div><small>推断不是事实，可逐条接受、改写或否定</small></div>{detail.review.claims.map((claim, index) => <article key={claim.id} className={`connected-claim ${claim.status}`}><span className="connected-claim-index">0{index + 1}</span><div><p><em>{claim.claimType}</em><small>{confidenceLabel(claim.confidence)}</small></p><h3>{claim.userRevision ?? claim.statement}</h3><p>{claim.rationale}</p><button className="connected-evidence-link" onClick={() => setEvidenceClaimId(claim.id)}>查看 {claim.evidence.length} 条证据 →</button></div><div className="connected-claim-actions"><button className={claim.status === "accepted" ? "active" : ""} onClick={() => decide(claim, "accept")}>准确</button><button className={claim.status === "edited" ? "active" : ""} onClick={() => decide(claim, "edit")}>改写</button><button className={claim.status === "rejected" ? "active" : ""} onClick={() => decide(claim, "reject")}>否定</button></div></article>)}</section>
        <section className="connected-commitments"><div className="connected-section-heading"><div><span>下一周选择</span><h2>只留下真正重要的 1–3 件事</h2></div><button onClick={addCommitment}>＋ 自己添加</button></div>{detail.review.commitments.map((entry) => <article key={entry.id}><div><span>{entry.status}</span><h3>{entry.title}</h3><p>{entry.reason}</p></div><div><button onClick={() => commitmentAction(entry, "edit")}>改写</button>{entry.status === "proposed" && <button onClick={() => commitmentAction(entry, "confirm")}>保留</button>}{entry.status === "confirmed" && <button onClick={() => commitmentAction(entry, "pause")}>暂停</button>}{entry.status === "dropped" ? null : <button onClick={() => commitmentAction(entry, "drop")}>删除</button>}</div></article>)}</section>
        {detail.review.review?.status !== "confirmed" && <button className="connected-primary connected-confirm-review" disabled={unresolved} onClick={confirmReview}>{unresolved ? "请先处理全部判断" : "确认这份周轨迹"}</button>}
      </>}
    </>}
    {selectedClaim && <div className="connected-drawer-backdrop" onClick={() => setEvidenceClaimId(null)}><aside className="connected-evidence-drawer" onClick={(event) => event.stopPropagation()}><button onClick={() => setEvidenceClaimId(null)}>×</button><span>证据抽屉</span><h2>{selectedClaim.userRevision ?? selectedClaim.statement}</h2><p>{selectedClaim.rationale}</p>{selectedClaim.evidence.map((evidence) => <article key={evidence.id} className={evidence.excludedAt ? "excluded" : ""}><b>{evidenceTypeLabel(evidence.entityType)}</b><span>{evidence.excludedAt ? "已排除" : evidence.role}</span><code>{evidence.entityId}</code>{evidence.excerpt && <p>{evidence.excerpt}</p>}{evidence.exclusionReason && <p>排除原因：{evidence.exclusionReason}</p>}{!evidence.excludedAt && <button onClick={() => excludeEvidence(evidence)}>移除错误关联</button>}</article>)}</aside></div>}
  </div>;
}

function MemoryWorkspace({ perform }: { perform<T>(work: () => Promise<T>, success?: string): Promise<T | null> }) {
  const [status, setStatus] = useState<"active" | "all">("active");
  const [memories, setMemories] = useState<ProductMemory[]>([]);
  const [directions, setDirections] = useState<ProductDirection[]>([]);
  const load = useCallback(async () => {
    const [memoryPage, directionPage] = await Promise.all([
      apiRequest<{ items: ProductMemory[] }>(`/api/v1/memories?status=${status}`),
      apiRequest<{ items: ProductDirection[] }>(`/api/v1/directions?state=${status}`),
    ]);
    setMemories(memoryPage.items);
    setDirections(directionPage.items);
  }, [status]);
  useEffect(() => {
    void Promise.all([
      apiRequest<{ items: ProductMemory[] }>(`/api/v1/memories?status=${status}`),
      apiRequest<{ items: ProductDirection[] }>(`/api/v1/directions?state=${status}`),
    ]).then(([memoryPage, directionPage]) => {
      setMemories(memoryPage.items);
      setDirections(directionPage.items);
    });
  }, [status]);

  async function edit(memory: ProductMemory) {
    const raw = window.prompt("编辑结构化记忆（JSON）", JSON.stringify(memory.value, null, 2));
    if (!raw) return;
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      await perform(() => apiMutation(`/api/v1/memories/${memory.id}`, "PATCH", { value, expectedRevision: memory.revision }), "已生成新的记忆版本，旧版本保留在历史中");
      await load();
    } catch {
      window.alert("请输入有效 JSON");
    }
  }

  async function deactivate(memory: ProductMemory) {
    await perform(() => apiMutation(`/api/v1/memories/${memory.id}/deactivate`, "POST", { expectedRevision: memory.revision }), "后续轨迹不再使用这条记忆");
    await load();
  }

  async function remove(memory: ProductMemory) {
    if (!window.confirm("删除后，后续 Agent 将不再读取这条记忆。历史版本仍保留审计状态。")) return;
    await perform(() => apiMutation(`/api/v1/memories/${memory.id}?expectedRevision=${memory.revision}`, "DELETE"), "记忆已删除");
    await load();
  }

  async function updateDirection(direction: ProductDirection, action: "rename" | "toggle" | "end") {
    let patch: Record<string, unknown>;
    if (action === "rename") {
      const name = window.prompt("更准确的方向名称", direction.name)?.trim();
      if (!name) return;
      const description = window.prompt("方向说明", direction.description)?.trim() ?? direction.description;
      patch = { name, description };
    } else if (action === "toggle") {
      patch = { state: direction.state === "active" ? "paused" : "active" };
    } else {
      if (!window.confirm(`结束方向「${direction.name}」？历史贡献仍会保留。`)) return;
      patch = { state: "ended" };
    }
    await perform(() => apiMutation(`/api/v1/directions/${direction.id}`, "PATCH", {
      ...patch,
      expectedRevision: direction.revision,
    }), "方向状态已写入长期记忆");
    await load();
  }

  return <div className="connected-memory"><header className="connected-page-header"><div><span>由你确认的认识</span><h1>长期记忆</h1><p>这不是聊天记录，而是可查看、可修正、可停用的产品记忆。</p></div><div className="connected-segment"><button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>有效</button><button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>全部版本</button></div></header>{directions.length > 0 && <section className="connected-directions"><div className="connected-section-heading"><div><span>已确认方向</span><h2>方向有生命周期，不是永久标签</h2></div></div><div>{directions.map((direction) => <article key={direction.id} className={direction.state}><div><span>{directionStateLabel(direction.state)}</span><h3>{direction.name}</h3><p>{direction.description}</p></div>{!["ended", "replaced"].includes(direction.state) && <footer><button onClick={() => updateDirection(direction, "rename")}>修正</button><button onClick={() => updateDirection(direction, "toggle")}>{direction.state === "active" ? "暂停" : "恢复"}</button><button onClick={() => updateDirection(direction, "end")}>结束</button></footer>}</article>)}</div></section>}<div className="connected-memory-grid">{memories.map((memory) => <article key={memory.id} className={memory.status}><div><span>{memoryTypeLabel(memory.memoryType)}</span><small>v{memory.revision} · {memory.status}</small></div><pre>{JSON.stringify(memory.value, null, 2)}</pre><p>生效于 {formatDateTime(memory.effectiveFrom)}</p>{memory.status === "active" && <footer><button onClick={() => edit(memory)}>编辑新版本</button><button onClick={() => deactivate(memory)}>停用</button><button onClick={() => remove(memory)}>删除</button></footer>}</article>)}</div>{memories.length === 0 && directions.length === 0 && <EmptyState title="还没有长期记忆" detail="确认第一份周轨迹后，你认可的方向与规则会出现在这里。" />}</div>;
}

function AuthPanel({ onAuthenticated }: { onAuthenticated(): Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/auth/${mode === "signin" ? "sign-in" : "sign-up"}/email`, {
        method: "POST",
        body: JSON.stringify(mode === "signin" ? { email, password } : { name, email, password }),
      });
      await onAuthenticated();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="connected-auth"><section><div className="connected-auth-brand"><span>见</span><div><b>见时</b><small>Time Friend</small></div></div><p className="connected-auth-kicker">你只管踏实做</p><h1>方向，会从真实行动里慢慢浮现。</h1><p>像清单工具一样快速记录任务，用番茄和正计时留下真实投入；每周由 Agent 提出有证据的理解，再由你确认。</p><div className="connected-auth-principles"><span>01 · 行动优先</span><span>02 · 证据可追溯</span><span>03 · 记忆由你确认</span></div></section><form onSubmit={submit}><div className="connected-segment"><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>登录</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>创建账户</button></div><h2>{mode === "signin" ? "欢迎回来" : "开始第一周"}</h2>{mode === "signup" && <label>你的名字<input value={name} onChange={(event) => setName(event.target.value)} required /></label>}<label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="connected-auth-error">{error}</p>}<button className="connected-primary" disabled={busy}>{busy ? "请稍候…" : mode === "signin" ? "进入见时" : "创建并进入"}</button><small>你的任务正文、专注记录和 Agent 输出只存于自己的产品数据中。</small></form></main>;
}

function NavButton({ active, label, meta, onClick }: { active: boolean; label: string; meta: string; onClick(): void }) { return <button className={active ? "active" : ""} onClick={onClick}><i />{label}{meta && <small>{meta}</small>}</button>; }
function ListButton({ list, selected, count, onClick }: { list: TaskListDto; selected: boolean; count: number; onClick(): void }) { return <button className={`connected-list-button ${selected ? "active" : ""}`} onClick={onClick}><i className={list.learningPolicy === "exclude" ? "excluded" : ""} />{list.name}<small>{count || ""}</small></button>; }
function OrganizationActions({ compact = false, onRename, onArchive, onUp, onDown }: { compact?: boolean; onRename(): void; onArchive?: () => void; onUp(): void; onDown(): void }) { return <span className={`connected-organization-actions ${compact ? "compact" : ""}`}><button onClick={onUp} title="上移">↑</button><button onClick={onDown} title="下移">↓</button><button onClick={onRename} title="重命名">改</button>{onArchive && <button onClick={onArchive} title="归档">藏</button>}</span>; }
function Fact({ label, value, detail }: { label: string; value: string; detail: string }) { return <article><span>{label}</span><b>{value}</b><small>{detail}</small></article>; }
function EmptyState({ title, detail }: { title: string; detail: string }) { return <section className="connected-empty"><span>○</span><h2>{title}</h2><p>{detail}</p></section>; }
function CenteredState({ title, detail, action }: { title: string; detail: string; action?: () => void }) { return <main className="connected-centered"><span>见</span><h1>{title}</h1><p>{detail}</p>{action && <button onClick={action}>重试</button>}</main>; }

function groupsWithUngrouped(groups: TaskGroupDto[]): Array<{ id: string | null; name: string }> { return [{ id: null, name: "未分组" }, ...groups.map((group) => ({ id: group.id, name: group.name }))]; }
function countPending(items: ItemDto[], listId: string): number { return items.filter((item) => item.listId === listId && item.kind === "task" && item.status === "pending").length; }
function initials(name: string): string { return name.trim().slice(0, 1).toUpperCase() || "时"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "操作没有完成，请稍后重试"; }
export function formatDuration(seconds: number): string { const safe = Math.max(0, Math.round(seconds)); const hours = Math.floor(safe / 3_600); const minutes = Math.floor((safe % 3_600) / 60); const rest = safe % 60; return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`; }
function signedDuration(seconds: number): string { return `${seconds >= 0 ? "+" : "−"}${formatDuration(Math.abs(seconds))}`; }
function signedNumber(value: number): string { return `${value >= 0 ? "+" : "−"}${Math.abs(value)}`; }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function focusDisplaySeconds(session: FocusSession, now: number): number { if (session.state !== "running") return session.mode === "pomodoro" ? Math.max(0, (session.plannedSeconds ?? 0) - session.baseActiveSeconds) : session.baseActiveSeconds; if (session.mode === "pomodoro" && session.expectedEndAt) return Math.max(0, Math.ceil((Date.parse(session.expectedEndAt) - now) / 1_000)); return session.baseActiveSeconds + Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1_000)); }
function stateLabel(value: FocusSession["state"]): string { return ({ running: "进行中", paused: "已暂停", awaiting_feedback: "等待反馈", completed: "已完成", canceled: "已取消", needs_attention: "需要确认" })[value]; }
function outcomeLabel(value: string): string { return ({ completed: "完成了", progressed: "有推进", blocked: "被阻塞", maintenance: "维持事务", note: "记录" } as Record<string, string>)[value] ?? value; }
function eventLabel(value: string): string { return ({ created: "创建任务", title_changed: "修改标题", content_changed: "更新笔记", moved: "移动任务", completed: "完成任务", reopened: "重新打开", abandoned: "放弃任务", resumed: "恢复任务", focus_started: "开始专注", focus_paused: "暂停专注", focus_finished: "结束专注", progress_created: "记录进展", progress_updated: "修正进展" } as Record<string, string>)[value] ?? value; }
function confidenceLabel(value: string): string { return value === "high" ? "高把握" : value === "medium" ? "中等把握" : "低把握"; }
function evidenceTypeLabel(value: string): string { return ({ task: "任务", focus_session: "专注记录", progress_entry: "进展", task_event: "任务动态", memory: "确认记忆" } as Record<string, string>)[value] ?? value; }
function memoryTypeLabel(value: string): string { return ({ direction: "已确认方向", mapping: "贡献映射", classification: "分类规则", preference: "用户偏好", exclusion: "排除规则", direction_state: "方向状态" } as Record<string, string>)[value] ?? value; }
function directionStateLabel(value: ProductDirection["state"]): string { return ({ candidate: "候选", active: "活跃", paused: "暂停", ended: "结束", replaced: "已替代" })[value]; }
function runStatusLabel(value: AgentRunDto["status"]): string { return ({ waiting_for_data: "证据还不够，Agent 保持安静", queued: "已进入生成队列", running: "Agent 正在阅读本周证据", validating: "正在独立校验证据", succeeded: "轨迹已经生成", failed: "生成没有完成" })[value]; }

export function textToContentDocument(value: string): ItemDto["contentDoc"] {
  const content: Array<Record<string, unknown>> = [];
  let taskItems: Array<Record<string, unknown>> = [];
  const flushTasks = () => { if (taskItems.length > 0) { content.push({ type: "taskList", content: taskItems }); taskItems = []; } };
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    const task = line.match(/^- \[([ xX])\]\s*(.+)$/);
    if (task) {
      taskItems.push({ type: "taskItem", attrs: { checked: task[1]!.toLowerCase() === "x" }, content: [{ type: "paragraph", content: [{ type: "text", text: task[2]! }] }] });
      continue;
    }
    flushTasks();
    if (line) content.push({ type: "paragraph", content: [{ type: "text", text: line }] });
  }
  flushTasks();
  return { type: "doc", schemaVersion: 1, content };
}

export function contentDocumentToText(document: ItemDto["contentDoc"]): string {
  const lines: string[] = [];
  const text = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const value = node as { text?: string; content?: unknown[] };
    return value.text ?? (value.content ?? []).map(text).join("");
  };
  for (const raw of document.content) {
    const node = raw as { type?: string; content?: Array<{ attrs?: { checked?: boolean }; content?: unknown[] }> };
    if (node.type === "taskList") for (const item of node.content ?? []) lines.push(`- [${item.attrs?.checked ? "x" : " "}] ${text(item)}`);
    else lines.push(text(node));
  }
  return lines.filter(Boolean).join("\n");
}

function watchAgentRun(runId: string, onUpdate: (run: AgentRunDto) => void, onTerminal: (run: AgentRunDto) => void): void {
  const source = new EventSource(agentRunEventsUrl(runId), { withCredentials: true });
  let completed = false;
  source.addEventListener("status", (event) => {
    const run = JSON.parse((event as MessageEvent).data) as AgentRunDto;
    onUpdate(run);
    if (["waiting_for_data", "succeeded", "failed"].includes(run.status)) {
      completed = true;
      source.close();
      void onTerminal(run);
    }
  });
  source.onerror = () => {
    source.close();
    if (!completed) void pollAgentRun(runId, onUpdate, onTerminal);
  };
}

async function pollAgentRun(runId: string, onUpdate: (run: AgentRunDto) => void, onTerminal: (run: AgentRunDto) => void): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const run = await apiRequest<AgentRunDto>(`/api/v1/agent-runs/${runId}`);
    onUpdate(run);
    if (["waiting_for_data", "succeeded", "failed"].includes(run.status)) return onTerminal(run);
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
}
