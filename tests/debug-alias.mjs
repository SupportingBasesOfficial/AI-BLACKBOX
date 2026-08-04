// Debug alias resolution
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "zero-error-alias-debug-"));
try {
  mkdirSync(join(root, "apps/web/components"), { recursive: true });
  mkdirSync(join(root, "apps/web/app/dashboard"), { recursive: true });

  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: { "@/*": ["apps/web/*"] },
    },
  }));

  writeFileSync(join(root, "apps/web/components/widget.tsx"),
    "export function Widget() { return null; }\n");
  writeFileSync(join(root, "apps/web/app/dashboard/page.tsx"),
    "import { Widget } from '@/components/widget';\nexport default function Page() { return null; }\n");

  // List what's in the root
  console.log("root contents:", readdirSync(root));
  console.log("apps contents:", readdirSync(join(root, "apps")));
  console.log("apps/web contents:", readdirSync(join(root, "apps/web")));

  const { scanTechDebt } = await import("../lib/tech-debt-scanner.js");
  const scan = { _rootDir: root, allScannedFiles: [], monorepo: false, envVars: [] };
  const result = scanTechDebt(root, scan);
  console.log("files_scanned:", result.summary.files_scanned);
  console.log("total findings:", result.findings.length);
  const unusedFindings = result.findings.filter(f => f.type === "unused_export");
  console.log("unused findings:", JSON.stringify(unusedFindings, null, 2));

  // Now test with dead-widget that should be flagged
  writeFileSync(join(root, "apps/web/components/dead-widget.tsx"),
    "export function DeadWidget() { return null; }\n");
  const result2 = scanTechDebt(root, scan);
  const unused2 = result2.findings.filter(f => f.type === "unused_export");
  console.log("\nWith dead-widget:");
  console.log("files_scanned:", result2.summary.files_scanned);
  console.log("unused findings:", JSON.stringify(unused2, null, 2));
} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

