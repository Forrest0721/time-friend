"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Bell,
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ChevronRight,
  CircleHelp,
  Clock3,
  Folder,
  Inbox,
  ListTodo,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Timer,
} from "lucide-react";

type View = "tasks" | "lists" | "focus" | "trajectory";
type Task = {
  id: number;
  title: string;
  list: string;
  meta: string;
  minutes: number;
  actual: number;
  done: boolean;
  key?: boolean;
};

const initialTasks: Task[] = [
  { id: 1, title: "梳理 V1 核心流程", list: "产品探索", meta: "预计 90 分钟", minutes: 90, actual: 84, done: false, key: true },
  { id: 2, title: "完成访谈提纲", list: "用户研究", meta: "今天 16:00", minutes: 45, actual: 42, done: false, key: true },
  { id: 3, title: "回复合作消息", list: "工作协作", meta: "3 条消息", minutes: 20, actual: 29, done: false, key: true },
  { id: 4, title: "整理本周产品反馈", list: "产品探索", meta: "16:30 · 30 分钟", minutes: 30, actual: 0, done: false },
  { id: 5, title: "阅读《如何做用户访谈》", list: "个人成长", meta: "今晚 · 25 分钟", minutes: 25, actual: 0, done: false },
];

const navItems: { id: View; label: string; icon: string }[] = [
  { id: "tasks", label: "任务", icon: "◉" },
  { id: "focus", label: "专注", icon: "◎" },
  { id: "trajectory", label: "轨迹", icon: "↗" },
];

const listColors: Record<string, string> = {
  产品探索: "amber",
  用户研究: "violet",
  工作协作: "indigo",
  个人成长: "sage",
};

function formatClock(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const seconds = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function DemoApp() {
  const [view, setView] = useState<View>("tasks");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [newTask, setNewTask] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(1);
  const [focusTaskId, setFocusTaskId] = useState<number>(1);
  const [mode, setMode] = useState<"countdown" | "stopwatch">("countdown");
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sessionModal, setSessionModal] = useState(false);
  const [sessionResult, setSessionResult] = useState("progress");
  const [sessionNote, setSessionNote] = useState("");
  const [toast, setToast] = useState("");
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, string>>({});
  const [nextFocus, setNextFocus] = useState([1, 2]);

  const focusTask = tasks.find((task) => task.id === focusTaskId) ?? tasks[0];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const completedCount = tasks.filter((task) => task.done).length;

  useEffect(() => {
    const saved = window.localStorage.getItem("jianshi-prototype-tasks");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Task[];
        queueMicrotask(() => setTasks(parsed));
      } catch { /* prototype fallback */ }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("jianshi-prototype-tasks", JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (mode === "countdown" && current <= 1) {
          setRunning(false);
          setSessionModal(true);
          return 0;
        }
        return mode === "countdown" ? current - 1 : current + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, mode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function go(next: View) {
    setView(next);
    if (next !== "focus") setRunning(false);
  }

  function addTask(event: FormEvent) {
    event.preventDefault();
    if (!newTask.trim()) return;
    const task: Task = {
      id: Date.now(), title: newTask.trim(), list: "Inbox", meta: "刚刚添加", minutes: 25, actual: 0, done: false,
    };
    setTasks((current) => [...current, task]);
    setNewTask("");
    setToast("任务已放入今天");
  }

  function toggleTask(id: number) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task));
  }

  function renameTask(id: number, title: string) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, title } : task));
  }

  function startFocus(id: number) {
    setFocusTaskId(id);
    setMode("countdown");
    setSeconds(25 * 60);
    setView("focus");
    setRunning(true);
  }

  function switchMode(next: "countdown" | "stopwatch") {
    setRunning(false);
    setMode(next);
    setSeconds(next === "countdown" ? 25 * 60 : 0);
  }

  function finishSession() {
    const usedMinutes = mode === "countdown" ? Math.max(1, Math.round((25 * 60 - seconds) / 60)) : Math.max(1, Math.round(seconds / 60));
    setTasks((current) => current.map((task) => task.id === focusTaskId ? {
      ...task,
      actual: task.actual + usedMinutes,
      done: sessionResult === "done" ? true : task.done,
    } : task));
    setSessionModal(false);
    setRunning(false);
    setSessionNote("");
    setView("tasks");
    setToast(sessionResult === "blocked" ? "阻塞已记录，周复盘会再提醒你" : "这次推进已记入轨迹");
  }

  return (
    <main className={`dida-shell dida-view-${view}`}>
      <aside className="dida-app-rail" aria-label="应用导航">
        <button className="dida-avatar" aria-label="账户">F</button>
        <nav>
          <button className={view === "tasks" || view === "lists" ? "active" : ""} onClick={() => go("tasks")} aria-label="任务"><CheckSquare /></button>
          <button onClick={() => go("tasks")} aria-label="日历"><CalendarDays /></button>
          <button className={view === "focus" ? "active" : ""} onClick={() => go("focus")} aria-label="专注"><Timer /></button>
          <button className={view === "trajectory" ? "active" : ""} onClick={() => go("trajectory")} aria-label="轨迹"><Sparkles /></button>
          <button aria-label="搜索"><Search /></button>
        </nav>
        <div className="dida-rail-bottom">
          <button aria-label="同步"><RefreshCw /></button>
          <button aria-label="通知"><Bell /></button>
          <button aria-label="设置"><Settings /></button>
          <button aria-label="帮助"><CircleHelp /></button>
        </div>
      </aside>

      {(view === "tasks" || view === "lists") && (
        <aside className="dida-list-sidebar">
          <div className="dida-shortcuts">
            <button><span className="coral"><Sparkles /></span><small>轨迹</small></button>
            <button><span className="gold"><Sun /></span><small>今日</small></button>
            <button><span className="violet"><ListTodo /></span><small>待做</small></button>
            <button><span className="mint"><Clock3 /></span><small>进展</small></button>
          </div>

          <nav className="dida-smart-lists" aria-label="智能清单">
            <button className={view === "tasks" ? "active" : ""} onClick={() => go("tasks")}><Sun /><span>今天</span><small>{tasks.filter((task) => !task.done).length}</small></button>
            <button onClick={() => go("tasks")}><CalendarRange /><span>最近 7 天</span><small>{tasks.length + 3}</small></button>
            <button className={view === "lists" ? "active" : ""} onClick={() => go("lists")}><Inbox /><span>收集箱</span><small>{tasks.length}</small></button>
            <button onClick={() => go("trajectory")}><Sparkles /><span>轨迹摘要</span><small>1</small></button>
          </nav>

          <div className="dida-sidebar-section">
            <div><span>清单</span><button aria-label="添加清单"><Plus /></button></div>
            <button className="dida-folder"><ChevronRight /><Folder /><span>工作</span><small>{tasks.filter((task) => !task.done).length}</small></button>
            {Object.entries(listColors).map(([label, color]) => (
              <button className="dida-list-entry" key={label} onClick={() => go("lists")}>
                <span className={`list-dot ${color}`} />{label}
                <small>{tasks.filter((task) => task.list === label && !task.done).length || ""}</small>
              </button>
            ))}
          </div>

          <button className="dida-new-list"><Plus /> 新建清单</button>
        </aside>
      )}

      <section className="workspace dida-workspace">
        {view === "tasks" && (
          <TodayView
            tasks={tasks}
            completedCount={completedCount}
            newTask={newTask}
            setNewTask={setNewTask}
            addTask={addTask}
            toggleTask={toggleTask}
            startFocus={startFocus}
            onTrajectory={() => go("trajectory")}
            selectedTask={selectedTask}
            selectTask={setSelectedTaskId}
            renameTask={renameTask}
          />
        )}
        {view === "lists" && <ListsView tasks={tasks} toggleTask={toggleTask} startFocus={startFocus} />}
        {view === "focus" && (
          <FocusView
            task={focusTask}
            tasks={tasks}
            taskId={focusTaskId}
            setTaskId={setFocusTaskId}
            mode={mode}
            switchMode={switchMode}
            seconds={seconds}
            running={running}
            setRunning={setRunning}
            reset={() => setSeconds(mode === "countdown" ? 25 * 60 : 0)}
            end={() => { setRunning(false); setSessionModal(true); }}
          />
        )}
        {view === "trajectory" && (
          <TrajectoryView
            decisions={reviewDecisions}
            setDecision={(id, value) => setReviewDecisions((current) => ({ ...current, [id]: value }))}
            nextFocus={nextFocus}
            toggleNext={(id) => setNextFocus((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
            done={() => { setToast("周复盘已完成，下周重点已回到任务页"); go("tasks"); }}
          />
        )}
      </section>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => go(item.id)}><span>{item.icon}</span>{item.label}</button>)}
      </nav>

      {sessionModal && (
        <div className="modal-backdrop" role="presentation">
          <section className="session-modal" role="dialog" aria-modal="true" aria-labelledby="session-title">
            <button className="modal-close" onClick={() => setSessionModal(false)} aria-label="关闭">×</button>
            <span className="eyebrow">一次真实记录</span>
            <h2 id="session-title">这段时间，发生了什么？</h2>
            <p className="modal-task">{focusTask.title}</p>
            <div className="result-grid">
              {[
                ["done", "✓", "完成了"], ["progress", "↗", "有推进"], ["blocked", "!", "被阻塞"], ["admin", "·", "只是事务"],
              ].map(([id, icon, label]) => (
                <button key={id} className={sessionResult === id ? "selected" : ""} onClick={() => setSessionResult(id)}>
                  <span>{icon}</span>{label}
                </button>
              ))}
            </div>
            <label className="note-label">留下一句进展 <em>可选</em>
              <textarea value={sessionNote} onChange={(event) => setSessionNote(event.target.value)} placeholder="例如：核心流程已确定，还缺结束会话后的反馈状态" />
            </label>
            <button className="primary-action full" onClick={finishSession}>记入今天</button>
            <p className="privacy-note">只记录事实。Agent 会在周复盘中提出它的理解，由你决定是否成立。</p>
          </section>
        </div>
      )}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function TodayView({ tasks, completedCount, newTask, setNewTask, addTask, toggleTask, startFocus, onTrajectory, selectedTask, selectTask, renameTask }: {
  tasks: Task[]; completedCount: number; newTask: string; setNewTask: (value: string) => void;
  addTask: (event: FormEvent) => void; toggleTask: (id: number) => void; startFocus: (id: number) => void; onTrajectory: () => void;
  selectedTask: Task | null; selectTask: (id: number | null) => void; renameTask: (id: number, title: string) => void;
}) {
  const openTasks = tasks.filter((task) => !task.done);
  const doneTasks = tasks.filter((task) => task.done);
  return (
    <div className={`dida-task-layout ${selectedTask ? "with-detail" : ""}`}>
      <section className="dida-task-pane">
        <header className="dida-task-header">
          <div><button aria-label="收起侧栏">☰</button><h1>今天</h1><span>{openTasks.length}</span></div>
          <div><button onClick={onTrajectory} aria-label="查看轨迹"><Sparkles /></button><button aria-label="排序">⇅</button><button aria-label="更多"><MoreHorizontal /></button></div>
        </header>

        <form className="dida-task-composer" onSubmit={addTask}>
          <Plus />
          <input aria-label="快速添加任务" value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="添加任务" />
          <button>添加</button>
        </form>

        <div className="dida-task-list">
          <div className="dida-group-heading"><span>今天</span><small>{openTasks.length}</small></div>
          {openTasks.map((task) => (
            <article className={`dida-task-row ${selectedTask?.id === task.id ? "selected" : ""}`} key={task.id}>
              <button className="dida-check" onClick={() => toggleTask(task.id)} aria-label={`完成${task.title}`} />
              <button className="dida-task-copy" onClick={() => selectTask(task.id)}>
                <b>{task.title}</b>
                <small><span className={`list-dot ${listColors[task.list] ?? "gray"}`} />{task.list}{task.actual > 0 ? ` · 已投入 ${task.actual} 分钟` : ""}</small>
              </button>
              <span className="dida-row-meta">{task.meta}</span>
              <button className="dida-row-focus" onClick={() => startFocus(task.id)} aria-label={`专注${task.title}`}><Play /></button>
            </article>
          ))}

          <details className="dida-completed" open={doneTasks.length > 0}>
            <summary>已完成 <span>{doneTasks.length || completedCount}</span></summary>
            {doneTasks.map((task) => <article className="dida-task-row done" key={task.id}><button className="dida-check" onClick={() => toggleTask(task.id)}>✓</button><button className="dida-task-copy" onClick={() => selectTask(task.id)}><b>{task.title}</b><small>{task.list}</small></button></article>)}
          </details>
        </div>
      </section>

      {selectedTask && (
        <aside className="dida-task-detail">
          <div className="dida-detail-toolbar">
            <button className="dida-check" onClick={() => toggleTask(selectedTask.id)} aria-label="完成任务" />
            <button><CalendarDays /> 设置日期</button>
            <button aria-label="更多"><MoreHorizontal /></button>
            <button className="dida-detail-close" onClick={() => selectTask(null)} aria-label="关闭详情">×</button>
          </div>
          <input className="dida-detail-title" value={selectedTask.title} onChange={(event) => renameTask(selectedTask.id, event.target.value)} />
          <textarea className="dida-detail-note" defaultValue={`今天的推进重点\n\n- [ ] 完成最小闭环\n- [ ] 留下一条真实进展`} aria-label="任务笔记" />
          <section className="dida-detail-progress">
            <div><span><Clock3 /> 已投入</span><b>{selectedTask.actual || 0} 分钟</b></div>
            <p>Agent 会在轨迹中结合任务、专注和进展解释这段投入。</p>
            <button onClick={() => startFocus(selectedTask.id)}><Play /> 开始专注</button>
          </section>
          <footer><span className={`list-dot ${listColors[selectedTask.list] ?? "gray"}`} />{selectedTask.list}<button><MoreHorizontal /></button></footer>
        </aside>
      )}
    </div>
  );
}

function ListsView({ tasks, toggleTask, startFocus }: { tasks: Task[]; toggleTask: (id: number) => void; startFocus: (id: number) => void }) {
  const groups = ["产品探索", "用户研究", "工作协作", "个人成长", "Inbox"];
  return <div className="standard-page">
    <header className="page-header"><div><span className="eyebrow">所有行动</span><h1>清单</h1><p>快速组织，不需要先想清楚它属于哪个目标。</p></div><button className="primary-action">＋ 新任务</button></header>
    <div className="filter-row"><button className="selected">未完成 {tasks.filter((task) => !task.done).length}</button><button>今天</button><button>已完成 {tasks.filter((task) => task.done).length}</button><span /><button>排序：最近行动⌄</button></div>
    <div className="list-board">
      {groups.map((group) => {
        const current = tasks.filter((task) => task.list === group);
        if (!current.length) return null;
        return <section key={group} className="list-group">
          <div className="list-group-title"><div><span className={`list-dot ${listColors[group] ?? "gray"}`} /><h2>{group}</h2><em>{current.length}</em></div><button>•••</button></div>
          {current.map((task) => <article className={task.done ? "done" : ""} key={task.id}>
            <button className="plain-check" onClick={() => toggleTask(task.id)}>{task.done ? "✓" : ""}</button><div><h3>{task.title}</h3><p>{task.meta} {task.actual > 0 ? `· 已投入 ${task.actual} 分钟` : ""}</p></div><button className="row-play" onClick={() => startFocus(task.id)}>▶</button>
          </article>)}
        </section>;
      })}
    </div>
  </div>;
}

function FocusView({ task, tasks, taskId, setTaskId, mode, switchMode, seconds, running, setRunning, reset, end }: {
  task: Task; tasks: Task[]; taskId: number; setTaskId: (id: number) => void; mode: "countdown" | "stopwatch"; switchMode: (mode: "countdown" | "stopwatch") => void;
  seconds: number; running: boolean; setRunning: (value: boolean) => void; reset: () => void; end: () => void;
}) {
  const progress = mode === "countdown" ? 1 - seconds / (25 * 60) : Math.min(1, seconds / (50 * 60));
  return <div className="demo-focus-layout">
    <section className="focus-page">
      <div className="focus-top"><span>专注</span><div className="mode-switch"><button className={mode === "countdown" ? "active" : ""} onClick={() => switchMode("countdown")}>倒计时</button><button className={mode === "stopwatch" ? "active" : ""} onClick={() => switchMode("stopwatch")}>正计时</button></div><button className="quiet-button">全屏 ↗</button></div>
      <div className="focus-stage">
        <div className="focus-orbit" style={{ "--progress": `${Math.round(progress * 360)}deg` } as React.CSSProperties}>
          <div><span>{mode === "countdown" ? "本轮还剩" : "本轮投入"}</span><b>{formatClock(seconds)}</b><em>{mode === "countdown" ? "25 分钟专注" : "正计时"}</em></div>
        </div>
        <select aria-label="选择专注任务" value={taskId} onChange={(event) => setTaskId(Number(event.target.value))}>{tasks.filter((item) => !item.done).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
        <div className="focus-task-name"><span className={`list-dot ${listColors[task.list] ?? "gray"}`} /><h1>{task.title}</h1></div>
        <p>你不需要现在解释它的意义。先认真做完这一小段。</p>
        <div className="focus-controls"><button className="minor-control" onClick={reset}>↺</button><button className="main-control" onClick={() => setRunning(!running)}>{running ? "暂停" : "继续"}<span>{running ? "Ⅱ" : "▶"}</span></button><button className="minor-control" onClick={end}>■</button></div>
      </div>
      <div className="focus-footer"><span>已为这项任务投入 {task.actual} 分钟</span><span>安静模式 · 通知已收起</span></div>
    </section>
    <aside className="demo-focus-overview">
      <h2>概览</h2>
      <div className="demo-focus-facts"><article><span>今日番茄</span><b>3</b></article><article><span>今日专注时长</span><b>2h 35m</b></article></div>
      <div className="demo-focus-records"><div><h3>专注记录</h3><button>＋</button></div>{tasks.filter((item) => item.actual > 0).map((item, index) => <article key={item.id}><i /><div><span>{index === 0 ? "14:10 - 15:34" : index === 1 ? "10:25 - 11:07" : "09:10 - 09:39"}</span><b>{item.title}</b></div><em>{item.actual}m</em></article>)}</div>
    </aside>
  </div>;
}

function TrajectoryView({ decisions, setDecision, nextFocus, toggleNext, done }: {
  decisions: Record<number, string>; setDecision: (id: number, value: string) => void;
  nextFocus: number[]; toggleNext: (id: number) => void; done: () => void;
}) {
  const insights = [
    { id: 1, confidence: "高把握", title: "产品研究正在从发散走向收敛", text: "你为竞品与用户问题投入 4 小时 12 分钟，后两次进展都开始指向同一条产品闭环。", sources: ["梳理 V1 核心流程", "竞品研究", "访谈问题清单"] },
    { id: 2, confidence: "中等把握", title: "协作事务挤占了原型时间", text: "计划外消息与临时沟通用了 2 小时 05 分钟；原定周三开始的原型还没有产生直接证据。", sources: ["回复合作消息", "3 次临时沟通"] },
    { id: 3, confidence: "待确认", title: "阅读可能是能力建设，而非直接进展", text: "两次阅读帮助你形成了访谈方法，但它是否应计入产品方向，需要由你决定。", sources: ["阅读《如何做用户访谈》"] },
  ];
  const options = [{ id: 1, title: "完成核心闭环原型", meta: "直接推进 · 建议 2 次专注" }, { id: 2, title: "完成 5 次用户访谈", meta: "验证问题 · 建议 3 次专注" }, { id: 3, title: "整理本周产品反馈", meta: "支持工作 · 建议 1 次专注" }];

  return <div className="standard-page trajectory-page">
    <header className="trajectory-header"><div><span className="eyebrow">8 月 10 日—16 日 · 周轨迹</span><h1>这一周，你真正推动了什么？</h1><p>事实已经整理好。你只需要确认它的意义。</p></div></header>
    <div className="review-flow"><span className="active">1 · 事实</span><i /><span className="active">2 · 意义</span><i /><span>3 · 选择</span></div>

    <section className="facts-grid">
      <div><span>真实投入</span><b>9h 42m</b><em>比上周 +1h 18m</em></div><div><span>有效推进</span><b>8 次</b><em>3 个方向</em></div><div><span>计划外事务</span><b>22%</b><em className="warning">需要留意</em></div>
      <article><span>投入如何分布</span><div className="distribution"><i className="d1" /><i className="d2" /><i className="d3" /><i className="d4" /></div><p><em className="amber-dot" />产品探索 44% <em className="violet-dot" />用户研究 28% <em className="indigo-dot" />协作 22%</p></article>
    </section>

    <section className="meaning-section">
      <div className="review-section-title"><span>Agent 的理解</span><h2>这里有 3 个判断，等你校正</h2><p>每条都能回到原始证据。</p></div>
      <div className="insight-list">{insights.map((insight, index) => <article className="insight-review" key={insight.id}>
        <div className="insight-number">0{index + 1}</div><div className="insight-body"><div><span className={insight.confidence === "高把握" ? "high" : ""}>{insight.confidence}</span><h3>{insight.title}</h3></div><p>{insight.text}</p><button className="source-toggle">证据 · {insight.sources.join("、")}</button></div>
        <div className="decision-buttons"><button className={decisions[insight.id] === "yes" ? "selected" : ""} onClick={() => setDecision(insight.id, "yes")}>✓ 是的</button><button className={decisions[insight.id] === "adjust" ? "selected" : ""} onClick={() => setDecision(insight.id, "adjust")}>调整理解</button><button className={decisions[insight.id] === "explore" ? "selected" : ""} onClick={() => setDecision(insight.id, "explore")}>先保留</button></div>
      </article>)}</div>
    </section>

    <section className="next-section">
      <div className="review-section-title"><span>下周选择</span><h2>只保留真正重要的 1–3 件事</h2><p>它们会温和地回到你的「今天」，不会生成新的目标树。</p></div>
      <div className="next-options">{options.map((option) => <button key={option.id} className={nextFocus.includes(option.id) ? "selected" : ""} onClick={() => toggleNext(option.id)}><span>{nextFocus.includes(option.id) ? "✓" : "+"}</span><div><b>{option.title}</b><em>{option.meta}</em></div></button>)}</div>
      <button className="primary-action review-done" onClick={done}>完成本周复盘 <span>→</span></button>
    </section>
  </div>;
}
