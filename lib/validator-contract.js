// lib/validator-contract.js — Shared interface for all validators

export class ValidatorResult {
  constructor({ passed, errors = [], warnings = [], duration_ms = 0 }) {
    this.passed = passed;
    this.errors = errors;
    this.warnings = warnings;
    this.duration_ms = duration_ms;
  }
}

export class ValidatorError {
  constructor({ file, line = 0, column = 0, rule, message, ai_hint, severity = "error" }) {
    this.file = file;
    this.line = line;
    this.column = column;
    this.rule = rule;
    this.message = message;
    this.ai_hint = ai_hint;
    this.severity = severity;
  }
}

export function formatFeedback(blockedBy, validatorsFailed) {
  return JSON.stringify({
    zero_error_feedback: {
      blocked_by: blockedBy,
      validators_failed: validatorsFailed,
      action_required: "Corrija os erros acima e faça commit novamente. Cada erro tem um ai_hint com a instrução de correção."
    }
  }, null, 2);
}

export function aggregateResults(results) {
  const allErrors = [];
  const allWarnings = [];
  let allPassed = true;

  for (const result of results) {
    if (!result.passed) allPassed = false;
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return new ValidatorResult({
    passed: allPassed,
    errors: allErrors,
    warnings: allWarnings,
    duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0)
  });
}
