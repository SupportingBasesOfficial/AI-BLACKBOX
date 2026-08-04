// Debug — test all possible import patterns for correlation.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanProject } from "../lib/context-scanner.js";
import { mapArchitecture } from "../lib/architecture-mapper.js";

const importPatterns = [
  // Pattern 1: relative without extension
  "import { correlate } from '../lib/correlation-engine';",
  // Pattern 2: relative with .ts extension
  "import { correlate } from '../lib/correlation-engine.ts';",
  // Pattern 3: relative with .js extension (common in ESM)
  "import { correlate } from '../lib/correlation-engine.js';",
  // Pattern 4: @/ path alias
  "import { correlate } from '@/lib/correlation-engine';",
  // Pattern 5: deeper relative (if route is in a subdirectory)
  "import { correlate } from '../../lib/correlation-engine';",
  // Pattern 6: dynamic import
  "const { correlate } = await import('../lib/correlation-engine');",
  // Pattern 7: require
  "const { correlate } = require('../lib/correlation-engine');",
  // Pattern 8: import type
  "import type { Correlator } from '../lib/correlation-engine';",
  // Pattern 9: mixed import with type
  "import { correlate, type Result } from '../lib/correlation-engine';",
  // Pattern 10: import with trailing slash
  "import { correlate } from '../lib/correlation-engine/';",
  // Pattern 11: @/ with .ts
  "import { correlate } from '@/lib/correlation-engine.ts';",
  // Pattern 12: @/ with .js
  "import { correlate } from '@/lib/correlation-engine.js';",
];

for (let i = 0; i < importPatterns.length; i++) {
  const pattern = importPatterns[i];
  const root = mkdtempSync(join(tmpdir(), `zero-error-corr-${i}-`));

  try {
    mkdirSync(join(root, "apps/api/src/routes"), { recursive: true });
    mkdirSync(join(root, "apps/api/src/lib"), { recursive: true });

    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "test", workspaces: ["apps/*"],
    }));

    writeFileSync(join(root, "apps/api/src/routes/correlation.ts"),
      `${pattern}\nexport function GET() { return correlate(); }\n`);
    writeFileSync(join(root, "apps/api/src/lib/correlation-engine.ts"),
      "export function correlate() { return []; }\n");

    const scan = scanProject(root);
    scan._rootDir = root;
    const arch = mapArchitecture(scan);

    const deleg = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
    const corrViolation = deleg?.violations.find(v => v.file && v.file.includes("correlation"));

    // Also check if correlation-engine is in logic-core
    const logicCoreFiles = arch.layers.logicCore.map(e => e.path);
    const corrEngineInLC = logicCoreFiles.some(p => p.includes("correlation-engine"));

    const status = corrViolation ? "FAIL" : "PASS";
    console.log(`Pattern ${i + 1}: ${status} | LC has engine: ${corrEngineInLC ? "yes" : "no"} | ${pattern.substring(0, 60)}...`);

    if (status === "FAIL") {
      console.log(`  logic-core files: ${logicCoreFiles.join(", ")}`);
      // Debug: check what the resolved path would be
      const routePath = "apps/api/src/routes/correlation.ts";
      const imp = pattern.match(/["']([^"']+)["']/)?.[1];
      if (imp) {
        console.log(`  import: ${imp}`);
        if (imp.startsWith(".")) {
          const dir = routePath.substring(0, routePath.lastIndexOf("/"));
          const parts = (dir + "/" + imp).split("/");
          const resolved = [];
          for (const p of parts) {
            if (p === "" || p === ".") continue;
            if (p === "..") resolved.pop();
            else resolved.push(p);
          }
          const resolvedPath = resolved.join("/");
          console.log(`  resolved: ${resolvedPath}`);
          for (const ext of ["", ".ts", ".js", ".tsx", ".jsx", "/index.ts", "/index.js"]) {
            const candidate = resolvedPath + ext;
            const inLC = logicCoreFiles.includes(candidate);
            console.log(`  check ${candidate}: ${inLC ? "FOUND" : "not found"}`);
          }
        }
      }
    }
  } finally {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}
