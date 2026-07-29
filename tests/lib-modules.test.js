// tests/lib-modules.test.js — Unit tests for v2 lib modules
import { describe, it, assert } from "node:test";
import { normalizeConcept, normalizeStackName, getLayerForFile, getAllLayers, getSublayers } from "../lib/ontology.js";
import { generatePromptSalt, validateSaltPresence, getSaltInstruction } from "../lib/prompt-salt.js";
import { ValidatorCache } from "../lib/validator-cache.js";

describe("ontology.js", () => {
  it("normalizeConcept: maps controller to ingress", () => {
    const result = normalizeConcept("controller");
    assert.equal(result.layer, "ingress");
    assert.equal(result.normalized, "Controller");
  });

  it("normalizeConcept: maps repository to logic-core/data-access", () => {
    const result = normalizeConcept("repository");
    assert.equal(result.layer, "logic-core");
    assert.equal(result.sublayer, "data-access");
  });

  it("normalizeConcept: maps model to state-store", () => {
    const result = normalizeConcept("model");
    assert.equal(result.layer, "state-store");
  });

  it("normalizeConcept: returns unclassified for unknown term", () => {
    const result = normalizeConcept("xyzunknown");
    assert.equal(result.layer, "unclassified");
  });

  it("normalizeStackName: maps prisma to ORM", () => {
    const result = normalizeStackName("prisma");
    assert.equal(result, "ORM (Prisma)");
  });

  it("normalizeStackName: maps express to Web Framework", () => {
    const result = normalizeStackName("express");
    assert.equal(result, "Web Framework (Express)");
  });

  it("getLayerForFile: classifies controller.ts", () => {
    const result = getLayerForFile("src/controllers/user.controller.ts", "user.controller.ts");
    assert.equal(result.layer, "ingress");
  });

  it("getAllLayers: returns 4 layers", () => {
    const layers = getAllLayers();
    assert.equal(layers.length, 4);
    assert.ok(layers.includes("ingress"));
    assert.ok(layers.includes("logic-core"));
    assert.ok(layers.includes("state-store"));
  });

  it("getSublayers: returns sublayers for logic-core", () => {
    const sublayers = getSublayers();
    assert.ok(sublayers["logic-core"].includes("business"));
    assert.ok(sublayers["logic-core"].includes("data-access"));
  });
});

describe("prompt-salt.js", () => {
  it("generatePromptSalt: produces salt with 5 rule hashes", () => {
    const result = generatePromptSalt("Este repositório opera sob protocolo restrito.", '{"critical_paths":[]}', "no N+1 queries");
    assert.ok(result.salt.includes("@ai-salt"));
    assert.ok(result.salt.includes("v=2"));
    assert.equal(result.hashes.length, 5);
    assert.ok(result.hashes.some(h => h.id === "preemption"));
    assert.ok(result.hashes.some(h => h.id === "perf-budget"));
    assert.ok(result.hashes.some(h => h.id === "rollback"));
  });

  it("validateSaltPresence: detects missing salt", () => {
    const result = validateSaltPresence("some response without salt");
    assert.equal(result.present, false);
    assert.ok(result.warning);
  });

  it("validateSaltPresence: detects present salt", () => {
    const text = "response\n<!-- @ai-salt: rules=preemption=abc12345,perf-budget=def67890,critical-paths=ghi13579,rollback=jkl24680,feature-flags=mno14703 | v=2 -->";
    const result = validateSaltPresence(text);
    assert.equal(result.present, true);
    assert.equal(result.warning, null);
  });

  it("validateSaltPresence: detects incomplete salt", () => {
    const text = "response\n<!-- @ai-salt: rules=preemption=abc12345 | v=2 -->";
    const result = validateSaltPresence(text);
    assert.equal(result.present, true);
    assert.ok(result.warning);
    assert.ok(result.warning.includes("perf-budget"));
  });

  it("getSaltInstruction: returns instruction text", () => {
    const instruction = getSaltInstruction();
    assert.ok(instruction.includes("@ai-salt"));
    assert.ok(instruction.includes("context-drift-check"));
  });
});

describe("validator-cache.js", () => {
  it("ValidatorCache: starts empty", () => {
    const cache = new ValidatorCache("./tmp-test-cache");
    const stats = cache.getStats();
    assert.equal(stats.totalEntries, 0);
  });

  it("ValidatorCache: detects changed file on first run", () => {
    const cache = new ValidatorCache("./tmp-test-cache");
    assert.ok(cache.hasChanged("nonexistent.js", "test-validator"));
  });

  it("ValidatorCache: shortCircuit returns false for new file", () => {
    const cache = new ValidatorCache("./tmp-test-cache");
    assert.equal(cache.shortCircuit("nonexistent.js", "test-validator"), false);
  });

  it("ValidatorCache: clear resets entries", () => {
    const cache = new ValidatorCache("./tmp-test-cache");
    cache.clear();
    assert.equal(cache.getStats().totalEntries, 0);
  });
});
