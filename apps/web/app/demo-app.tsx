"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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

  const totalActual = useMemo(() => tasks.reduce((sum, task) => sum + task.actual, 0), [tasks]);

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
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("tasks")} aria-label="回到任务">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>见时</span>
        </button>

        <nav className="primary-nav" aria-label="主导航">
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => go(item.id)}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "trajectory" && <em>1</em>}
            </button>
          ))}
        </nav>

        <div className="list-nav">
          <p>我的清单</p>
          {Object.entries(listColors).map(([label, color]) => (
            <button key={label} onClick={() => go("lists")}>
              <span className={`list-dot ${color}`} />{label}
              <small>{tasks.filter((task) => task.list === label && !task.done).length || ""}</small>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <button className="avatar">F</button>
          <div><b>Forrest</b><span>正在形成第 4 周轨迹</span></div>
          <button className="more-button" aria-label="更多">•••</button>
        </div>
      </aside>

      <section className="workspace">
        {view === "tasks" && (
          <TodayView
            tasks={tasks}
            completedCount={completedCount}
            totalActual={totalActual}
            newTask={newTask}
            setNewTask={setNewTask}
            addTask={addTask}
            toggleTask={toggleTask}
            startFocus={startFocus}
            onTrajectory={() => go("trajectory")}
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

function TodayView({ tasks, completedCount, totalActual, newTask, setNewTask, addTask, toggleTask, startFocus, onTrajectory }: {
  tasks: Task[]; completedCount: number; totalActual: number; newTask: string; setNewTask: (value: string) => void;
  addTask: (event: FormEvent) => void; toggleTask: (id: number) => void; startFocus: (id: number) => void; onTrajectory: () => void;
}) {
  const keyTasks = tasks.filter((task) => task.key);
  const laterTasks = tasks.filter((task) => !task.key);
  return (
    <div className="today-layout">
      <div className="today-main">
        <header className="page-header">
          <div><span className="eyebrow">周三 · 8 月 12 日</span><h1>把今天，放回方向里。</h1></div>
          <div className="header-actions"><button className="quiet-button">···</button><button className="avatar small">F</button></div>
        </header>

        <section className="direction-strip">
          <div className="direction-kicker"><span className="pulse-dot" />本周方向</div>
          <div><h2>验证时间管理产品的核心问题</h2><p>已识别 5 条有效证据 · 还有 2 个工作日</p></div>
          <div className="direction-progress"><span><i style={{ width: "64%" }} /></span><b>正在形成</b></div>
        </section>

        <section className="task-section">
          <div className="section-title"><div><span>01</span><h2>今日重点</h2></div><p>{keyTasks.filter((task) => !task.done).length} 个恰到好处</p></div>
          <div className="key-task-list">
            {keyTasks.map((task, index) => (
              <article className={`task-row ${task.done ? "done" : ""}`} key={task.id}>
                <button className="task-check" onClick={() => toggleTask(task.id)} aria-label={`${task.done ? "恢复" : "完成"}${task.title}`}>{task.done ? "✓" : index + 1}</button>
                <div className="task-copy"><h3>{task.title}</h3><p><span className={`list-dot ${listColors[task.list] ?? "gray"}`} />{task.list}<em>{task.meta}</em></p></div>
                {task.actual > 0 && <span className="actual-time">{task.actual >= 60 ? `${Math.floor(task.actual / 60)}h ${task.actual % 60}m` : `${task.actual}m`}</span>}
                <button className="focus-button" onClick={() => startFocus(task.id)}><i />专注</button>
              </article>
            ))}
          </div>
        </section>

        <form className="quick-add" onSubmit={addTask}>
          <span>＋</span><input aria-label="快速添加任务" value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="快速添加任务，按 Enter 保存" /><button>添加</button>
        </form>

        <section className="later-section">
          <div className="section-title compact"><div><span>02</span><h2>稍后</h2></div><p>{laterTasks.length} 项</p></div>
          {laterTasks.map((task) => (
            <article className={`later-task ${task.done ? "done" : ""}`} key={task.id}>
              <button className="plain-check" onClick={() => toggleTask(task.id)}>{task.done ? "✓" : ""}</button><span>{task.meta.split(" · ")[0]}</span><h3>{task.title}</h3><em>{task.meta.split(" · ")[1]}</em>
            </article>
          ))}
        </section>
      </div>

      <aside className="today-rail">
        <div className="rail-date"><span>12</span><div><b>八月</b><em>2026</em></div></div>
        <section className="evidence-card">
          <span className="eyebrow amber-text">方向证据</span><h2>你的行动正在<br />汇入这条方向</h2>
          <div className="evidence-bars">{[48, 62, 82, 38, 58, 28, 66].map((height, index) => <i key={index} className={index === 2 ? "today-bar" : ""} style={{ height }} />)}</div>
          <div className="evidence-legend"><span>周一</span><span>今天</span><span>周日</span></div>
          <div className="evidence-stat"><b>{Math.floor(totalActual / 60)}h {totalActual % 60}m</b><span>已投入</span><b>{completedCount + 5}</b><span>条证据</span></div>
        </section>
        <section className="agent-card">
          <div className="agent-title"><span>✦</span><b>见时观察</b><em>中等把握</em></div>
          <p>你今天的前两个重点，都在回答同一个问题：怎样让长期方向不再成为额外维护。</p>
          <div className="agent-sources"><span>梳理 V1 核心流程</span><span>完成访谈提纲</span></div>
          <button onClick={onTrajectory}>查看为什么 <span>→</span></button>
        </section>
        <section className="review-callout">
          <div><span>周复盘</span><h3>周日为你整理</h3><p>预计只需 3 分钟确认</p></div><button onClick={onTrajectory}>预览</button>
        </section>
      </aside>
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
  return <div className="focus-page">
    <div className="focus-top"><span>正在专注</span><div className="mode-switch"><button className={mode === "countdown" ? "active" : ""} onClick={() => switchMode("countdown")}>倒计时</button><button className={mode === "stopwatch" ? "active" : ""} onClick={() => switchMode("stopwatch")}>正计时</button></div><button className="quiet-button">全屏 ↗</button></div>
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
