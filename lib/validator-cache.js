// lib/validator-cache.js — SHA-256 cache for validator short-circuit
// If a file hasn't changed (same hash), validators return success instantly (0ms).
// Zero IA calls. Pure crypto + file system.

import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const CACHE_VERSION = "v2";

export class ValidatorCache {
  constructor(cacheDir) {
    this.cachePath = join(cacheDir, ".validator-cache.json");
    this.cache = this.loadCache();
    this.pendingUpdates = {};
  }

  loadCache() {
    if (!existsSync(this.cachePath)) {
      return {
        version: CACHE_VERSION,
        entries: {},
      };
    }

    try {
      const data = JSON.parse(readFileSync(this.cachePath, "utf-8"));
      if (data.version !== CACHE_VERSION) {
        return { version: CACHE_VERSION, entries: {} };
      }
      return data;
    } catch {
      return { version: CACHE_VERSION, entries: {} };
    }
  }

  getFileHash(filePath) {
    try {
      const content = readFileSync(filePath);
      return createHash("sha256").update(content).digest("hex");
    } catch {
      return null;
    }
  }

  hasChanged(filePath, validatorName) {
    const currentHash = this.getFileHash(filePath);
    if (!currentHash) return true;

    const cacheKey = `${validatorName}:${filePath}`;
    const cachedEntry = this.cache.entries[cacheKey];

    if (!cachedEntry) return true;
    if (cachedEntry.hash !== currentHash) return true;

    return false;
  }

  shortCircuit(filePath, validatorName) {
    return !this.hasChanged(filePath, validatorName);
  }

  recordValidation(filePath, validatorName, passed, errors = []) {
    const currentHash = this.getFileHash(filePath);
    if (!currentHash) return;

    const cacheKey = `${validatorName}:${filePath}`;
    this.pendingUpdates[cacheKey] = {
      hash: currentHash,
      passed: passed,
      errorCount: errors.length,
      timestamp: Date.now(),
    };
  }

  flush() {
    for (const [key, entry] of Object.entries(this.pendingUpdates)) {
      this.cache.entries[key] = entry;
    }
    this.pendingUpdates = {};
    this.saveCache();
  }

  saveCache() {
    try {
      writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch {
      // Silent fail — cache is optimization, not critical
    }
  }

  clear() {
    this.cache = { version: CACHE_VERSION, entries: {} };
    this.pendingUpdates = {};
    this.saveCache();
  }

  getStats() {
    const entries = Object.keys(this.cache.entries).length;
    const passed = Object.values(this.cache.entries).filter(e => e.passed).length;
    const failed = entries - passed;
    return {
      totalEntries: entries,
      passed: passed,
      failed: failed,
      hitRate: entries > 0 ? `${Math.round((passed / entries) * 100)}%` : "0%",
    };
  }

  invalidateFile(filePath) {
    for (const key of Object.keys(this.cache.entries)) {
      if (key.endsWith(`:${filePath}`)) {
        delete this.cache.entries[key];
      }
    }
    this.saveCache();
  }

  invalidateValidator(validatorName) {
    for (const key of Object.keys(this.cache.entries)) {
      if (key.startsWith(`${validatorName}:`)) {
        delete this.cache.entries[key];
      }
    }
    this.saveCache();
  }
}

export function createCache(zeroErrorDir) {
  return new ValidatorCache(zeroErrorDir);
}
