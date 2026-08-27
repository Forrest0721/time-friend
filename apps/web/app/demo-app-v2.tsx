"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bell, CalendarDays, CalendarRange, CheckSquare, ChevronDown, ChevronRight,
  CircleHelp, Clock3, FileText, Flag, Folder, Inbox, ListChecks, ListTodo,
  Moon, MoreHorizontal, Play, Plus, RefreshCw, Search, Settings, Sparkles,
  Sun, Tag, Timer, X,
} from "lucide-react";

type View = "tasks" | "focus" | "trajectory";
type Theme = "dark" | "light";
type Collection = "today" | "next7" | "inbox" | "progress" | `list:${string}`;
type Step = { id: number; text: string; done: boolean };
type Activity = { id: number; label: string; time: string; tone?: "progress" | "blocked" | "system" };
type TaskGroup = { id: string; list: string; name: string };
type Task = {
  id: number; title: string; list: string; meta: string; minutes: number; actual: number; done: boolean;
  kind: "task" | "note"; due: string; priority: 0 | 1 | 2 | 3; tags: string[]; note: string;
  parentId?: number | null; groupId?: string | null; steps: Step[]; activities: Activity[];
};

const initialTasks: Task[] = [
  { id: 1, title: "梳理 V1 核心流程", list: "产品探索", meta: "预计 90 分钟", minutes: 90, actual: 84, done: false, kind: "task", due: "2026-08-27", priority: 3, tags: ["V1", "产品"], note: "今天的推进重点", steps: [{ id: 11, text: "完成最小闭环", done: true }, { id: 12, text: "留下一条真实进展", done: false }], activities: [{ id: 111, label: "专注 84 分钟 · 有推进", time: "今天 15:34", tone: "progress" }, { id: 112, label: "将任务移至产品探索", time: "昨天 18:20", tone: "system" }] },
  { id: 2, title: "完成访谈提纲", list: "用户研究", meta: "今天 16:00", minutes: 45, actual: 42, done: false, kind: "task", due: "2026-08-27", priority: 2, tags: ["访谈"], note: "围绕用户最近一次真实行为提问，不引导答案。", steps: [{ id: 21, text: "整理暖场问题", done: true }, { id: 22, text: "补充追问清单", done: false }], activities: [{ id: 211, label: "专注 42 分钟 · 有推进", time: "今天 11:07", tone: "progress" }] },
  { id: 3, title: "回复合作消息", list: "工作协作", meta: "3 条消息", minutes: 20, actual: 29, done: false, kind: "task", due: "2026-08-27", priority: 1, tags: ["协作"], note: "集中处理，避免反复切换。", steps: [], activities: [{ id: 311, label: "专注 29 分钟 · 维持事务", time: "今天 09:39", tone: "progress" }] },
  { id: 4, title: "整理本周产品反馈", list: "产品探索", meta: "16:30 · 30 分钟", minutes: 30, actual: 0, done: false, kind: "task", due: "2026-08-28", priority: 0, tags: [], note: "", steps: [], activities: [] },
  { id: 5, title: "阅读《如何做用户访谈》", list: "个人成长", meta: "今晚 · 25 分钟", minutes: 25, actual: 0, done: false, kind: "note", due: "2026-08-28", priority: 0, tags: ["阅读"], note: "把有用的方法直接记在这里；笔记和检查事项共享同一个内容区。", steps: [{ id: 51, text: "摘录 3 个可复用问题", done: false }], activities: [] },
  { id: 6, title: "确认结束会话后的反馈状态", list: "产品探索", meta: "子任务", minutes: 25, actual: 0, done: false, kind: "task", due: "2026-08-28", priority: 0, tags: ["V1"], note: "", parentId: 1, steps: [], activities: [] },
  { id: 7, title: "整理今天记录的产品想法", list: "收集箱", meta: "刚刚", minutes: 25, actual: 0, done: false, kind: "task", due: "", priority: 0, tags: [], note: "", steps: [], activities: [] },
  { id: 8, title: "确认下次用户访谈时间", list: "收集箱", meta: "", minutes: 25, actual: 0, done: false, kind: "task", due: "", priority: 0, tags: [], note: "", steps: [], activities: [] },
  { id: 9, title: "清理产品反馈收集箱", list: "收集箱", meta: "", minutes: 25, actual: 0, done: false, kind: "task", due: "", priority: 0, tags: [], note: "", steps: [], activities: [] },
  { id: 10, title: "预约本周复盘时间", list: "收集箱", meta: "", minutes: 25, actual: 0, done: false, kind: "task", due: "", priority: 0, tags: [], note: "", steps: [], activities: [] },
  { id: 11, title: "确认最小产品闭环", list: "收集箱", meta: "8月26日", minutes: 25, actual: 36, done: true, kind: "task", due: "2026-08-26", priority: 0, tags: ["V1"], note: "", steps: [], activities: [{ id: 1101, label: "专注 36 分钟 · 完成", time: "8月26日", tone: "progress" }] },
];
const initialLists = ["产品探索", "用户研究", "工作协作", "个人成长"];
const initialGroups: TaskGroup[] = [
  { id: "product-main", list: "产品探索", name: "本周重点" },
  { id: "product-later", list: "产品探索", name: "稍后处理" },
  { id: "research-main", list: "用户研究", name: "访谈准备" },
];
const seededTasks = initialTasks.map((task) => task.id === 1 ? { ...task, groupId: "product-main" } : task.id === 4 ? { ...task, groupId: "product-later" } : task.id === 2 ? { ...task, groupId: "research-main" } : task);
const listColors: Record<string, string> = { 产品探索: "amber", 用户研究: "violet", 工作协作: "indigo", 个人成长: "sage", 收集箱: "gray" };

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}
function normalizeTask(task: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return { id: task.id, title: task.title, list: task.list ?? "收集箱", meta: task.meta ?? "刚刚添加", minutes: task.minutes ?? 25, actual: task.actual ?? 0, done: task.done ?? false, kind: task.kind ?? "task", due: task.due ?? "", priority: task.priority ?? 0, tags: task.tags ?? [], note: task.note ?? "", parentId: task.parentId ?? null, groupId: task.groupId ?? null, steps: task.steps ?? [], activities: task.activities ?? [] };
}

export default function DemoAppV2() {
  const [view, setView] = useState<View>("tasks");
  const [theme, setTheme] = useState<Theme>("dark");
  const [tasks, setTasks] = useState<Task[]>(seededTasks);
  const [lists, setLists] = useState(initialLists);
  const [groups, setGroups] = useState<TaskGroup[]>(initialGroups);
  const [folderOpen, setFolderOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeCollection, setActiveCollection] = useState<Collection>("inbox");
  const [newTask, setNewTask] = useState("");
  const [newTaskKind, setNewTaskKind] = useState<"task" | "note">("task");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"content" | "activity">("content");
  const [detailProgress, setDetailProgress] = useState("");
  const [focusTaskId, setFocusTaskId] = useState(1);
  const [focusStage, setFocusStage] = useState(false);
  const [mode, setMode] = useState<"countdown" | "stopwatch">("countdown");
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sessionModal, setSessionModal] = useState(false);
  const [sessionResult, setSessionResult] = useState("progress");
  const [sessionNote, setSessionNote] = useState("");
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, string>>({});
  const [nextFocus, setNextFocus] = useState([1, 2]);

  const focusTask = tasks.find((task) => task.id === focusTaskId) ?? tasks[0];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (task.parentId != null) return false;
    if (activeCollection === "progress") return task.actual > 0 || task.activities.length > 0;
    if (activeCollection === "inbox") return task.list === "收集箱";
    if (activeCollection.startsWith("list:")) return task.list === activeCollection.slice(5);
    return activeCollection === "next7" ? !task.done : true;
  }), [activeCollection, tasks]);

  useEffect(() => {
    const saved = window.localStorage.getItem("time-friend-prototype-tasks-v3");
    const savedTheme = window.localStorage.getItem("jianshi-theme") as Theme | null;
    if (savedTheme === "light" || savedTheme === "dark") queueMicrotask(() => setTheme(savedTheme));
    if (saved) try {
      const parsed = JSON.parse(saved) as Array<Partial<Task> & Pick<Task, "id" | "title">>;
      const normalized = parsed.map(normalizeTask);
      const exampleSubtask = initialTasks.find((task) => task.parentId === 1);
      if (exampleSubtask && !normalized.some((task) => task.parentId != null)) normalized.push(exampleSubtask);
      if (!normalized.some((task) => task.groupId)) {
        for (const task of normalized) {
          if (task.id === 1) task.groupId = "product-main";
          if (task.id === 4) task.groupId = "product-later";
          if (task.id === 2) task.groupId = "research-main";
        }
      }
      queueMicrotask(() => setTasks(normalized));
    } catch { /* keep curated data */ }
  }, []);
  useEffect(() => { window.localStorage.setItem("time-friend-prototype-tasks-v3", JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { window.localStorage.setItem("jianshi-theme", theme); }, [theme]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((current) => {
      if (mode === "countdown" && current <= 1) { setRunning(false); setSessionModal(true); return 0; }
      return mode === "countdown" ? current - 1 : current + 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [running, mode]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2400); return () => window.clearTimeout(timer); }, [toast]);

  function go(next: View) { setView(next); setSettingsOpen(false); if (next !== "focus") { setRunning(false); setFocusStage(false); } }
  function chooseCollection(collection: Collection) { setActiveCollection(collection); setView("tasks"); setSelectedTaskId(null); }
  function updateTask(id: number, patch: Partial<Task>) { setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task)); }
  function addTask(event: FormEvent) {
    event.preventDefault(); if (!newTask.trim()) return;
    const list = activeCollection.startsWith("list:") ? activeCollection.slice(5) : "收集箱";
    const task = normalizeTask({ id: Date.now(), title: newTask.trim(), list, meta: newTaskDue ? "已设置日期" : "刚刚添加", due: newTaskDue, kind: newTaskKind, groupId: groups.find((group) => group.list === list)?.id ?? null });
    setTasks((current) => [task, ...current]); setNewTask(""); setNewTaskDue(""); setComposerOpen(false); setSelectedTaskId(task.id); setToast(newTaskKind === "note" ? "笔记已保存" : "任务已添加");
  }
  function addSubtask(parentId: number, title: string) {
    const parent = tasks.find((task) => task.id === parentId);
    if (!parent || !title.trim()) return;
    const child = normalizeTask({ id: Date.now(), title: title.trim(), list: parent.list, meta: "子任务", parentId, groupId: parent.groupId ?? null });
    setTasks((current) => [...current, child]);
    updateTask(parentId, { activities: [{ id: Date.now() + 1, label: `添加子任务 · ${title.trim()}`, time: "刚刚", tone: "system" }, ...parent.activities] });
  }
  function toggleTask(id: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done, activities: [{ id: Date.now(), label: task.done ? "重新打开任务" : "完成任务", time: "刚刚", tone: "system" }, ...task.activities] } : task));
  }
  function deleteTask(id: number) {
    setTasks((current) => current.filter((task) => task.id !== id && task.parentId !== id));
    if (selectedTaskId === id) setSelectedTaskId(null);
    setToast("任务已删除");
  }
  function recordManualFocus(id: number, minutes: number) {
    const safeMinutes = Math.max(1, Math.min(720, Math.round(minutes)));
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    updateTask(id, { actual: task.actual + safeMinutes, activities: [{ id: Date.now(), label: `手动补记专注 ${safeMinutes} 分钟`, time: "刚刚", tone: "progress" }, ...task.activities] });
    setToast("专注记录已补记");
  }
  function addList() { const name = window.prompt("清单名称"); if (!name?.trim() || lists.includes(name.trim())) return; setLists((current) => [...current, name.trim()]); chooseCollection(`list:${name.trim()}`); setToast("清单已创建"); }
  function addGroup(list: string) { const name = window.prompt("分组名称"); if (!name?.trim()) return; setGroups((current) => [...current, { id: `group-${Date.now()}`, list, name: name.trim() }]); setToast("分组已创建"); }
  function startFocus(id: number) { setFocusTaskId(id); setMode("countdown"); setSeconds(25 * 60); setView("focus"); setFocusStage(true); setRunning(true); }
  function switchMode(next: "countdown" | "stopwatch") { setRunning(false); setMode(next); setSeconds(next === "countdown" ? 25 * 60 : 0); }
  function finishSession() {
    const used = mode === "countdown" ? Math.max(1, Math.round((25 * 60 - seconds) / 60)) : Math.max(1, Math.round(seconds / 60));
    const result = sessionResult === "done" ? "完成" : sessionResult === "blocked" ? "受阻" : sessionResult === "admin" ? "维持事务" : "有推进";
    setTasks((current) => current.map((task) => task.id === focusTaskId ? { ...task, actual: task.actual + used, done: sessionResult === "done" ? true : task.done, activities: [{ id: Date.now(), label: `专注 ${used} 分钟 · ${result}${sessionNote ? ` · ${sessionNote}` : ""}`, time: "刚刚", tone: sessionResult === "blocked" ? "blocked" : "progress" }, ...task.activities] } : task));
    setSessionModal(false); setRunning(false); setFocusStage(false); setSessionNote(""); setToast("本次投入已记入轨迹");
  }
  function addDetailProgress() { if (!selectedTask || !detailProgress.trim()) return; updateTask(selectedTask.id, { activities: [{ id: Date.now(), label: `记录进展 · ${detailProgress.trim()}`, time: "刚刚", tone: "progress" }, ...selectedTask.activities] }); setDetailProgress(""); setDetailTab("activity"); }

  return <main className={`dida-shell dida-v2 theme-${theme} dida-view-${view} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <aside className="dida-app-rail" aria-label="应用导航">
      <button className="dida-avatar" aria-label="账户">时</button>
      <nav><button className={view === "tasks" ? "active" : ""} onClick={() => go("tasks")} aria-label="任务"><CheckSquare /></button><button onClick={() => setToast("第一版先聚焦任务、专注和轨迹")} aria-label="日历"><CalendarDays /></button><button className={view === "focus" ? "active" : ""} onClick={() => { setView("focus"); setFocusStage(false); setRunning(false); }} aria-label="专注"><Timer /></button><button className={view === "trajectory" ? "active" : ""} onClick={() => go("trajectory")} aria-label="轨迹"><Sparkles /></button><button onClick={() => setSearchOpen(true)} aria-label="搜索"><Search /></button></nav>
      <div className="dida-rail-bottom"><button onClick={() => setToast("所有本地记录已保存")} aria-label="同步"><RefreshCw /></button><button onClick={() => setToast("没有新的提醒")} aria-label="通知"><Bell /></button><button className={settingsOpen ? "active" : ""} onClick={() => setSettingsOpen((current) => !current)} aria-label="设置"><Settings /></button><button onClick={() => setToast("提示：选择任务即可在右侧编辑")} aria-label="帮助"><CircleHelp /></button></div>
    </aside>
    {view === "tasks" && !sidebarCollapsed && <TaskSidebar tasks={tasks} lists={lists} activeCollection={activeCollection} folderOpen={folderOpen} onToggleFolder={() => setFolderOpen((current) => !current)} onChoose={chooseCollection} onTrajectory={() => go("trajectory")} onAddList={addList} />}
    <section className="workspace dida-workspace">
      {view === "tasks" && <TaskWorkspace tasks={visibleTasks} allTasks={tasks} groups={groups} activeCollection={activeCollection} newTask={newTask} setNewTask={setNewTask} newTaskKind={newTaskKind} setNewTaskKind={setNewTaskKind} newTaskDue={newTaskDue} setNewTaskDue={setNewTaskDue} composerOpen={composerOpen} setComposerOpen={setComposerOpen} addTask={addTask} addSubtask={addSubtask} addGroup={addGroup} deleteTask={deleteTask} toggleTask={toggleTask} startFocus={startFocus} onTrajectory={() => go("trajectory")} onToggleSidebar={() => setSidebarCollapsed((current) => !current)} selectedTask={selectedTask} selectTask={(id) => { setSelectedTaskId(id); setDetailTab("content"); }} updateTask={updateTask} detailTab={detailTab} setDetailTab={setDetailTab} detailProgress={detailProgress} setDetailProgress={setDetailProgress} addDetailProgress={addDetailProgress} lists={lists} />}
      {view === "focus" && <FocusWorkspace task={focusTask} tasks={tasks} taskId={focusTaskId} setTaskId={setFocusTaskId} focusStage={focusStage} setFocusStage={setFocusStage} mode={mode} switchMode={switchMode} seconds={seconds} running={running} setRunning={setRunning} reset={() => setSeconds(mode === "countdown" ? 25 * 60 : 0)} end={() => { setRunning(false); setSessionModal(true); }} onManualRecord={recordManualFocus} />}
      {view === "trajectory" && <TrajectoryWorkspace decisions={reviewDecisions} setDecision={(id, value) => setReviewDecisions((current) => ({ ...current, [id]: value }))} nextFocus={nextFocus} toggleNext={(id) => setNextFocus((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} done={() => { setToast("周复盘已完成，下周重点已回到今天"); go("tasks"); }} />}
    </section>
    {settingsOpen && <div className="dida-settings-popover"><span>外观</span><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon />深色</button><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun />浅色</button></div>}
    {searchOpen && <SearchDialog tasks={tasks} query={searchText} setQuery={setSearchText} onClose={() => { setSearchOpen(false); setSearchText(""); }} onSelect={(id) => { setView("tasks"); setSelectedTaskId(id); setSearchOpen(false); setSearchText(""); }} />}
    {sessionModal && <div className="modal-backdrop" role="presentation"><section className="session-modal dida-session-modal" role="dialog" aria-modal="true" aria-labelledby="session-title"><button className="modal-close" onClick={() => setSessionModal(false)} aria-label="关闭"><X /></button><span className="eyebrow">结束专注</span><h2 id="session-title">这段时间，发生了什么？</h2><p className="modal-task">{focusTask.title}</p><div className="result-grid">{[["done", "✓", "完成了"], ["progress", "↗", "有推进"], ["blocked", "!", "被阻塞"], ["admin", "·", "维持事务"]].map(([id, icon, label]) => <button key={id} className={sessionResult === id ? "selected" : ""} onClick={() => setSessionResult(id)}><span>{icon}</span>{label}</button>)}</div><label className="note-label">进展说明 <em>可选</em><textarea value={sessionNote} onChange={(event) => setSessionNote(event.target.value)} placeholder="例如：核心流程已确定，还缺结束后的反馈状态" /></label><button className="primary-action full" onClick={finishSession}>保存专注记录</button><p className="privacy-note">任务、投入时间和结果会成为轨迹的可验证证据。</p></section></div>}
    {toast && <div className="toast"><span>✓</span>{toast}</div>}
  </main>;
}

type TaskSidebarProps = { tasks: Task[]; lists: string[]; activeCollection: Collection; folderOpen: boolean; onToggleFolder: () => void; onChoose: (collection: Collection) => void; onTrajectory: () => void; onAddList: () => void };
function TaskSidebar({ tasks, lists, activeCollection, folderOpen, onToggleFolder, onChoose, onTrajectory, onAddList }: TaskSidebarProps) {
  const rootTasks = tasks.filter((task) => task.parentId == null);
  return <aside className="dida-list-sidebar">
    <div className="dida-shortcuts">
      <button onClick={onTrajectory}><span className="coral"><Sparkles /></span><small>轨迹</small></button>
      <button onClick={() => onChoose("today")}><span className="gold"><Sun /></span><small>今日</small></button>
      <button onClick={() => onChoose("next7")}><span className="violet"><ListTodo /></span><small>待做</small></button>
      <button onClick={() => onChoose("progress")}><span className="mint"><Clock3 /></span><small>进展</small></button>
      <button onClick={onTrajectory}><span className="blue"><FileText /></span><small>复盘</small></button>
      <button onClick={onTrajectory}><span className="indigo"><Sparkles /></span><small>记忆</small></button>
    </div>
    <nav className="dida-smart-lists" aria-label="智能清单">
      <button className={activeCollection === "today" ? "active" : ""} onClick={() => onChoose("today")}><Sun /><span>今天</span><small>{rootTasks.filter((task) => !task.done).length}</small></button>
      <button className={activeCollection === "next7" ? "active" : ""} onClick={() => onChoose("next7")}><CalendarRange /><span>最近 7 天</span><small>{rootTasks.filter((task) => !task.done).length}</small></button>
      <button className={activeCollection === "inbox" ? "active" : ""} onClick={() => onChoose("inbox")}><Inbox /><span>收集箱</span><small>{rootTasks.filter((task) => task.list === "收集箱" && !task.done).length}</small></button>
      <button className={activeCollection === "progress" ? "active" : ""} onClick={() => onChoose("progress")}><Clock3 /><span>进展</span><small>{rootTasks.filter((task) => task.activities.length > 0).length}</small></button>
    </nav>
    <div className="dida-sidebar-section">
      <div><span>清单</span><button aria-label="添加清单" onClick={onAddList}><Plus /></button></div>
      <button className="dida-folder" onClick={onToggleFolder}>{folderOpen ? <ChevronDown /> : <ChevronRight />}<Folder /><span>工作</span><small>{rootTasks.filter((task) => !task.done).length}</small></button>
      {folderOpen && lists.map((label) => <button className={`dida-list-entry ${activeCollection === `list:${label}` ? "active" : ""}`} key={label} onClick={() => onChoose(`list:${label}`)}><span className={`list-dot ${listColors[label] ?? "gray"}`} />{label}<small>{rootTasks.filter((task) => task.list === label && !task.done).length || ""}</small></button>)}
    </div>
    <button className="dida-new-list" onClick={onAddList}><Plus /> 新建清单</button>
  </aside>;
}

function collectionTitle(collection: Collection) {
  if (collection === "next7") return "最近 7 天";
  if (collection === "inbox") return "收集箱";
  if (collection === "progress") return "进展";
  if (collection.startsWith("list:")) return collection.slice(5);
  return "今天";
}

type TaskWorkspaceProps = { tasks: Task[]; allTasks: Task[]; groups: TaskGroup[]; activeCollection: Collection; newTask: string; setNewTask: (value: string) => void; newTaskKind: "task" | "note"; setNewTaskKind: (value: "task" | "note") => void; newTaskDue: string; setNewTaskDue: (value: string) => void; composerOpen: boolean; setComposerOpen: (value: boolean) => void; addTask: (event: FormEvent) => void; addSubtask: (parentId: number, title: string) => void; addGroup: (list: string) => void; deleteTask: (id: number) => void; toggleTask: (id: number) => void; startFocus: (id: number) => void; onTrajectory: () => void; onToggleSidebar: () => void; selectedTask: Task | null; selectTask: (id: number | null) => void; updateTask: (id: number, patch: Partial<Task>) => void; detailTab: "content" | "activity"; setDetailTab: (tab: "content" | "activity") => void; detailProgress: string; setDetailProgress: (value: string) => void; addDetailProgress: () => void; lists: string[] };
function TaskWorkspace({ tasks, allTasks, groups, activeCollection, newTask, setNewTask, newTaskKind, setNewTaskKind, newTaskDue, setNewTaskDue, composerOpen, setComposerOpen, addTask, addSubtask, addGroup, deleteTask, toggleTask, startFocus, onTrajectory, onToggleSidebar, selectedTask, selectTask, updateTask, detailTab, setDetailTab, detailProgress, setDetailProgress, addDetailProgress, lists }: TaskWorkspaceProps) {
  const [sortMode, setSortMode] = useState<"manual" | "title" | "date">("manual");
  const openTasks = tasks.filter((task) => !task.done);
  const doneTasks = tasks.filter((task) => task.done);
  const sortedOpenTasks = [...openTasks].sort((a, b) => sortMode === "title" ? a.title.localeCompare(b.title, "zh-CN") : sortMode === "date" ? (a.due || "9999").localeCompare(b.due || "9999") : 0);
  const activeList = activeCollection.startsWith("list:") ? activeCollection.slice(5) : null;
  const listGroups = activeList ? groups.filter((group) => group.list === activeList) : [];
  const groupedIds = new Set(listGroups.map((group) => group.id));
  const sections = listGroups.length > 0
    ? [...listGroups.map((group) => ({ id: group.id, name: group.name, items: sortedOpenTasks.filter((task) => task.groupId === group.id) })), { id: "ungrouped", name: "未分组", items: sortedOpenTasks.filter((task) => !task.groupId || !groupedIds.has(task.groupId)) }].filter((section) => section.id !== "ungrouped" || section.items.length > 0)
    : [{ id: "all", name: collectionTitle(activeCollection), items: sortedOpenTasks }];
  return <div className="dida-task-layout with-detail">
    <section className="dida-task-pane">
      <header className="dida-task-header"><div><button aria-label="收起侧栏" onClick={onToggleSidebar}>☰</button><h1>{collectionTitle(activeCollection)}</h1><span>{openTasks.length}</span></div><div><button onClick={onTrajectory} aria-label="查看轨迹"><Sparkles /></button><button aria-label={`排序：${sortMode}`} onClick={() => setSortMode((current) => current === "manual" ? "date" : current === "date" ? "title" : "manual")}>⇅</button><button aria-label="更多" onClick={() => activeList ? addGroup(activeList) : setComposerOpen(true)}><MoreHorizontal /></button></div></header>
      <form className={`dida-task-composer ${composerOpen ? "expanded" : ""} ${newTask.trim() ? "has-value" : ""}`} onSubmit={addTask}>
        <div><Plus /><input aria-label="快速添加任务" value={newTask} onFocus={() => setComposerOpen(true)} onChange={(event) => setNewTask(event.target.value)} placeholder="添加任务" />{composerOpen && <div className="dida-composer-actions"><button type="button" className={newTaskKind === "task" ? "active" : ""} onClick={() => setNewTaskKind("task")} aria-label="创建任务"><CheckSquare /></button><button type="button" className={newTaskKind === "note" ? "active" : ""} onClick={() => setNewTaskKind("note")} aria-label="创建笔记"><FileText /></button><label aria-label="设置日期"><CalendarDays /><input type="date" value={newTaskDue} onChange={(event) => setNewTaskDue(event.target.value)} /></label><button type="button" onClick={() => setComposerOpen(false)} aria-label="收起快速添加"><ChevronDown /></button></div>}<button type="submit" disabled={!newTask.trim()}>添加</button></div>
      </form>
      <div className="dida-task-list">
        {sections.map((section) => <section className="dida-task-group" key={section.id}>{!(section.id === "all" && activeCollection === "inbox") && <div className="dida-group-heading"><span>{section.name}</span><small>{section.items.length}</small><button aria-label={`更多${section.name}`} onClick={() => activeList && addGroup(activeList)}><MoreHorizontal /></button></div>}{section.items.map((task) => <TaskRow key={task.id} task={task} showContext={activeCollection !== "inbox"} selected={selectedTask?.id === task.id} toggleTask={toggleTask} selectTask={selectTask} startFocus={startFocus} deleteTask={deleteTask} />)}</section>)}
        {openTasks.length === 0 && <div className="dida-empty-list"><CheckSquare /><b>这里已经清空了</b><p>从上方快速添加一件要做的事。</p></div>}
        {activeList && <button className="dida-add-group" onClick={() => addGroup(activeList)}><Plus />新建分组</button>}
        <details className="dida-completed" open={activeCollection !== "today" && doneTasks.length > 0}><summary>已完成 <span>{doneTasks.length}</span></summary>{doneTasks.map((task) => <TaskRow key={task.id} task={task} showContext={activeCollection !== "inbox"} selected={selectedTask?.id === task.id} toggleTask={toggleTask} selectTask={selectTask} startFocus={startFocus} deleteTask={deleteTask} />)}</details>
      </div>
    </section>
    {selectedTask ? <TaskDetail task={selectedTask} allTasks={allTasks} lists={lists} groups={groups} addSubtask={addSubtask} selectTask={selectTask} updateTask={updateTask} toggleTask={toggleTask} startFocus={startFocus} close={() => selectTask(null)} detailTab={detailTab} setDetailTab={setDetailTab} detailProgress={detailProgress} setDetailProgress={setDetailProgress} addDetailProgress={addDetailProgress} /> : <aside className="dida-task-detail dida-empty-detail" aria-label="任务详情"><div><Inbox /><span>选择任务查看详情</span></div></aside>}
  </div>;
}

function TaskRow({ task, selected, showContext, toggleTask, selectTask, startFocus, deleteTask }: { task: Task; selected: boolean; showContext: boolean; toggleTask: (id: number) => void; selectTask: (id: number) => void; startFocus: (id: number) => void; deleteTask: (id: number) => void }) {
  const stepDone = task.steps.filter((step) => step.done).length;
  return <article className={`dida-task-row ${selected ? "selected" : ""} ${task.done ? "done" : ""} ${task.kind === "note" ? "note" : ""}`}>
    {task.kind === "task" ? <button className={`dida-check priority-${task.priority}`} onClick={() => toggleTask(task.id)} aria-label={`${task.done ? "重新打开" : "完成"}${task.title}`}>{task.done ? "✓" : ""}</button> : <span className="dida-note-icon"><FileText /></span>}
    <button className="dida-task-copy" onClick={() => selectTask(task.id)}><b>{task.title}</b>{(showContext || task.steps.length > 0 || task.actual > 0) && <small>{showContext && <><span className={`list-dot ${listColors[task.list] ?? "gray"}`} />{task.list}</>}{task.steps.length ? ` · ${stepDone}/${task.steps.length}` : ""}{task.actual ? ` · ${task.actual} 分钟` : ""}</small>}</button>
    <span className="dida-row-meta">{task.meta}</span>
    {task.kind === "task" && <button className="dida-row-focus" onClick={() => startFocus(task.id)} aria-label={`专注${task.title}`}><Play /></button>}
    <button className="dida-row-more" aria-label={`删除${task.title}`} onClick={() => { if (window.confirm(`删除“${task.title}”？`)) deleteTask(task.id); }}><MoreHorizontal /></button>
  </article>;
}

function TaskDetail({ task, allTasks, lists, groups, addSubtask, selectTask, updateTask, toggleTask, startFocus, close, detailTab, setDetailTab, detailProgress, setDetailProgress, addDetailProgress }: {
  task: Task; allTasks: Task[]; lists: string[]; groups: TaskGroup[]; addSubtask: (parentId: number, title: string) => void; selectTask: (id: number | null) => void; updateTask: (id: number, patch: Partial<Task>) => void; toggleTask: (id: number) => void; startFocus: (id: number) => void; close: () => void; detailTab: "content" | "activity"; setDetailTab: (tab: "content" | "activity") => void; detailProgress: string; setDetailProgress: (value: string) => void; addDetailProgress: () => void;
}) {
  const [newStep, setNewStep] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const subtasks = allTasks.filter((item) => item.parentId === task.id);
  const parent = task.parentId == null ? null : allTasks.find((item) => item.id === task.parentId) ?? null;
  function addStep(event: FormEvent) { event.preventDefault(); if (!newStep.trim()) return; updateTask(task.id, { steps: [...task.steps, { id: Date.now(), text: newStep.trim(), done: false }] }); setNewStep(""); }
  return <aside className="dida-task-detail">
    <div className="dida-detail-toolbar">
      {task.kind === "task" ? <button className={`dida-check priority-${task.priority}`} onClick={() => toggleTask(task.id)} aria-label="完成任务">{task.done ? "✓" : ""}</button> : <FileText className="detail-kind-icon" />}
      <label className="dida-date-control"><CalendarDays /><span>{task.due ? "已设日期" : "设置日期"}</span><input type="date" value={task.due} onChange={(event) => updateTask(task.id, { due: event.target.value })} /></label>
      <button className={`priority-button priority-${task.priority}`} onClick={() => updateTask(task.id, { priority: ((task.priority + 1) % 4) as Task["priority"] })} aria-label="设置优先级"><Flag /></button>
      <button aria-label="更多"><MoreHorizontal /></button><button className="dida-detail-close" onClick={close} aria-label="关闭详情"><X /></button>
    </div>
    <div className="dida-detail-tabs"><button className={detailTab === "content" ? "active" : ""} onClick={() => setDetailTab("content")}>内容</button><button className={detailTab === "activity" ? "active" : ""} onClick={() => setDetailTab("activity")}>动态 <span>{task.activities.length}</span></button></div>
    {detailTab === "content" ? <div className="dida-detail-content">
      {parent && <button className="dida-parent-task" onClick={() => selectTask(parent.id)}><ChevronRight />{parent.title}</button>}
      <input className="dida-detail-title" value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} />
      <textarea className="dida-detail-note" value={task.note} onChange={(event) => updateTask(task.id, { note: event.target.value })} placeholder="输入内容或使用 / 快速插入" aria-label="任务笔记" />
      <section className="dida-checklist-block">{task.steps.map((step) => <div key={step.id}><button onClick={() => updateTask(task.id, { steps: task.steps.map((item) => item.id === step.id ? { ...item, done: !item.done } : item) })}>{step.done ? "✓" : ""}</button><input value={step.text} className={step.done ? "done" : ""} onChange={(event) => updateTask(task.id, { steps: task.steps.map((item) => item.id === step.id ? { ...item, text: event.target.value } : item) })} /><button onClick={() => updateTask(task.id, { steps: task.steps.filter((item) => item.id !== step.id) })} aria-label="删除检查事项"><X /></button></div>)}<form onSubmit={addStep}><Plus /><input value={newStep} onChange={(event) => setNewStep(event.target.value)} placeholder="添加检查事项" /></form></section>
      {task.kind === "task" && <section className="dida-subtask-block"><header><span>子任务</span><small>{subtasks.filter((item) => item.done).length}/{subtasks.length}</small></header>{subtasks.map((subtask) => <article key={subtask.id}><button className="dida-check" onClick={() => toggleTask(subtask.id)}>{subtask.done ? "✓" : ""}</button><button onClick={() => selectTask(subtask.id)}>{subtask.title}</button><span>{subtask.meta}</span></article>)}<form onSubmit={(event) => { event.preventDefault(); addSubtask(task.id, newSubtask); setNewSubtask(""); }}><Plus /><input value={newSubtask} onChange={(event) => setNewSubtask(event.target.value)} placeholder="添加子任务" /></form></section>}
      {task.kind === "task" && <section className="dida-detail-focus-summary"><div><span><Clock3 />已投入</span><b>{task.actual} 分钟</b></div><p>专注时间与进展会自动成为轨迹证据。</p><button onClick={() => startFocus(task.id)}><Play />开始专注</button></section>}
      <div className="dida-tag-row"><Tag />{task.tags.map((tag) => <button key={tag}>#{tag}</button>)}<button onClick={() => { const tag = window.prompt("添加标签"); if (tag?.trim()) updateTask(task.id, { tags: [...task.tags, tag.trim()] }); }}>＋ 标签</button></div>
    </div> : <div className="dida-activity-panel"><form onSubmit={(event) => { event.preventDefault(); addDetailProgress(); }}><input value={detailProgress} onChange={(event) => setDetailProgress(event.target.value)} placeholder="记录一条真实进展…" /><button>记录</button></form><div className="dida-activity-list">{task.activities.length === 0 ? <p>还没有动态。完成检查事项或专注后会自动记录。</p> : task.activities.map((activity) => <article key={activity.id} className={activity.tone ?? "system"}><i /><div><b>{activity.label}</b><span>{activity.time}</span></div></article>)}</div></div>}
    <footer><div className="dida-detail-location"><select value={task.list} onChange={(event) => updateTask(task.id, { list: event.target.value, groupId: groups.find((group) => group.list === event.target.value)?.id ?? null })}><option>收集箱</option>{lists.map((list) => <option key={list}>{list}</option>)}</select>{groups.some((group) => group.list === task.list) && <select value={task.groupId ?? ""} onChange={(event) => updateTask(task.id, { groupId: event.target.value || null })}><option value="">未分组</option>{groups.filter((group) => group.list === task.list).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}</div><div><button aria-label="格式">A</button><button aria-label="评论">◫</button><button aria-label="更多"><MoreHorizontal /></button></div></footer>
  </aside>;
}

type FocusWorkspaceProps = { task: Task; tasks: Task[]; taskId: number; setTaskId: (id: number) => void; focusStage: boolean; setFocusStage: (value: boolean) => void; mode: "countdown" | "stopwatch"; switchMode: (mode: "countdown" | "stopwatch") => void; seconds: number; running: boolean; setRunning: (value: boolean) => void; reset: () => void; end: () => void; onManualRecord: (id: number, minutes: number) => void };
function FocusWorkspace({ task, tasks, taskId, setTaskId, focusStage, setFocusStage, mode, switchMode, seconds, running, setRunning, reset, end, onManualRecord }: FocusWorkspaceProps) {
  const [focusTab, setFocusTab] = useState<"active" | "archived">("active");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMinutes, setManualMinutes] = useState("25");
  const activeTasks = tasks.filter((item) => !item.done && item.kind === "task");
  const archivedTasks = tasks.filter((item) => item.done && item.kind === "task");
  const visibleFocusTasks = focusTab === "active" ? activeTasks : archivedTasks;
  const totalMinutes = tasks.reduce((sum, item) => sum + item.actual, 0);
  const progress = mode === "countdown" ? 1 - seconds / (25 * 60) : Math.min(1, seconds / (50 * 60));
  return <div className={`focus-workspace-v2 ${focusStage ? "stage-open" : ""}`}>
    <section className="focus-main-v2">
      <header><h1>番茄专注</h1>{!focusStage && <div className="focus-archive-tabs"><button className={focusTab === "active" ? "active" : ""} onClick={() => setFocusTab("active")}>坚持中</button><button className={focusTab === "archived" ? "active" : ""} onClick={() => setFocusTab("archived")}>已归档</button></div>}<div><button onClick={() => focusStage ? setFocusStage(false) : setManualOpen(!manualOpen)} aria-label={focusStage ? "返回专注列表" : "手动添加专注记录"}>{focusStage ? "返回" : <Plus />}</button><button onClick={() => setManualOpen(!manualOpen)} aria-label="专注记录选项"><MoreHorizontal /></button></div></header>
      {!focusStage ? <div className="focus-project-list">{visibleFocusTasks.length === 0 && <p className="focus-empty">这里还没有任务。</p>}{visibleFocusTasks.map((item) => <article className={item.id === taskId ? "selected" : ""} key={item.id} onClick={() => setTaskId(item.id)}><span className={`focus-project-icon ${listColors[item.list] ?? "gray"}`}><ListChecks /></span><div><b>{item.title}</b></div><em>{item.actual}m</em>{!item.done && <button onClick={(event) => { event.stopPropagation(); setTaskId(item.id); setFocusStage(true); setRunning(true); }} aria-label={`开始专注${item.title}`}><Play /></button>}</article>)}</div> : <div className="focus-stage-v2">
        <div className="mode-switch"><button className={mode === "countdown" ? "active" : ""} onClick={() => switchMode("countdown")}>倒计时</button><button className={mode === "stopwatch" ? "active" : ""} onClick={() => switchMode("stopwatch")}>正计时</button></div>
        <div className="focus-orbit" style={{ "--progress": `${Math.round(progress * 360)}deg` } as React.CSSProperties}><div><span>{mode === "countdown" ? "本轮还剩" : "本轮投入"}</span><b>{formatClock(seconds)}</b><em>{mode === "countdown" ? "25 分钟专注" : "正计时"}</em></div></div>
        <select aria-label="选择专注任务" value={taskId} onChange={(event) => setTaskId(Number(event.target.value))}>{activeTasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <h2><span className={`list-dot ${listColors[task.list] ?? "gray"}`} />{task.title}</h2>
        <div className="focus-controls"><button className="minor-control" onClick={reset}>↺</button><button className="main-control" onClick={() => setRunning(!running)}>{running ? "暂停" : "继续"}<span>{running ? "Ⅱ" : "▶"}</span></button><button className="minor-control" onClick={end}>■</button></div>
      </div>}
      {!focusStage && <div className="focus-bottom-dock"><span className={`focus-project-icon ${listColors[task.list] ?? "gray"}`}><Timer /></span><div><small>专注</small><b>{mode === "countdown" ? "25:00" : "正计时"}</b></div><span className="focus-dock-task">{task.title}</span><button className="dock-play" onClick={() => { setFocusStage(true); setRunning(true); }} aria-label="开始计时"><Play /></button></div>}
      {manualOpen && !focusStage && <form className="focus-manual-popover" onSubmit={(event) => { event.preventDefault(); const minutes = Number(manualMinutes); if (!Number.isFinite(minutes) || minutes <= 0) return; onManualRecord(taskId, Math.round(minutes)); setManualOpen(false); }}><strong>手动添加专注</strong><label>任务<select value={taskId} onChange={(event) => setTaskId(Number(event.target.value))}>{tasks.filter((item) => item.kind === "task").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>时长（分钟）<input type="number" min="1" max="720" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} /></label><div><button type="button" onClick={() => setManualOpen(false)}>取消</button><button type="submit">记录</button></div></form>}
    </section>
    <FocusOverview tasks={tasks} totalMinutes={totalMinutes} onAdd={() => setManualOpen(true)} />
  </div>;
}

function FocusOverview({ tasks, totalMinutes, onAdd }: { tasks: Task[]; totalMinutes: number; onAdd: () => void }) {
  const records = tasks.filter((item) => item.actual > 0);
  return <aside className="focus-overview-v2"><h2>概览</h2><div className="focus-facts-v2"><article><span>今日番茄</span><b>{records.length}</b></article><article><span>今日专注时长</span><b>{Math.floor(totalMinutes / 60)}h{totalMinutes % 60}m</b></article><article><span>总番茄</span><b>128</b></article><article><span>总专注时长</span><b>62h 18m</b></article></div><div className="focus-records-v2"><header><h3>专注记录</h3><div><button onClick={onAdd} aria-label="手动添加专注记录"><Plus /></button><button onClick={onAdd} aria-label="专注记录选项"><MoreHorizontal /></button></div></header><span className="record-date">今天</span>{records.map((item, index) => <article key={item.id}><i /><div><span>{index === 0 ? "14:10 - 15:34" : index === 1 ? "10:25 - 11:07" : "09:10 - 09:39"}</span><b>{item.title}</b></div><em>{item.actual}m</em></article>)}</div></aside>;
}

type TrajectoryWorkspaceProps = { decisions: Record<number, string>; setDecision: (id: number, value: string) => void; nextFocus: number[]; toggleNext: (id: number) => void; done: () => void };
function TrajectoryWorkspace({ decisions, setDecision, nextFocus, toggleNext, done }: TrajectoryWorkspaceProps) {
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const [surface, setSurface] = useState<"review" | "memory">("review");
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [showFacts, setShowFacts] = useState(true);
  const [showInsights, setShowInsights] = useState(true);
  const [showNext, setShowNext] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState<number | null>(1);
  const insights = [
    { id: 1, confidence: "高把握", title: "产品研究正在从发散走向收敛", text: "你为竞品与用户问题投入 4 小时 12 分钟，后两次进展都开始指向同一条产品闭环。", sources: ["梳理 V1 核心流程 · 专注 84 分钟", "完成访谈提纲 · 有推进", "整理竞品反馈 · 2 条记录"] },
    { id: 2, confidence: "中等把握", title: "协作事务挤占了原型时间", text: "计划外消息与临时沟通用了 2 小时 05 分钟；原定周三开始的原型还没有产生直接证据。", sources: ["回复合作消息 · 29 分钟", "临时沟通 · 3 次"] },
    { id: 3, confidence: "待确认", title: "阅读更像能力建设，而非直接进展", text: "两次阅读帮助你形成了访谈方法，但它是否应计入产品方向，需要由你决定。", sources: ["阅读《如何做用户访谈》 · 25 分钟"] },
  ];
  const options = [{ id: 1, title: "完成核心闭环原型", meta: "直接推进 · 建议 2 次专注" }, { id: 2, title: "完成 5 次用户访谈", meta: "验证问题 · 建议 3 次专注" }, { id: 3, title: "整理本周产品反馈", meta: "支持工作 · 建议 1 次专注" }];
  const periodLabel = period === "week" ? "8月24日—8月30日" : period === "month" ? "2026年8月" : "2026年";
  function exportReview() {
    const body = [`# ${periodLabel} · 轨迹`, "", "## 事实", "真实投入：9h 42m", "有效推进：8 次", "计划外事务：22%", "", "## Agent 的理解", ...insights.map((item) => `- ${item.title}\n  ${item.text}`), "", "## 下一周期", ...options.filter((item) => nextFocus.includes(item.id)).map((item) => `- ${item.title}`)].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `time-friend-${period}-trajectory.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="trajectory-workspace-v2">
    <aside className="trajectory-nav-v2"><header><Sparkles /><h1>轨迹</h1></header><div className="trajectory-period-tabs"><button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>周</button><button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>月</button><button className={period === "year" ? "active" : ""} onClick={() => setPeriod("year")}>年</button></div><nav><span>最近复盘</span><button className={surface === "review" ? "active" : ""} onClick={() => setSurface("review")}><CalendarDays /><div><b>{periodLabel}</b><small>{period === "week" ? "本周轨迹" : period === "month" ? "月度轨迹" : "年度轨迹"}</small></div><span>3</span></button><button onClick={() => { setPeriod("week"); setSurface("review"); }}><CalendarRange /><div><b>8月17日—8月23日</b><small>已确认</small></div></button><button onClick={() => { setPeriod("month"); setSurface("review"); }}><CalendarDays /><div><b>2026年7月</b><small>月度轨迹</small></div></button></nav><footer><button className={surface === "memory" ? "active" : ""} onClick={() => setSurface("memory")}><Sparkles /><span>长期记忆</span><small>3</small></button></footer></aside>
    <section className="trajectory-document-v2"><header><div><button onClick={() => setSurface(surface === "memory" ? "review" : "memory")} aria-label="切换轨迹与记忆">☰</button><h2>{surface === "memory" ? "长期记忆" : `${periodLabel} · 轨迹`}</h2></div><div><button onClick={exportReview} aria-label="导出"><FileText /></button><button onClick={() => window.print()} aria-label="打印轨迹"><MoreHorizontal /></button></div></header>{surface === "memory" ? <MemorySurface /> : <div className="trajectory-document-scroll"><div className="trajectory-formatbar"><span>H</span><b>B</b><i>A</i><span>☑</span><span>☷</span><span>↗</span></div><article className="trajectory-report-v2"><h1>{period === "week" ? "这一周，你真正推动了什么？" : period === "month" ? "这个月，哪些方向正在变得清晰？" : "这一年，你把时间变成了什么？"}</h1><p className="trajectory-lead">事实已经整理好。Agent 给出解释，最终方向由你确认。</p>{showFacts && <section className="trajectory-facts-v2"><div><span>真实投入</span><b>{period === "week" ? "9h 42m" : period === "month" ? "41h 20m" : "286h"}</b><small>比上一周期 +12%</small></div><div><span>有效推进</span><b>{period === "week" ? "8 次" : "31 次"}</b><small>集中在 3 个方向</small></div><div><span>计划外事务</span><b>22%</b><small className="warning">需要留意</small></div></section>}{showInsights && <><h3>Agent 的理解</h3><div className="trajectory-insights-v2">{insights.map((insight, index) => <article key={insight.id}><div className="trajectory-insight-heading"><span>0{index + 1}</span><div><small>{insight.confidence}</small><h4>{insight.title}</h4></div></div><p>{insight.text}</p><button className="trajectory-evidence-toggle" onClick={() => setEvidenceOpen(evidenceOpen === insight.id ? null : insight.id)}><ChevronRight />{evidenceOpen === insight.id ? "收起证据" : "查看证据"} · {insight.sources.length} 条</button>{evidenceOpen === insight.id && <div className="trajectory-evidence-list">{insight.sources.map((source) => <button key={source}><CheckSquare /><span>{source}</span><em>查看原始记录</em></button>)}</div>}<div className="trajectory-decisions-v2"><button className={decisions[insight.id] === "yes" ? "selected" : ""} onClick={() => setDecision(insight.id, "yes")}>✓ 准确</button><button className={decisions[insight.id] === "adjust" ? "selected" : ""} onClick={() => setDecision(insight.id, "adjust")}>调整理解</button><button className={decisions[insight.id] === "keep" ? "selected" : ""} onClick={() => setDecision(insight.id, "keep")}>先保留</button></div></article>)}</div></>}{showNext && <><h3>下一周期</h3><p className="trajectory-section-copy">只保留真正重要的 1–3 件事，它们会回到「今天」。</p><div className="trajectory-next-v2">{options.map((option) => <button key={option.id} className={nextFocus.includes(option.id) ? "selected" : ""} onClick={() => toggleNext(option.id)}><span>{nextFocus.includes(option.id) ? "✓" : "+"}</span><div><b>{option.title}</b><small>{option.meta}</small></div></button>)}</div></>}<button className="trajectory-complete-v2" onClick={done}>完成本次复盘</button></article></div>}</section>
    <aside className="trajectory-settings-v2"><h2>{surface === "memory" ? "记忆设置" : "轨迹设置"}</h2>{surface === "memory" ? <><section><h3>收录原则</h3><label>记忆来源<span>仅限已确认复盘</span></label><label>当前记忆<span>3 条</span></label><label>自动更新<input type="checkbox" checked={agentEnabled} onChange={(event) => setAgentEnabled(event.target.checked)} /></label></section><section><h3>隐私与控制</h3><label>可用范围<span>仅用于你的轨迹</span></label><label>修正权<span>始终由你决定</span></label></section><p>Agent 不会把未经确认的推测写入长期记忆。你可以随时修正或忘记任何一条。</p></> : <><section><h3>周期</h3><label>复盘类型<select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="week">周复盘</option><option value="month">月复盘</option><option value="year">年复盘</option></select></label><label>时间范围<span>{periodLabel}</span></label></section><section><h3>Agent</h3><label>自动解释<input type="checkbox" checked={agentEnabled} onChange={(event) => setAgentEnabled(event.target.checked)} /></label><label>证据范围<span>任务、专注、进展</span></label><label>长期记忆<span>仅使用已确认内容</span></label></section><section><h3>显示内容</h3><label>事实指标<input type="checkbox" checked={showFacts} onChange={(event) => setShowFacts(event.target.checked)} /></label><label>Agent 判断<input type="checkbox" checked={showInsights} onChange={(event) => setShowInsights(event.target.checked)} /></label><label>下一周期<input type="checkbox" checked={showNext} onChange={(event) => setShowNext(event.target.checked)} /></label></section><p>Agent 只能解释证据，不能替你创建目标或修改任务。</p></>}</aside>
  </div>;
}

function MemorySurface() {
  const [memories, setMemories] = useState([{ id: 1, kind: "长期方向", title: "把 time-friend 做成一款真正帮助人看见方向的产品", evidence: "由 4 次周复盘确认", status: "" }, { id: 2, kind: "工作偏好", title: "需要连续 60–90 分钟的无打扰时间才能推进复杂产品问题", evidence: "由 12 次专注记录支持", status: "" }, { id: 3, kind: "需要留意", title: "临时沟通容易挤占下午的原型时间", evidence: "最近 3 周重复出现", status: "" }]);
  function updateMemory(id: number, action: "accurate" | "revise" | "forget") {
    if (action === "forget") { setMemories((items) => items.filter((item) => item.id !== id)); return; }
    if (action === "revise") { const title = window.prompt("修正这条记忆", memories.find((item) => item.id === id)?.title); if (!title?.trim()) return; setMemories((items) => items.map((item) => item.id === id ? { ...item, title: title.trim(), status: "已修正" } : item)); return; }
    setMemories((items) => items.map((item) => item.id === id ? { ...item, status: "已确认" } : item));
  }
  return <div className="trajectory-document-scroll"><article className="memory-surface-v2"><h1>Agent 记住了什么？</h1><p>只有你确认过的方向与偏好，才会进入长期记忆。</p>{memories.length === 0 && <p className="memory-empty">还没有长期记忆。</p>}{memories.map((memory) => <section key={memory.id}><span>{memory.kind}</span><h3>{memory.title}</h3><p>{memory.evidence}{memory.status && ` · ${memory.status}`}</p><div><button className={memory.status === "已确认" ? "selected" : ""} onClick={() => updateMemory(memory.id, "accurate")}>准确</button><button onClick={() => updateMemory(memory.id, "revise")}>修正</button><button onClick={() => updateMemory(memory.id, "forget")}>忘记</button></div></section>)}</article></div>;
}

function SearchDialog({ tasks, query, setQuery, onClose, onSelect }: { tasks: Task[]; query: string; setQuery: (value: string) => void; onClose: () => void; onSelect: (id: number) => void }) {
  const results = tasks.filter((task) => `${task.title} ${task.note} ${task.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="dida-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dida-search-dialog" role="dialog" aria-modal="true"><header><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、笔记和标签" /><button onClick={onClose}><X /></button></header><div>{query ? results.map((task) => <button key={task.id} onClick={() => onSelect(task.id)}><span className={`list-dot ${listColors[task.list] ?? "gray"}`} /><div><b>{task.title}</b><small>{task.list} · {task.kind === "note" ? "笔记" : "任务"}</small></div><em>↵</em></button>) : <p>输入关键词，快速找到任务、笔记或轨迹证据。</p>}</div></section></div>;
}
