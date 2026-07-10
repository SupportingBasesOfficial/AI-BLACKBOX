// tests/ide-detection.test.js — Tests for IDE auto-detection

import { describe, it, expect } from "vitest";
import { detectIDE, IDE_RULES_MAP, ALL_IDES } from "../lib/ide-detector.js";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ide-detector", () => {
  it("detects cursor via .cursor/ directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    mkdirSync(join(tmpDir, ".cursor"));
    const ide = detectIDE(tmpDir);
    expect(ide).toBe("cursor");
    rmSync(tmpDir, { recursive: true });
  });

  it("detects windsurf via .windsurf/ directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    mkdirSync(join(tmpDir, ".windsurf"));
    const ide = detectIDE(tmpDir);
    expect(ide).toBe("windsurf");
    rmSync(tmpDir, { recursive: true });
  });

  it("detects vscode via .vscode/ directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    mkdirSync(join(tmpDir, ".vscode"));
    const ide = detectIDE(tmpDir);
    expect(ide).toBe("vscode");
    rmSync(tmpDir, { recursive: true });
  });

  it("detects jetbrains via .idea/ directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    mkdirSync(join(tmpDir, ".idea"));
    const ide = detectIDE(tmpDir);
    expect(ide).toBe("jetbrains");
    rmSync(tmpDir, { recursive: true });
  });

  it("falls back to 'all' when no IDE detected", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ze-test-"));
    const ide = detectIDE(tmpDir);
    expect(ide).toBe("all");
    rmSync(tmpDir, { recursive: true });
  });

  it("has rules map for all known IDEs", () => {
    for (const ide of ALL_IDES) {
      expect(IDE_RULES_MAP[ide]).toBeDefined();
    }
  });
});
