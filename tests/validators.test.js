// tests/validators.test.js — Tests for validator contract and aggregation

import { describe, it, expect } from "vitest";
import { ValidatorResult, ValidatorError, formatFeedback, aggregateResults } from "../lib/validator-contract.js";

describe("validator-contract", () => {
  it("creates ValidatorResult with correct defaults", () => {
    const result = new ValidatorResult({ passed: true });
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.duration_ms).toBe(0);
  });

  it("creates ValidatorError with all fields", () => {
    const error = new ValidatorError({
      file: "test.ts",
      line: 42,
      rule: "test-rule",
      message: "Test error",
      ai_hint: "Fix the test error",
      severity: "error"
    });
    expect(error.file).toBe("test.ts");
    expect(error.line).toBe(42);
    expect(error.rule).toBe("test-rule");
    expect(error.ai_hint).toBe("Fix the test error");
  });

  it("aggregates multiple validator results", () => {
    const results = [
      new ValidatorResult({ passed: true, errors: [], duration_ms: 100 }),
      new ValidatorResult({
        passed: false,
        errors: [new ValidatorError({ file: "a.ts", rule: "err", message: "fail", ai_hint: "fix" })],
        duration_ms: 200
      }),
    ];
    const aggregated = aggregateResults(results);
    expect(aggregated.passed).toBe(false);
    expect(aggregated.errors.length).toBe(1);
    expect(aggregated.duration_ms).toBe(300);
  });

  it("formats feedback JSON with ai_hints", () => {
    const feedback = formatFeedback("pre-commit", [
      {
        validator: "doctrine-check",
        errors: [
          new ValidatorError({
            file: "src/test.ts", line: 10,
            rule: "workaround-comment",
            message: "TODO found",
            ai_hint: "Remove the TODO"
          })
        ]
      }
    ]);
    const parsed = JSON.parse(feedback);
    expect(parsed.zero_error_feedback.blocked_by).toBe("pre-commit");
    expect(parsed.zero_error_feedback.validators_failed[0].errors[0].ai_hint).toBe("Remove the TODO");
  });
});
