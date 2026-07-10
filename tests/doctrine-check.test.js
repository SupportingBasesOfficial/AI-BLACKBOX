// tests/doctrine-check.test.js — Tests for the doctrine checker validator

import { describe, it, expect } from "vitest";
import { run } from "../validators/doctrine-check.js";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("doctrine-check", () => {
  it("detects TODO comments as workaround", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "function foo() {\n  // TODO: fix this later\n  return 1;\n}\n");

    const result = await run([file], { requireTests: false });

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.rule === "workaround-comment")).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("detects FIXME comments", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "// FIXME: this is broken\nconst x = 1;\n");

    const result = await run([file], { requireTests: false });

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.rule === "workaround-comment")).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("detects forced casts in TypeScript", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = data as any;\n");

    const result = await run([file], { requireTests: false });

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.rule === "forced-cast")).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("detects as unknown as casts", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = data as unknown as string;\n");

    const result = await run([file], { requireTests: false });

    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.rule === "forced-cast")).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("detects tentative language", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "// maybe this will work\nconst x = 1;\n");

    const result = await run([file], { requireTests: false });

    expect(result.errors.some(e => e.rule === "tentative-language")).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("passes clean code without issues", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "function add(a: number, b: number): number {\n  return a + b;\n}\n");

    const result = await run([file], { requireTests: false });

    expect(result.errors.filter(e => e.severity === "error").length).toBe(0);
    rmSync(tmpDir, { recursive: true });
  });

  it("detects silent catch blocks", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "try {\n  doSomething();\n} catch (e) {\n}\n");

    const result = await run([file], { requireTests: false });

    expect(result.errors.some(e => e.rule === "silent-catch")).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  it("provides ai_hint for each error", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const file = join(tmpDir, "test.ts");
    writeFileSync(file, "const x = data as any;\n");

    const result = await run([file], { requireTests: false });

    for (const err of result.errors) {
      expect(err.ai_hint).toBeDefined();
      expect(err.ai_hint.length).toBeGreaterThan(10);
    }
    rmSync(tmpDir, { recursive: true });
  });
});
