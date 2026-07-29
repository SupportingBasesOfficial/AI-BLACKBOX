// lib/feature-flag-detector.js — Detects feature flags in the project
// Zero IA calls. Pure RegEx heuristics.
// Supports: LaunchDarkly, Unleash, custom env-based, config-based flags.

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, extname, relative, sep } from "path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", "build", "dist",
  ".next", ".nuxt", "__pycache__", "target", "bin",
  ".zero-error", ".gradle", ".cache",
]);

const LAUNCHDARKLY_PATTERNS = [
  { regex: /launchdarkly|ldclient/i, provider: "LaunchDarkly" },
  { regex: /LD_API_KEY|LAUNCHDARKLY_KEY/i, provider: "LaunchDarkly" },
  { regex: /variation\s*\(\s*['"`]([^'"`]+)['"`]/g, provider: "LaunchDarkly", captures: true },
];

const UNLEASH_PATTERNS = [
  { regex: /unleash/i, provider: "Unleash" },
  { regex: /UNLEASH_URL|UNLEASH_TOKEN/i, provider: "Unleash" },
  { regex: /isEnabled\s*\(\s*['"`]([^'"`]+)['"`]/g, provider: "Unleash", captures: true },
];

const ENV_FLAG_PATTERNS = [
  { regex: /process\.env\.FEATURE_(\w+)/g, provider: "env-based", captures: true },
  { regex: /process\.env\.ENABLE_(\w+)/g, provider: "env-based", captures: true },
  { regex: /process\.env\.FLAG_(\w+)/g, provider: "env-based", captures: true },
  { regex: /os\.environ\.get\s*\(\s*['"`]FEATURE_(\w+)/g, provider: "env-based", captures: true },
  { regex: /os\.getenv\s*\(\s*['"`]FEATURE_(\w+)/g, provider: "env-based", captures: true },
  { regex: /System\.getenv\s*\(\s*['"`]FEATURE_(\w+)/g, provider: "env-based", captures: true },
];

const CONFIG_FLAG_PATTERNS = [
  { regex: /features?\s*:\s*\{([^}]*)\}/gi, provider: "config-based", captures: true },
  { regex: /featureFlags\s*:\s*\{([^}]*)\}/gi, provider: "config-based", captures: true },
  { regex: /feature_flags\s*:\s*\{([^}]*)\}/gi, provider: "config-based", captures: true },
  { regex: /flags\s*:\s*\{([^}]*)\}/gi, provider: "config-based", captures: true },
];

const CONDITIONAL_FLAG_PATTERNS = [
  { regex: /if\s*\(\s*process\.env\.(\w+_ENABLED|FEATURE_\w+|FLAG_\w+)/g, provider: "conditional", captures: true },
  { regex: /if\s*\(\s*features?\.\s*(\w+)\s*\)/g, provider: "conditional", captures: true },
  { regex: /if\s*\(\s*featureFlags?\.\s*(\w+)\s*\)/g, provider: "conditional", captures: true },
  { regex: /if\s*\(\s*flags?\.\s*(\w+)\s*\)/g, provider: "conditional", captures: true },
];

export function detectFeatureFlags(rootDir) {
  const flags = new Map();
  const providers = new Set();

  scanForFlags(rootDir, rootDir, 0, 12, flags, providers);

  const flagList = Array.from(flags.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    flags: flagList,
    providers: Array.from(providers).sort(),
    totalFlags: flagList.length,
  };
}

function scanForFlags(rootDir, currentDir, depth, maxDepth, flags, providers) {
  if (depth > maxDepth) return;

  let entries = [];
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;

    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      scanForFlags(rootDir, fullPath, depth + 1, maxDepth, flags, providers);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      const codeExts = [".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java", ".rs", ".json", ".yaml", ".yml", ".env"];
      if (!codeExts.includes(ext)) continue;

      const content = safeRead(fullPath);
      if (!content) continue;

      extractFlagsFromContent(content, relPath, flags, providers);
    }
  }
}

function extractFlagsFromContent(content, filePath, flags, providers) {
  const allPatterns = [
    ...LAUNCHDARKLY_PATTERNS,
    ...UNLEASH_PATTERNS,
    ...ENV_FLAG_PATTERNS,
    ...CONFIG_FLAG_PATTERNS,
    ...CONDITIONAL_FLAG_PATTERNS,
  ];

  for (const { regex, provider, captures } of allPatterns) {
    if (captures) {
      let m;
      const re = new RegExp(regex.source, regex.flags);
      while ((m = re.exec(content)) !== null) {
        const flagName = m[1] || m[2] || extractFlagFromContext(m[0]);
        if (flagName && flagName.length > 1) {
          providers.add(provider);
          addFlag(flags, flagName, provider, filePath);
        }
      }
    } else {
      const re = new RegExp(regex.source, regex.flags);
      if (re.test(content)) {
        providers.add(provider);
      }
    }
  }

  if (filePath.endsWith(".env") || filePath.includes(".env.")) {
    const envFlagMatches = content.matchAll(/^FEATURE_(\w+)=/gm);
    for (const m of envFlagMatches) {
      providers.add("env-based");
      addFlag(flags, `FEATURE_${m[1]}`, "env-based", filePath);
    }
    const envEnabledMatches = content.matchAll(/^ENABLE_(\w+)=/gm);
    for (const m of envEnabledMatches) {
      providers.add("env-based");
      addFlag(flags, `ENABLE_${m[1]}`, "env-based", filePath);
    }
  }
}

function extractFlagFromContext(matchText) {
  const parts = matchText.split(/[\s.{}()'"\[\]:=]+/);
  for (const part of parts) {
    if (part.length > 2 && part !== "process" && part !== "env" && part !== "features" &&
        part !== "featureFlags" && part !== "flags" && part !== "if" && part !== "isEnabled" &&
        part !== "variation") {
      return part;
    }
  }
  return null;
}

function addFlag(flags, name, provider, filePath) {
  const key = name.toUpperCase();
  if (!flags.has(key)) {
    flags.set(key, {
      name: name,
      provider: provider,
      files: [filePath],
    });
  } else {
    const existing = flags.get(key);
    if (!existing.files.includes(filePath)) {
      existing.files.push(filePath);
    }
  }
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function generateFeatureFlagsSection(flagResult) {
  if (flagResult.totalFlags === 0) {
    return "## Feature Flags Ativas\n- Nenhuma feature flag detectada no projeto.\n";
  }

  const lines = ["## Feature Flags Ativas", ""];

  const byProvider = {};
  for (const flag of flagResult.flags) {
    if (!byProvider[flag.provider]) byProvider[flag.provider] = [];
    byProvider[flag.provider].push(flag);
  }

  for (const [provider, providerFlags] of Object.entries(byProvider).sort()) {
    lines.push(`### ${provider}`);
    for (const flag of providerFlags) {
      lines.push(`- **${flag.name}**: usada em ${flag.files.length} ficheiro(s) (${flag.files.slice(0, 3).join(", ")}${flag.files.length > 3 ? "..." : ""})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
