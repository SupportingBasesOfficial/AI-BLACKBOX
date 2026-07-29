// validators/context-drift-check.js — Validates AI response follows Payload Rigid (4 sections)
// + checks for Prompt Salt + checkpoints + valid markers
// Zero IA calls. Pure RegEx.

import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

const REQUIRED_SECTIONS = [
  { pattern: /###\s*1\.?\s*DIAGNÓSTICO/i, name: "Diagnóstico de Impacto" },
  { pattern: /###\s*2\.?\s*ALTERAÇÕES/i, name: "Alterações Propostas" },
  { pattern: /###\s*3\.?\s*ENFORCEMENT/i, name: "Enforcement de Testes" },
  { pattern: /###\s*4\.?\s*PLANO\s+DE\s+ROLLBACK/i, name: "Plano de Rollback" },
];

const SALT_PATTERN = /<!--\s*@ai-salt:\s*rules=([^|]+)\s*\|\s*v=2\s*-->/;

const VALID_MARKERS = [
  /\[NEED_EVIDENCE:[^\]]+\]/,
  /\[CRITICAL_AMBIGUITY:[^\]]+\]/,
];

const CHECKPOINT_PATTERN = /\/\/\s*\[CHECK:\s*[^\]]+\]/;

const FORBIDDEN_PATTERNS = [
  { regex: /\btalvez\b/i, rule: "tentative-language", hint: 'Replace "talvez" with definitive action or [NEED_EVIDENCE:...]' },
  { regex: /\bacho\s+que\b/i, rule: "tentative-language", hint: 'Replace "acho que" with definitive action or [NEED_EVIDENCE:...]' },
  { regex: /\bpode\s+ser\s+que\b/i, rule: "tentative-language", hint: 'Replace "pode ser que" with definitive action or [NEED_EVIDENCE:...]' },
  { regex: /\bvou\s+tentar\b/i, rule: "tentative-language", hint: 'Replace "vou tentar" with definitive action' },
  { regex: /\bmaybe\b/i, rule: "tentative-language", hint: 'Replace "maybe" with definitive action or [NEED_EVIDENCE:...]' },
  { regex: /\bi\s+think\b/i, rule: "tentative-language", hint: 'Replace "I think" with definitive action or [NEED_EVIDENCE:...]' },
  { regex: /\bmight\s+work\b/i, rule: "tentative-language", hint: 'Replace "might work" with definitive action' },
];

export const name = "context-drift-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const responseText = config.responseText || "";

  if (!responseText || responseText.trim().length === 0) {
    return new ValidatorResult({
      passed: true,
      errors: [],
      warnings: [],
      duration_ms: Date.now() - startTime,
    });
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!section.pattern.test(responseText)) {
      errors.push(new ValidatorError({
        file: "ai-response",
        line: 0,
        rule: "payload-missing-section",
        message: `Payload Rigid missing section: "${section.name}"`,
        ai_hint: `Add section: ### ${section.name}`,
        severity: "error",
      }));
    }
  }

  const saltMatch = responseText.match(SALT_PATTERN);
  if (!saltMatch) {
    warnings.push(new ValidatorError({
      file: "ai-response",
      line: 0,
      rule: "prompt-salt-missing",
      message: "Prompt Salt (@ai-salt) not found at end of response",
      ai_hint: "Add: <!-- @ai-salt: rules=preemption=xxx,perf-budget=xxx,critical-paths=xxx,rollback=xxx,feature-flags=xxx | v=2 -->",
      severity: "warning",
    }));
  } else {
    const ruleParts = saltMatch[1].split(",");
    const ruleIds = ruleParts.map(p => p.split("=")[0].trim());
    const expectedIds = ["preemption", "perf-budget", "critical-paths", "rollback", "feature-flags"];
    const missing = expectedIds.filter(id => !ruleIds.includes(id));
    if (missing.length > 0) {
      warnings.push(new ValidatorError({
        file: "ai-response",
        line: 0,
        rule: "prompt-salt-incomplete",
        message: `Prompt Salt missing rules: ${missing.join(", ")}`,
        ai_hint: `Add missing rule hashes to @ai-salt`,
        severity: "warning",
      }));
    }
  }

  const hasCheckpoints = CHECKPOINT_PATTERN.test(responseText);
  const hasCodeBlocks = /```/.test(responseText);
  if (hasCodeBlocks && !hasCheckpoints) {
    warnings.push(new ValidatorError({
      file: "ai-response",
      line: 0,
      rule: "checkpoint-missing",
      message: "Code blocks detected but no // [CHECK: ...] checkpoints found",
      ai_hint: "Add // [CHECK: rule] at each logical block in generated code",
      severity: "warning",
    }));
  }

  for (const { regex, rule, hint } of FORBIDDEN_PATTERNS) {
    const matches = responseText.match(new RegExp(regex.source, regex.flags + "g"));
    if (matches) {
      errors.push(new ValidatorError({
        file: "ai-response",
        line: 0,
        rule: rule,
        message: `Tentative language detected: "${matches[0]}" (${matches.length} occurrence(s))`,
        ai_hint: hint,
        severity: "error",
      }));
    }
  }

  return new ValidatorResult({
    passed: errors.length === 0,
    errors,
    warnings,
    duration_ms: Date.now() - startTime,
  });
}
