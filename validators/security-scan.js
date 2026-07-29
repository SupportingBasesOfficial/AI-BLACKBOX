// validators/security-scan.js — SAST + dependency audit + secrets scan

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "security-scan";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();

  // 1. Secrets scan (gitleaks or regex fallback)
  const secretErrors = await scanSecrets(files, cwd);
  errors.push(...secretErrors);

  // 2. Dependency audit
  const depErrors = await auditDependencies(cwd);
  errors.push(...depErrors);

  // 3. SAST (Semgrep if available)
  const sastErrors = await runSAST(cwd);
  errors.push(...sastErrors);

  return new ValidatorResult({
    passed: errors.filter(e => e.severity === "error").length === 0,
    errors,
    duration_ms: Date.now() - startTime
  });
}

async function scanSecrets(files, cwd) {
  const errors = [];

  // Try gitleaks first
  try {
    const output = execSync("gitleaks detect --source . --report-format json --report-path /dev/stdout 2>/dev/null || true", {
      cwd, encoding: "utf-8", timeout: 15000
    });
    if (output.trim()) {
      const findings = JSON.parse(output);
      for (const f of findings) {
        errors.push(new ValidatorError({
          file: f.File || "", line: f.StartLine || 0,
          rule: f.RuleID || "secret-detected",
          message: `Secret detectado: ${f.Description || f.RuleID}`,
          ai_hint: `Secret detectado em ${f.File}:${f.StartLine}. Remova o secret e use variáveis de ambiente ou um secret manager.`,
          severity: "error"
        }));
      }
    }
    return errors;
  } catch {}

  // Fallback: regex-based secret detection
  const secretPatterns = [
    { pattern: /(?:sk-|pk_)[a-zA-Z0-9]{20,}/g, name: "API key (Stripe/OpenAI)" },
    { pattern: /AKIA[A-Z0-9]{16}/g, name: "AWS Access Key" },
    { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: "GitHub Personal Access Token" },
    { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, name: "Private Key" },
    { pattern: /(?:mongodb|postgres|redis|amqp):\/\/[^\s]+:[^\s]+@/g, name: "Connection string with credentials" },
    { pattern: /(?:Bearer\s+)[a-zA-Z0-9._-]+/g, name: "Bearer token" },
  ];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf-8");
    } catch { continue; }

    for (const { pattern, name } of secretPatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        const line = content.substring(0, match.index).split("\n").length;
        errors.push(new ValidatorError({
          file, line, rule: "secret-detected",
          message: `Secret detectado: ${name}`,
          ai_hint: `${name} detectado em ${file}:${line}. Remova o secret e use variáveis de ambiente.`,
          severity: "error"
        }));
      }
    }
  }

  return errors;
}

async function auditDependencies(cwd) {
  const errors = [];

  if (existsSync(join(cwd, "package.json"))) {
    try {
      const output = execSync("npm audit --json 2>/dev/null || true", {
        cwd, encoding: "utf-8", timeout: 30000
      });
      const audit = JSON.parse(output);
      const vulns = audit.vulnerabilities || {};
      for (const [pkg, info] of Object.entries(vulns)) {
        if (info.severity === "critical" || info.severity === "high") {
          errors.push(new ValidatorError({
            file: "package.json", line: 0,
            rule: "dependency-vulnerability",
            message: `Vulnerabilidade ${info.severity} em ${pkg}`,
            ai_hint: `Vulnerabilidade ${info.severity} detectada em ${pkg}. Execute 'npm audit fix' ou atualize a dependência.`,
            severity: info.severity === "critical" ? "error" : "warning"
          }));
        }
      }
    } catch {}
  }

  if (existsSync(join(cwd, "requirements.txt"))) {
    try {
      const output = execSync("pip-audit -r requirements.txt --format json 2>/dev/null || true", {
        cwd, encoding: "utf-8", timeout: 30000
      });
      const audit = JSON.parse(output);
      for (const dep of audit.dependencies || []) {
        for (const vuln of dep.vulns || []) {
          errors.push(new ValidatorError({
            file: "requirements.txt", line: 0,
            rule: "dependency-vulnerability",
            message: `Vulnerabilidade em ${dep.name}: ${vuln.id}`,
            ai_hint: `Vulnerabilidade ${vuln.id} em ${dep.name}. Atualize para uma versão segura.`,
            severity: "error"
          }));
        }
      }
    } catch {}
  }

  return errors;
}

async function runSAST(cwd) {
  const errors = [];

  try {
    const output = execSync("semgrep --json 2>/dev/null || true", {
      cwd, encoding: "utf-8", timeout: 30000
    });
    const results = JSON.parse(output);
    for (const finding of results.results || []) {
      errors.push(new ValidatorError({
        file: finding.path || "",
        line: finding.start?.line || 0,
        rule: finding.check_id || "semgrep",
        message: finding.extra?.message || "SAST finding",
        ai_hint: `${finding.extra?.message || "Issue detectado"} em ${finding.path}:${finding.start?.line}. Corrija conforme a regra ${finding.check_id}.`,
        severity: finding.extra?.severity === "ERROR" ? "error" : "warning"
      }));
    }
  } catch {}

  return errors;
}
