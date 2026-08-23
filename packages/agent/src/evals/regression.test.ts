import { describe, expect, it } from "vitest";

import { agentEvaluationCases } from "./cases.js";
import { gradeAgentEvaluationCase } from "./grader.js";

describe("30-case weekly trajectory regression suite", () => {
  it("keeps twenty realistic styles and ten boundary cases on their reviewed baselines", async () => {
    expect(agentEvaluationCases).toHaveLength(30);
    expect(agentEvaluationCases.filter((entry) => entry.category === "realistic")).toHaveLength(20);
    expect(agentEvaluationCases.filter((entry) => entry.category === "boundary")).toHaveLength(10);

    const results = await Promise.all(agentEvaluationCases.map(gradeAgentEvaluationCase));
    expect(results.filter((entry) => !entry.meetsBaseline)).toEqual([]);
    expect(results.filter((entry) => entry.schemaValid).every((entry) => entry.acceptedClaims <= 5)).toBe(true);
  });
});
