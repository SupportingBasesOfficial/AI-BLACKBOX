// tests/constitution-inference.test.js — Tests for Constitution inference

import { describe, it, expect } from "vitest";
import { inferConstitution, renderConstitution } from "../lib/constitution-inference.js";

describe("constitution-inference", () => {
  it("infers basic invariants from clean TypeScript project", () => {
    const scan = {
      files: [
        { path: "src/index.ts", content: "function add(a: number, b: number): number {\n  return a + b;\n}\n" }
      ],
      frameworks: [],
      patterns: [],
      antiPatterns: []
    };
    const constitution = inferConstitution(scan, ["typescript"]);

    expect(constitution.invariants).toContain("Proibido `any` em TypeScript. Use `unknown` + type guard.");
    expect(constitution.prohibitions).toContain("Workarounds (sempre resolver a causa raiz)");
  });

  it("detects when console.log is absent from src", () => {
    const scan = {
      files: [
        { path: "src/index.ts", content: "function foo() { return 1; }\n" }
      ],
      frameworks: [],
      patterns: [],
      antiPatterns: []
    };
    const constitution = inferConstitution(scan, ["typescript"]);
    expect(constitution.invariants).toContain("Proibido `console.log` em produção (usar logger estruturado)");
  });

  it("includes standard prohibitions always", () => {
    const scan = { files: [], frameworks: [], patterns: [], antiPatterns: [] };
    const constitution = inferConstitution(scan, ["unknown"]);

    expect(constitution.prohibitions).toContain("Try/catch vazio ou que silencia erro");
    expect(constitution.prohibitions).toContain("Cast forçado (`as any`, `as unknown as X`)");
    expect(constitution.prohibitions).toContain("Lógica duplicada");
    expect(constitution.prohibitions).toContain("Funções > 50 linhas");
  });

  it("renders Constitution as valid markdown", () => {
    const constitution = {
      invariants: ["Test invariant"],
      standards: ["Linguagem: TypeScript"],
      prohibitions: ["Test prohibition"],
      direction: { objective: "Test", priority: "High", ready: "100%" },
      meta: { version: 1, last_updated: "2024-01-01", updated_by: "test", changelog: ["v1: test"] },
      validation: { requireTests: true, preCommitTimeout: 30, prePushTimeout: 120, ciTimeout: 600, mutationThreshold: 80, coverageThreshold: 80 }
    };
    const md = renderConstitution(constitution);

    expect(md).toContain("# CONSTITUTION");
    expect(md).toContain("Test invariant");
    expect(md).toContain("Linguagem: TypeScript");
    expect(md).toContain("Test prohibition");
    expect(md).toContain("requireTests: true");
  });

  it("includes validation config", () => {
    const scan = { files: [], frameworks: [], patterns: [], antiPatterns: [] };
    const constitution = inferConstitution(scan, ["unknown"]);

    expect(constitution.validation.requireTests).toBe(true);
    expect(constitution.validation.preCommitTimeout).toBe(30);
    expect(constitution.validation.mutationThreshold).toBe(80);
  });
});
