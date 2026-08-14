# AGENTS.md

## Scope

These instructions apply to the entire repository. Follow more specific `AGENTS.md` files if a subdirectory adds one.

## Project context

This project is a NestJS 10 backend written in strict TypeScript. It uses Prisma with PostgreSQL, JWT and Passport authentication, bcrypt password hashing, class-validator DTOs, Jest, Supertest, ESLint, and Prettier.

Keep feature code grouped under `src/modules/<feature>`. Shared infrastructure belongs under `src/common`. Prisma schema, migrations, and seed code belong under `prisma`.

Before editing, inspect the relevant module, its tests, the Prisma schema when data is involved, and existing repository conventions. Preserve unrelated user changes in the working tree.

## Mandatory task behavior

1. At the beginning of every user task, activate and follow the `caveman` skill at `wenyan-ultra` intensity. Keep that mode active until the user explicitly says `stop caveman`, `normal mode`, or selects another caveman intensity. This affects chat responses only; code, comments, documentation, commit messages, and other persisted text remain normal and readable.
2. Determine the task type from the prompt and use the smallest matching skill set from the catalog below. Read every selected skill's `SKILL.md` completely before acting.
3. Whenever the prompt involves writing, reviewing, debugging, testing, or refactoring NestJS code, also use `nestjs-best-practices`. Read only the detailed rule files relevant to the task; prioritize architecture, dependency injection, error handling, security, and database correctness.
4. If several skills apply, use them in this order: communication mode, task-method skill, framework skill, specialized Caveman Cloud skill, then verification skill.
5. State which selected skills are being used and why before taking task actions, except where an applicable skill explicitly forbids tool-call narration. Mention any skill-imposed pause, approval gate, or safety restriction.
6. Do not invoke every skill mechanically. Route from the user's intent using the catalog. User instructions override skill defaults unless they conflict with safety requirements.
7. Finish changes with focused verification. Report exact passes, failures, unavailable checks, and remaining risks. Do not claim checks that were not run.

## NestJS engineering rules

Apply these whenever NestJS code is in scope:

- Organize code by feature module. Keep controllers thin and business rules in focused injectable services.
- Prefer constructor injection. Export only providers that other modules genuinely consume. Avoid circular dependencies, service locators, and duplicate provider registration.
- Validate all external input through DTOs and pipes. Use guards for authentication and authorization, interceptors for cross-cutting response behavior, and exception filters for centralized error translation.
- Never expose password hashes, tokens, verification codes, secrets, or internal persistence fields in API responses or logs.
- Keep environment access behind configuration services. Validate required production configuration and avoid hard-coded secrets.
- Use Prisma transactions for multi-write invariants. Avoid N+1 queries, unbounded reads, and schema changes without migrations.
- Add focused unit tests for service behavior and Supertest coverage for important HTTP contracts. Mock external services such as mail, OAuth, and third-party APIs.
- Preserve graceful shutdown, health checks, structured logging, and rate limits when changing application bootstrap or infrastructure.

## Skill routing catalog

All repository-local skills live in `.agents/skills/<skill>/SKILL.md`.

### Core work methods

- `investigate-first`: Use for ambiguous, intermittent, performance, or unknown-cause failures. Gather evidence, separate symptoms from hypotheses, identify a credible mechanism, and diagnose without implementing unless the prompt also authorizes a fix.
- `lean-build`: Use for new features or integrations with overbuilding risk. Define observable acceptance and non-goals, reuse existing seams, deliver the narrow end-to-end path, verify it, then stop.
- `migration`: Use for database schema/data, API, protocol, configuration, or dependency transitions. Map readers and writers, define forward and rollback paths, preserve compatibility and data, make retries idempotent, and never perform destructive contraction implicitly.
- `safe-refactor`: Use for extraction, consolidation, ownership moves, or cleanup intended to preserve behavior. Establish proof before editing, move one boundary at a time, preserve public behavior, and rerun the same proof afterward.
- `surgical-patch`: Use for a bug fix or small behavior change. Reproduce or strongly evidence the failure, edit the narrowest responsible layer, add focused regression proof, and avoid unrelated cleanup.
- `verify-and-stop`: Use for validation-only requests or final completion checks. Run the smallest sufficient proof set, distinguish failed from blocked or unavailable, make no unrequested product edits, and stop when acceptance is proven.
- `nestjs-best-practices`: Use for every NestJS implementation, review, refactor, or diagnosis. Apply production patterns for feature modules, dependency injection, errors, security, performance, testing, Prisma, API design, microservices, and deployment.

### Caveman communication and delegation

- `caveman`: Persistent terse response mode. Default for this repository is `wenyan-ultra`. Preserve exact technical terms, commands, code, numbers, and negations. Temporarily use full clarity for security, irreversible actions, or ambiguity. Never apply compressed prose to persisted project files.
- `cavecrew`: Use only when the user explicitly requests subagents, delegation, Cavecrew, or compressed agent output. Select investigator for localization, builder for obvious edits of at most two files, and reviewer for concise diff findings. Keep larger or cross-cutting work in the main thread.
- `caveman-explore`: Use for cold-start, broad, read-only repository localization when exact files or symbols are not already known. Return only verified `path:start-end` locations; do not edit or propose fixes.
- `caveman-commit`: Use when asked for a commit message or when staging changes. Generate Conventional Commits text with an imperative subject, normally at most 50 characters, adding a body only for non-obvious reasons, breaking changes, security, migrations, or reverts. It does not stage or commit.
- `caveman-review`: Use for PR or diff review. Return one actionable finding per line with location, severity, problem, and concrete fix. It reviews only and does not modify code or run linters.
- `caveman-compress`: Use only when asked to compress a natural-language memory file. Run its provided script, preserve code/URLs/paths/commands exactly, store the human-readable backup outside the repository, and never apply it to source code or structured configuration.
- `caveman-help`: Use for requests about available Caveman commands or modes. Display the quick-reference card once without changing persistent mode.
- `caveman-stats`: Use only for `/caveman-stats`. The hook supplies measured session usage and estimated net savings; do not estimate the values manually.

### Caveman Cloud operations

- `caveman-setup`: Use when asked to route application LLM calls through Caveman Cloud. Require gateway URL, Cave API key, provider-key mode, and dashboard URL; keep secrets in ignored environment files; wire every real callsite minimally; send one authorized small verification request; report only observed results.
- `caveman-discover`: Use after gateway setup when asked to discover or label LLM workflows. Inventory entry points by human-readable job, propose the workflow table first, wait for approval, then add valid labels at callers and verify. Repeated runs must be idempotent.
- `caveman-evidence-review`: Use for read-only analysis of Caveman costs, traces, workflows, Cave Score, Cave Plan, latency, failures, or savings. Scope reads to the selected project, keep measured cost, inferred headroom, verified savings, and evidence cost separate, and do not mutate experiments.
- `caveman-learn`: Use when asked to act on a `caveman learn` report or lower agent token cost. Review ranked sinks first, obtain consent for each edit, never touch load-bearing context, verify every reduction, and preserve a working recall path for any Cavemem offload.
- `caveman-optimize`: Use for report-only Caveman optimization observations. Require login and an explicit operator-selected current observation, design an identical-input baseline/candidate evaluation, obtain approval before editing, and never convert local reductions into production savings claims.
- `caveman-manage`: Use for experiment lifecycle requests. Read state and evidence, fail closed on missing gates, recommend at most one supported action, but do not execute lifecycle mutations until server-authoritative atomic transition and evidence gates exist.

## Prompt-to-skill examples

- “Why does login fail sometimes?”: `caveman` plus `investigate-first`; add `nestjs-best-practices` because the auth flow is NestJS.
- “Fix refresh-token rotation”: `caveman` plus `surgical-patch`, `nestjs-best-practices`, then focused verification.
- “Add a todo endpoint”: `caveman` plus `lean-build`, `nestjs-best-practices`, then focused unit and HTTP tests.
- “Rename and reorganize auth services without behavior changes”: `caveman` plus `safe-refactor`, `nestjs-best-practices`, then pre/post proof.
- “Add a Prisma column and backfill existing rows”: `caveman` plus `migration`, `nestjs-best-practices`, then schema/data compatibility verification.
- “Check whether this branch is ready”: `caveman` plus `verify-and-stop`; add `nestjs-best-practices` if reviewing NestJS behavior.
- “Find all callers and delegate the search”: `caveman` plus `cavecrew`, using its investigator preset.
- “Review this PR”: `caveman` plus `caveman-review`; add `nestjs-best-practices` for NestJS diffs.
- “Set up Caveman observability”: `caveman` plus `caveman-setup`; add `caveman-discover` only when workflow labeling is separately requested.

## Verification commands

Choose only commands relevant to changed scope:

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
npx prisma validate
npx prisma generate
npm run prisma:seed
```

Do not run database migrations or seeds against an unknown or production database. Confirm the target environment when destructive or externally visible effects are possible.
