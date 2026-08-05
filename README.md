# AI Black Box v16 — Context Engine Universal

A black box that makes any AI-assisted IDE operate under the Zero-Error Doctrine — 100% as the minimum acceptance criterion.

## Quick Start

```bash
# Clone into your project
git clone https://github.com/SupportingBasesOfficial/AI-BLACKBOX.git .zero-error

# Initialize (auto-detects IDE, language, infers Constitution, installs hooks)
node .zero-error/init.js

# Update on changes (re-scans, preserves gates.json and anchors)
node .zero-error/init.js --update

# Force regenerate everything
node .zero-error/init.js --force
```

Open your IDE. The AI now operates under the Doctrine. Zero configuration.

## How It Works

**Three layers:**

1. **Cognitive** — Generates `.cursorrules`, `.windsurfrules`, `.clinerules`, etc. Your IDE injects these into the AI's system prompt automatically. The AI cannot ignore them. Context budget pruned to < 8KB for optimal attention.

2. **Enforcement (Bimodal)** — Git hooks (pre-commit, pre-push) and CI/CD run 15 validators. Code that doesn't pass 100% is blocked. Hard gate, not suggestion. Hooks can be bypassed with `--no-verify`; CI cannot.

3. **Integrity** — SHA-256 hash protection on immutable files (`system-rules.md`, `tech-stack.json`, `source-of-truth.json`). Tampering is detected and blocked.

## What the Doctrine Enforces

- **100% is the floor**, not the ceiling. Below 100%, work is not done.
- **No workarounds.** If the direct solution seems hard, understanding is incomplete.
- **Study before execute.** Flow: ENTENDER → ESTUDAR → PLANEJAR → EXECUTAR → VERIFICAR.
- **Root cause, not symptoms.** Every problem has a cause. Sanar the cause.
- **80/20.** 80% effort in understanding. 20% in execution.
- **Preemption Command.** System rules override any AI suggestion.
- **Prompt Salt.** Micro-anchor re-injects critical rules into AI attention cycle.
- **Payload Rígido.** AI responses must contain 4 sections: Diagnóstico, Alterações, Enforcement, Rollback.

## Validators

15 deterministic validators across 3 gates:

| Validator | Gate | What it checks |
|-----------|------|----------------|
| `type-check` | pre-commit | Compiles and types are correct (tsc, mypy, cargo check, go vet, mvn, sorbet, phpstan, swift build, dart analyze, cmake, mix compile, dotnet build) |
| `lint` | pre-commit | Follows project conventions (ESLint, Ruff, GolangCI, Clippy, Rubocop, PHP-CS-Fixer, SwiftLint, Dart Analyze, Clang-Tidy, Credo, KTLint, Checkstyle) |
| `doctrine-check` | pre-commit | No workarounds, direct path, certainty, Preemption Command, [CHECK:] markers |
| `test` | pre-commit | All tests pass + critical path coverage (Vitest, Jest, Pytest, Cargo test, Go test, JUnit, RSpec, PHPUnit, XCTest, Flutter test, GTest, ExUnit) |
| `security-scan` | pre-commit | SAST (Semgrep) + dependency audit (npm audit, pip-audit, cargo audit, govulncheck, bundle audit, composer audit, dotnet list package --vulnerable) + secrets scan (gitleaks) |
| `contract-check` | pre-commit | Inter-module contracts respected |
| `anchor-check` | pre-commit | @ai-context anchors consistent |
| `tech-debt-check` | pre-commit | Phantom imports, orphan env vars, unused deps, missing @types, uncommitted critical files, circular dependencies, `any` type usage, missing return types, unused exports |
| `context-drift-check` | pre-push | Context files haven't drifted from source code |
| `property-tests` | pre-push | Property-based invariants hold (fast-check, hypothesis, proptest, gopter, jqwik, Kotest, ScalaCheck, SwiftCheck, stream_data, rantly) |
| `impact-analysis` | pre-push | Change blast radius within threshold |
| `schema-sync-check` | pre-push | ORM models match SQL migrations |
| `api-compat-check` | pre-push | API backward compatibility |
| `perf-budget-check` | pre-push | N+1 queries, unpaginated reads, SELECT *, await in loop |
| `mutation-test` | CI | Tests detect mutations (Stryker, mutmut, cargo-mutants, gremlins, PIT, mutant, infection, Stryker.NET, Stryker4s) |

## Architecture Map

The scanner classifies every source file into a 3-layer ontology and generates `architecture-map.md` with 10 sections:

### Layer Classification

| Layer | What goes here | Examples |
|-------|---------------|----------|
| **Ingress** | Entry points — controllers, routes, views, handlers, middleware, components | `app/api/users/route.ts`, `middleware.ts`, `components/widget.tsx` |
| **Logic Core** | Business logic — services, actions, interactors, rules, policies, engines | `services/user-service.ts`, `lib/correlation-engine.ts` |
| **State Store** | Data layer — models, entities, ORM, records, documents, collections, infrastructure packages | `models/user.ts`, `packages/db/src/index.ts`, `packages/cache/src/index.ts` |

### Architecture Map Sections

1. **Monorepo Structure** — detected workspaces and packages
2. **Ingress (Entry Points)** — grouped by subtype (routes, middleware, components, views)
3. **Logic Core (Business Logic)** — services, engines, connectors with integration subtypes
4. **State Store (Data Layer)** — models, ORM, infrastructure packages
5. **Data Flow** — visual flow: Ingress → Logic Core → State Store
6. **Dependency Graph** — cross-layer import edges (Ingress→State, Logic→State, etc.) with violation directions explicitly shown even when zero
7. **File Complexity Analysis** — cyclomatic complexity and LOC per file, flagged when complex
8. **Boundaries** — two boundary rules:
   - **Boundary 1**: Ingress must delegate to Logic Core (not access State Store directly) — severity WARNING
   - **Boundary 2**: Routes must delegate to Logic Core — severity classified as INFO / WARNING / CRITICAL based on file complexity
9. **Critical Paths** — files matching business-critical keywords, grouped by business flow:
   - Authentication (auth, password, token, session, oauth, login, logout)
   - Authorization (permission, role, rbac, acl, access-control)
   - Payment (payment, checkout, invoice, charge, refund, stripe, paypal)
   - Security (security, encrypt, decrypt, vulnerability, cve)
   - Admin (admin, root, superuser, dashboard, config)
   - Data Mutation (transaction, create, delete, update, write)
10. **Feature Flags** — detected flags grouped by provider

### Path Resolution

The scanner resolves all import patterns correctly:
- **Relative imports** (`./foo`, `../lib/bar`) with `.` and `..` normalization
- **Path aliases** (`@/components/widget`) via `tsconfig.json` `compilerOptions.paths` — reads root, `apps/web/`, and `apps/api/` tsconfigs
- **Monorepo packages** (`@repo/db`, `@app/api`) — maps to `packages/{name}/` and `apps/{name}/`
- **Dynamic imports** (`import("...")`, `await import("...")`, `dynamic(() => import("..."))`)
- **Re-exports** (`export { X } from './file'`, `export * from './file'` in `index.ts` barrel files)

## Tech Debt Scanner

The AI Black Box doesn't just scan what's right — it detects what's **invisible and wrong**. 9 categories of technical debt:

| Category | Severity | What it detects |
|----------|----------|----------------|
| `phantom_import` | CRITICAL | `import pg from "pg"` in source code but `pg` not in any dependency file |
| `orphan_env_var` | WARNING | `process.env.DATABASE_URL` referenced in code but not declared in `.env` files |
| `missing_env_file` | INFO | Environment variables referenced but no `.env` file exists |
| `unused_dependency` | INFO | Package declared in dependency file but never imported in any source file |
| `missing_types` | INFO | JS/TS package imported without `@types/` and no bundled types |
| `uncommitted_critical_file` | CRITICAL | Files with `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AWS_ACCESS_KEY_ID`, etc. that may be uncommitted |
| `circular_dependency` | WARNING | Circular import chains (A → B → C → A) |
| `any_type_usage` | WARNING | TypeScript `any` type used (`: any`, `as any`, `<any>`) |
| `missing_return_type` | INFO | TypeScript exported function without explicit return type annotation |
| `unused_export` | WARNING | Exported file that is never imported by any other file |

### Unused Export Detection (Advanced)

The unused export detector has been refined across 9 iterations to achieve ~100% accuracy. It correctly handles:

- **`@/` path aliases** — resolved via `tsconfig.json` paths
- **`@repo/*` and `@app/*` monorepo imports** — mapped to `packages/` and `apps/` directories
- **Dynamic imports** — `import("...")`, `dynamic(() => import("..."))`
- **Re-exports via `index.ts`** — if `index.ts` does `export { X } from './file'`, the file is marked as used
- **Next.js convention files** — `loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `robots.ts`, `sitemap.ts`, `template.tsx`, `default.tsx`, `opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`, `manifest.ts`, `favicon.ico`, `instrumentation.ts` — auto-discovered by Next.js, never explicitly imported
- **CLI scripts** — files with `#!/usr/bin/env node` shebang, in `scripts/` or `bin/` directories, or with known CLI names (`migrate`, `seed`, `setup`, `deploy`, `stress-test`, `gen-*`)
- **Config files** — `*.config.{js,ts,mjs,cjs}`, `eslint*.js`, `vitest.config.*`, `jest.config.*`, `vite.config.*`, `next.config.*`, `tailwind.config.*`, `postcss.config.*`, `prettier.config.*`, `*.d.ts`, `babel.config.*`, `.babelrc`

Generates `tech-debt-report.json` + `tech-debt-report.md` on every scan. Critical findings block pre-commit. The `tech-debt-check` validator enforces this gate.

## Feature Flag Detection

Detects feature flags across 5 providers — no IA calls, pure RegEx heuristics:

| Provider | Detection patterns |
|----------|-------------------|
| **LaunchDarkly** | `ldclient`, `LD_API_KEY`, `variation('flag-name')` |
| **Unleash** | `unleash`, `UNLEASH_URL`, `isEnabled('flag-name')` |
| **env-based** | `process.env.FEATURE_*`, `process.env.ENABLE_*`, `process.env.FLAG_*`, `os.environ.get('FEATURE_*')` |
| **config-based** | `features: { ... }`, `featureFlags: { ... }`, `feature_flags: { ... }`, `flags: { ... }` |
| **conditional** | `if (process.env.X_ENABLED)`, `if (features.flagName)`, `if (featureFlags.flagName)` |

TypeScript type/interface definition blocks are stripped before detection to avoid false positives from schema field names (`id`, `key`, `name`, `type`, `value`, `enabled`, `disabled`, etc.).

Results are integrated into `architecture-map.md` (Feature Flags section) and `shadow-context.md`.

## Multi-Language Support (15 languages)

TypeScript/JS, Python, Go, Rust, Java, Kotlin, Scala, Groovy, C#, Ruby, PHP, Swift, Dart, C/C++, Elixir — imports, env vars, and dependency files are parsed per-language:

- **Python**: `import X`, `from X import Y`, `os.environ.get()`, `os.getenv()` | `requirements.txt`, `pyproject.toml`
- **Go**: `import "pkg"`, `os.Getenv()` | `go.mod`
- **Rust**: `use crate::X`, `std::env::var()` | `Cargo.toml`
- **Java/Kotlin/Scala/Groovy**: `import X;`, `System.getenv()` | `pom.xml`, `build.gradle`
- **C#**: `using X;`, `Environment.GetEnvironmentVariable()` | `.csproj`
- **Ruby**: `require "gem"`, `ENV["VAR"]` | `Gemfile`
- **PHP**: `use Namespace\Class`, `$_ENV["VAR"]`, `getenv()` | `composer.json`
- **Swift**: `import Module`, `ProcessInfo.environment` | `Package.swift`
- **Dart**: `import "package:..."`, `Platform.environment` | `pubspec.yaml`
- **C/C++**: `#include <header>`, `getenv()` | `CMakeLists.txt`
- **Elixir**: `defmodule`, `System.get_env()` | `mix.exs`

## Supported IDEs

Cursor, Windsurf, Cline, VS Code (Copilot), JetBrains, Neovim, Aider — auto-detected.

## Supported Languages

TypeScript/JS, Python, Rust, Go, Java, Kotlin, Scala, Groovy, C#, Ruby, PHP, Swift, Dart, C/C++, Elixir — 15 languages with full stack coverage:

- **Route Detection**: Express, Fastify, NestJS, Next.js (App Router + Pages), Rails, Spring Boot, ASP.NET, Flask, Gin, Echo, Phoenix, Actix, Axum, Polka, Hapi, Hono
- **Component Detection**: React, Vue, Svelte, Solid, Angular, Flutter, SwiftUI, Blazor, Web Components, styled-components, MUI, Tailwind Variants
- **Schema Extraction**: Prisma, TypeORM, Sequelize, Mongoose, Django, SQLAlchemy, Pydantic, JPA, GORM, Entity Framework, ActiveRecord, Eloquent, Doctrine, Diesel, sqlx, CoreData, GRDB, Drift, Floor, Ecto, GraphQL, Supabase RLS, SQL migrations, Protobuf, OpenAPI/Swagger
- **ORM Detection**: Prisma, TypeORM, Sequelize, Mongoose, Django ORM, SQLAlchemy, GORM, JPA, ActiveRecord, Eloquent, Ecto, Diesel, sqlx, Entity Framework, CoreData, Drift
- **Architecture Mapping**: Ingress (controllers, routes, views, handlers, viewsets, gRPC, GraphQL, middleware, components), Logic Core (services, actions, interactors, rules, policies, engines, connectors), State Store (models, entities, ORM, records, documents, collections, infrastructure packages)
- **Monorepo Detection**: pnpm-workspace, turbo, lerna, nx, rush, go.work, Cargo workspace, multi-module Maven, pyproject workspace, composer, pubspec, Package.swift, CMakeLists.txt, mix.exs
- **Dependency Parsing**: `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`, `pubspec.yaml`, `mix.exs`, `CMakeLists.txt`, `.csproj`
- **Type Checkers**: tsc, mypy, cargo check, go vet, Maven, Sorbet, PHPStan, swift build, dart analyze, cmake, mix compile, dotnet build
- **Linters**: ESLint, Ruff, GolangCI, Clippy, Rubocop, PHP-CS-Fixer, SwiftLint, Dart Analyze, Clang-Tidy, Credo, KTLint, Checkstyle
- **Test Frameworks**: Vitest, Jest, Pytest, Cargo test, Go test, JUnit, RSpec, PHPUnit, XCTest, Flutter test, GTest, ExUnit
- **Property Tests**: fast-check, hypothesis, proptest, gopter, jqwik, Kotest property, ScalaCheck, SwiftCheck, stream_data, rantly
- **Mutation Testing**: Stryker, mutmut, cargo-mutants, gremlins, PIT, mutant, infection, Stryker.NET, Stryker4s
- **Dependency Audit**: npm audit, pip-audit, cargo audit, govulncheck, bundle audit, composer audit, dotnet list package --vulnerable
- **Version Detection**: node, npm, python, python3, go, rustc, cargo, java, ruby, php, swift, dart, elixir, kotlinc, gcc, g++, dotnet

## Project Structure

```
.zero-error/
├── init.js                # Bootstrap (21 steps, 3 modes: default, --update, --force)
├── gates.json             # Validator configuration (editable)
├── system-rules.md        # Preemption Command + rules
├── tech-stack.json        # Auto-detected stack + lexical glossary
├── source-of-truth.json   # Immutable project truth
├── architecture-map.md    # 10-section architecture analysis
├── shadow-context.md      # Feature flags + env vars
├── state-context.md       # Current state
├── blackbox-index.json    # Semantic index
├── code-standards.md      # Naming, anti-patterns, security
├── tech-debt-report.json  # 9 categories of tech debt
├── tech-debt-report.md    # Human-readable tech debt report
├── validators/            # 15 deterministic validators
│   ├── type-check.js
│   ├── lint.js
│   ├── doctrine-check.js
│   ├── test.js
│   ├── security-scan.js
│   ├── contract-check.js
│   ├── anchor-check.js
│   ├── tech-debt-check.js
│   ├── context-drift-check.js
│   ├── property-tests.js
│   ├── impact-analysis.js
│   ├── schema-sync-check.js
│   ├── api-compat-check.js
│   ├── perf-budget-check.js
│   ├── mutation-test.js
│   └── index.js
├── lib/                   # 21 modules
│   ├── context-scanner.js       # Deep project scanner (schemas, routes, models, components, env vars)
│   ├── architecture-mapper.js   # 3-layer classification + dependency graph + boundaries + critical paths
│   ├── classification.js        # Token-based scoring classifier
│   ├── tech-debt-scanner.js     # 9 categories of tech debt detection
│   ├── feature-flag-detector.js # 5-provider feature flag detection
│   ├── language-detector.js     # 15-language detection
│   ├── ide-detector.js          # IDE auto-detection
│   ├── context-budget.js        # < 8KB budget pruning
│   ├── lexical-glossary-builder.js  # Domain glossary extraction
│   ├── skeleton-builder.js      # Project skeleton generation
│   ├── rules-generator.js       # IDE-specific rules generation
│   ├── anchor-injector.js       # @ai-context anchor injection
│   ├── prompt-salt.js           # Micro-anchor re-injection
│   ├── integrity-guard.js       # SHA-256 hash protection
│   ├── incremental-updater.js   # --update mode (preserves gates.json + anchors)
│   ├── constitution-inference.js  # Constitution inference from codebase
│   ├── cross-service-tracker.js # Cross-service dependency tracking
│   ├── ontology.js              # Layer ontology definitions
│   ├── tree-sitter.js           # Tree-sitter integration
│   ├── validator-cache.js       # Validator result caching
│   └── validator-contract.js    # Validator contract definitions
├── hooks/                 # Git hooks
│   ├── pre-commit          # 8 validators
│   └── pre-push            # 13 validators
├── .github/workflows/     # CI/CD
│   └── zero-error.yml      # 14 validators (all + mutation-test)
└── tests/                 # 134 unit tests + 39 edge case tests
```

## License

MIT
