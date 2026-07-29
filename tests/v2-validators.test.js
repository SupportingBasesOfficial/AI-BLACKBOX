// tests/v2-validators.test.js — Tests for v2 validators (perf-budget, context-drift)
import { describe, it, assert } from "node:test";
import { run as contextDriftRun } from "../validators/context-drift-check.js";

describe("context-drift-check.js", () => {
  it("fails when all 4 Payload sections are missing", async () => {
    const result = await contextDriftRun({ responseText: "just some code without structure" });
    assert.equal(result.passed, false);
    assert.ok(result.errors.some(e => e.rule === "payload-missing-section"));
  });

  it("passes when all 4 sections + salt + checkpoints present", async () => {
    const text = [
      "### 1. DIAGNÓSTICO DE IMPACTO & CONTROLE DE RISCO",
      "* Ficheiros: test.ts",
      "### 2. ALTERAÇÕES PROPOSTAS",
      "```ts",
      "// [CHECK: perf-budget]",
      "const x = 1;",
      "```",
      "### 3. ENFORCEMENT DE TESTES",
      "* Caminho: Auth",
      "### 4. PLANO DE ROLLBACK",
      "* Desativar flag X",
      "<!-- @ai-salt: rules=preemption=a,perf-budget=b,critical-paths=c,rollback=d,feature-flags=e | v=2 -->",
    ].join("\n");
    const result = await contextDriftRun({ responseText: text });
    assert.equal(result.passed, true);
  });

  it("detects tentative language (talvez)", async () => {
    const text = "### 1. DIAGNÓSTICO\n### 2. ALTERAÇÕES\n### 3. ENFORCEMENT\n### 4. ROLLBACK\ntalvez funcione";
    const result = await contextDriftRun({ responseText: text });
    assert.equal(result.passed, false);
    assert.ok(result.errors.some(e => e.rule === "tentative-language"));
  });

  it("warns when Prompt Salt is missing", async () => {
    const text = "### 1. DIAGNÓSTICO\n### 2. ALTERAÇÕES\n### 3. ENFORCEMENT\n### 4. ROLLBACK";
    const result = await contextDriftRun({ responseText: text });
    assert.ok(result.warnings.some(w => w.rule === "prompt-salt-missing"));
  });

  it("passes with empty response", async () => {
    const result = await contextDriftRun({ responseText: "" });
    assert.equal(result.passed, true);
  });

  it("warns when code blocks exist but no checkpoints", async () => {
    const text = "### 1. DIAGNÓSTICO\n### 2. ALTERAÇÕES\n```ts\nconst x = 1;\n```\n### 3. ENFORCEMENT\n### 4. ROLLBACK";
    const result = await contextDriftRun({ responseText: text });
    assert.ok(result.warnings.some(w => w.rule === "checkpoint-missing"));
  });
});
