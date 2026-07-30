// validators/tech-debt-check.js — Validates that no critical tech debt exists
// Fails pre-commit if phantom imports or critical findings are detected

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const name = "tech-debt-check";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function validate(files, config = {}) {
  const errors = [];
  const warnings = [];
  const passed = [];

  const zeroErrorDir = join(__dirname, "..");
  const reportPath = join(zeroErrorDir, "tech-debt-report.json");

  if (!existsSync(reportPath)) {
    passed.push("tech-debt-report.json not found — skipping (run init.js to generate)");
    return { errors, warnings, passed, shortCircuit: false };
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf-8"));
  } catch {
    warnings.push("tech-debt-report.json is malformed — cannot validate");
    return { errors, warnings, passed, shortCircuit: false };
  }

  if (!report.findings || report.findings.length === 0) {
    passed.push("No tech debt detected");
    return { errors, warnings, passed, shortCircuit: false };
  }

  const criticals = report.findings.filter(f => f.severity === "critical");
  const warningsList = report.findings.filter(f => f.severity === "warning");

  for (const c of criticals) {
    const label = c.package || c.env_var || c.type;
    errors.push(`[${c.type}] ${label}: ${c.message}`);
  }

  for (const w of warningsList) {
    const label = w.package || w.env_var || w.type;
    warnings.push(`[${w.type}] ${label}: ${w.message}`);
  }

  if (criticals.length === 0) {
    passed.push(`No critical tech debt (${warningsList.length} warnings)`);
  }

  return { errors, warnings, passed, shortCircuit: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validate([], {}).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.errors.length > 0 ? 1 : 0);
  });
}
