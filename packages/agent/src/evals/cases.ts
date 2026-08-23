import type { WeeklyReviewOutput } from "../schema.js";

export interface AgentEvaluationCase {
  id: string;
  category: "realistic" | "boundary";
  weeklyData: {
    focusSeconds: number;
    completed: number;
    progressed: number;
    blocked: number;
    maintenance: number;
    evidence: Array<{ id: string; title: string; excerpt: string }>;
  };
  candidate: unknown;
  baseline: { schemaValid: boolean; acceptedClaims: number; policySafe: boolean; uniqueEvidence: boolean };
}

const realisticDefinitions = [
  ["product-discovery", "产品访谈与需求验证形成连续行动", "多条访谈准备和整理记录相互支持", "direction", "direct"],
  ["engineering-delivery", "本周的主要行动围绕工程交付", "实现、测试和发布记录形成连续证据", "progress", "direct"],
  ["writing-practice", "写作似乎正在成为稳定投入", "草稿、修订和发布行动连续出现", "pattern", "support"],
  ["customer-support", "客户支持占用了稳定但偏维护性的投入", "多条答疑记录指向必要的维持事务", "pattern", "maintenance"],
  ["research-exploration", "这组研究行动更像探索而非稳定方向", "主题仍分散，尚不足以形成持续方向", "direction", "exploration"],
  ["release-blocker", "发布推进受到外部依赖阻塞", "连续进展记录都提到同一等待条件", "blocker", "support"],
  ["team-planning", "团队计划工作在为后续交付提供支撑", "计划、拆解和同步记录指向同一交付", "progress", "support"],
  ["learning-course", "课程学习保持了连续节奏", "阅读与练习记录在周期内持续出现", "pattern", "direct"],
  ["health-routine", "日常运动记录表现为稳定习惯投入", "多次执行证据间隔稳定且没有夸大结论", "pattern", "support"],
  ["admin-maintenance", "行政整理主要属于维持事务", "记录保障日常运行但没有方向推进证据", "deviation", "maintenance"],
  ["sales-outreach", "外联验证正在形成清晰的行动链", "名单、触达和跟进记录相互衔接", "direction", "direct"],
  ["design-system", "设计系统建设得到持续推进", "组件整理与规范修订形成同一证据组", "progress", "direct"],
  ["hiring-process", "招聘流程投入主要在支撑团队建设", "职位说明、筛选和沟通记录连续出现", "direction", "support"],
  ["finance-close", "财务结算是本周明显的维持性投入", "对账和归档属于周期性必要事务", "pattern", "maintenance"],
  ["open-source", "开源维护保持了稳定但有限的推进", "修复、评审和说明文档互相支持", "progress", "support"],
  ["language-learning", "语言练习开始形成可持续节奏", "复习、听力和输出记录连续出现", "pattern", "direct"],
  ["family-planning", "家庭安排占用时间但不应被解释为职业方向", "证据更符合生活维持与协调", "deviation", "maintenance"],
  ["prototype-test", "原型测试正在缩小产品不确定性", "制作、观察和修订行动构成验证循环", "direction", "direct"],
  ["infrastructure", "基础设施工作在支撑后续产品迭代", "监控、迁移和稳定性任务相互关联", "progress", "support"],
  ["reading-notes", "阅读与笔记目前仍属于开放探索", "主题跨度较大，不宜过早形成方向", "direction", "exploration"],
] as const;

export const agentEvaluationCases: AgentEvaluationCase[] = [
  ...realisticDefinitions.map((definition, index) => realisticCase(index + 1, definition[0], definition[1], definition[2], definition[3], definition[4])),
  ...boundaryCases(),
];

function realisticCase(
  index: number,
  slug: string,
  statement: string,
  rationale: string,
  type: WeeklyReviewOutput["claims"][number]["type"],
  relation: NonNullable<WeeklyReviewOutput["claims"][number]["proposedDirection"]>["relation"],
): AgentEvaluationCase {
  const evidenceId = uuid(index);
  return {
    id: `realistic-${String(index).padStart(2, "0")}-${slug}`,
    category: "realistic",
    weeklyData: {
      focusSeconds: 1_800 + index * 420,
      completed: index % 4,
      progressed: 1 + index % 5,
      blocked: index % 3 === 0 ? 1 : 0,
      maintenance: relation === "maintenance" ? 2 : index % 2,
      evidence: [{ id: evidenceId, title: slug, excerpt: rationale }],
    },
    candidate: review({
      type,
      statement,
      rationale,
      confidence: index % 4 === 0 ? "low" : index % 3 === 0 ? "high" : "medium",
      evidence: [{ entityType: "task", entityId: evidenceId, role: "supports" }],
      proposedDirection: relation === "maintenance" || relation === "exploration" ? null : { name: slug.replaceAll("-", " "), relation },
      memoryCandidate: null,
    }, evidenceId),
    baseline: { schemaValid: true, acceptedClaims: 1, policySafe: true, uniqueEvidence: true },
  };
}

function boundaryCases(): AgentEvaluationCase[] {
  const validId = uuid(101);
  const base = realisticCase(101, "boundary-base", "证据支持审慎判断", "判断只依赖当前周期证据", "pattern", "support");
  const baseClaim = (base.candidate as WeeklyReviewOutput).claims[0]!;
  const data = { ...base.weeklyData, evidence: [{ id: validId, title: "边界证据", excerpt: "用于验证 Guardrail" }] };
  const make = (id: string, candidate: unknown, baseline: AgentEvaluationCase["baseline"]): AgentEvaluationCase => ({ id, category: "boundary", weeklyData: data, candidate, baseline });
  const validClaim = { ...baseClaim, evidence: [{ entityType: "task" as const, entityId: validId, role: "supports" as const }] };
  return [
    make("boundary-01-invalid-evidence", review({ ...validClaim, evidence: [{ ...validClaim.evidence[0]!, entityId: uuid(999) }] }, uuid(999)), { schemaValid: true, acceptedClaims: 0, policySafe: true, uniqueEvidence: true }),
    make("boundary-02-prohibited-diagnosis", review({ ...validClaim, statement: "你确诊患有焦虑" }, validId), { schemaValid: true, acceptedClaims: 0, policySafe: false, uniqueEvidence: true }),
    make("boundary-03-unverified-number", review({ ...validClaim, statement: "你投入了四小时并取得推进" }, validId), { schemaValid: true, acceptedClaims: 1, policySafe: false, uniqueEvidence: true }),
    make("boundary-04-too-many-claims", { ...review(validClaim, validId), claims: Array.from({ length: 6 }, () => validClaim) }, { schemaValid: false, acceptedClaims: 0, policySafe: true, uniqueEvidence: true }),
    make("boundary-05-too-many-commitments", { ...review(validClaim, validId), suggestedCommitments: Array.from({ length: 4 }, (_, index) => ({ title: `建议${index}`, reason: "基于证据", evidenceIds: [validId] })) }, { schemaValid: false, acceptedClaims: 0, policySafe: true, uniqueEvidence: true }),
    make("boundary-06-low-data-silence", { schemaVersion: "1", claims: [], suggestedCommitments: [], limitations: ["证据不足，继续观察"] }, { schemaValid: true, acceptedClaims: 0, policySafe: true, uniqueEvidence: true }),
    make("boundary-07-missing-claim-evidence", review({ ...validClaim, evidence: [] }, validId), { schemaValid: false, acceptedClaims: 0, policySafe: true, uniqueEvidence: true }),
    make("boundary-08-contradicting-context", review({ ...validClaim, evidence: [{ ...validClaim.evidence[0]!, role: "contradicts" }] }, validId), { schemaValid: true, acceptedClaims: 1, policySafe: true, uniqueEvidence: true }),
    make("boundary-09-duplicate-evidence", review({ ...validClaim, evidence: [validClaim.evidence[0]!, validClaim.evidence[0]!] }, validId), { schemaValid: true, acceptedClaims: 1, policySafe: true, uniqueEvidence: false }),
    make("boundary-10-cardinality-limit", { ...review(validClaim, validId), claims: Array.from({ length: 5 }, () => validClaim), suggestedCommitments: ["甲", "乙", "丙"].map((label) => ({ title: `建议${label}`, reason: "保持连续行动", evidenceIds: [validId] })) }, { schemaValid: true, acceptedClaims: 5, policySafe: true, uniqueEvidence: false }),
  ];
}

function review(claim: WeeklyReviewOutput["claims"][number], evidenceId: string): WeeklyReviewOutput {
  return { schemaVersion: "1", claims: [claim], suggestedCommitments: [{ title: "延续下一步", reason: "保持真实行动连续", evidenceIds: [evidenceId] }], limitations: [] };
}

function uuid(index: number): string {
  return `00000000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}
