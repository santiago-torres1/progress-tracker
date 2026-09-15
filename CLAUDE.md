# CLAUDE.md — progress-tracker

Project-level context for every Claude Code session and subagent. **Read this first.**
If something here conflicts with a subagent prompt, this file wins. If something here
conflicts with an explicit instruction from the human, the human wins — then update this file.

## What this is

A personal, minimalist life-tracking app: ongoing tasks/projects, a built-in calendar with
Google/Apple Calendar sync, and encouraging reminder notifications. Login is optional.
Single-user for now; may go public later.

**Current milestone: `0.1.0-alpha` — "the plumbing works."** A trivial change merged to
`main` deploys automatically to a real URL with versioning and a changelog. There is no
product logic yet: calendar, reminders, auth, and tracking UI are intentionally unbuilt.
If you are about to write business logic, stop and ask whether it belongs in the current pass.

## Fixed stack — do not deviate without asking the human

| Layer        | Choice                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Frontend     | React + Vite + TypeScript                                                                      |
| Backend      | Express + TypeScript; wrapped for Lambda with `serverless-http`                                |
| DB / Auth    | Supabase                                                                                       |
| Compute      | AWS Lambda (container image, `x86_64`) + Lambda Function URL                                   |
| Static host  | S3 (private) + CloudFront with Origin Access Control                                           |
| Images       | Amazon ECR                                                                                     |
| IaC          | Terraform; remote state in S3 with a DynamoDB lock table                                       |
| CI/CD        | GitHub Actions → AWS via GitHub OIDC + IAM role. **No static AWS access keys, ever.**          |
| Versioning   | SemVer, starting at `0.1.0-alpha`; conventional commits; changelog generated with `git-cliff`  |

## Repo layout

```
frontend/              React + Vite + TS (independent npm package)
backend/               Express + TS, Dockerized for Lambda (independent npm package)
  src/app.ts           builds + exports the Express app — no .listen()
  src/server.ts        local dev entrypoint — app.listen()
  src/lambda.ts        Lambda entrypoint — serverless-http(app)
  Dockerfile           multi-stage, public.ecr.aws/lambda/nodejs:22
infra/bootstrap/       Terraform: state bucket + lock table (local state, applied once)
infra/main/            Terraform: ECR, Lambda, Function URL, S3+CloudFront, GitHub OIDC role
.github/workflows/     ci.yml, deploy.yml, release.yml
.claude/agents/        design-agent.md, features-agent.md, integration-agent.md
scripts/               repo tooling (release prep) — not application code
CLAUDE.md  README.md  CHANGELOG.md  cliff.toml
```

## Subagents and ownership

The main interactive session is the **orchestrator**; the human approves. Delegate scoped
work to the specialist that owns it rather than doing everything in the main session.

| Agent               | Owns                                                                                   | Must not touch                          |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `design-agent`      | CSS, design tokens, layout, component appearance                                       | Terraform, workflows, backend, logic    |
| `features-agent`    | Business logic: tasks/projects, reminders, calendar UX, client state, product routes   | Infra, Supabase schema/client, styling  |
| `integration-agent` | Backend runtime shell, Supabase schema/client, external APIs, Terraform, CI/CD, deploy | Styling, business logic                 |

**Gotcha — new agent definitions load on the next turn.** A file added to `.claude/agents/`
isn't callable via the Agent tool until the orchestrator's next turn (a user message or a
background-task notification). Create or edit agent files, then let a turn pass before delegating.

**Orchestrator-owned shared files:** `CLAUDE.md`, `README.md`, root `package.json`,
`.gitignore`, root Prettier/EditorConfig. Subagents propose changes to these in their
report rather than editing them, to avoid parallel-edit collisions.

## Tooling assumptions (reasonable defaults — change here if you change them)

- **Node.js 22** everywhere: local (`.nvmrc`), CI, and the Lambda base image. The original
  brief suggested `nodejs:20` as an example, but Node 20 reached upstream EOL in April 2026.
- **npm**, **no workspaces.** `frontend/` and `backend/` each have their own
  `package.json` + `package-lock.json`. Root `package.json` only holds `concurrently` and
  delegating scripts. Reason: the backend Docker build stays self-contained (`npm ci`
  inside `backend/`) with no hoisted `node_modules` surprises.
- **Vitest** for tests in both packages (`supertest` on the backend, Testing Library on the frontend).
- **ESLint (flat config, v10)** + `typescript-eslint` strict type-checked rules, per package.
  **Prettier 3** with a single root `.prettierrc.json` (resolved by walking up). Each package
  also has its own `.prettierignore`, because Prettier only reads ignore files from the
  directory it runs in.
- **git-cliff** for changelog generation from conventional commits.

## Script contract

Both `frontend/` and `backend/` expose exactly these npm scripts. CI depends on the names.

| Script         | Meaning                                         |
| -------------- | ----------------------------------------------- |
| `dev`          | local dev server with reload                    |
| `build`        | production build to `dist/`                     |
| `lint`         | ESLint, zero warnings allowed                   |
| `typecheck`    | `tsc --noEmit`                                  |
| `test`         | Vitest, single run (not watch)                  |
| `format`       | Prettier write                                  |
| `format:check` | Prettier check                                  |

Root: `npm run setup` (install all), `npm run dev` (both apps), and `lint` / `typecheck` /
`test` / `build` / `format:check` fan out to both packages.

## Runtime contract

**Ports (local):** backend `3001`, frontend `5173`. Vite proxies `/health` → `localhost:3001`
in dev, so the browser sees a single origin locally and no CORS is involved.

**Backend endpoints (infrastructure only):**
- `GET /health` → `{ status: "ok", version, commit, timestamp }` — `version` from
  `backend/package.json`; `commit` from the `GIT_SHA` env var (baked in at image build,
  `"local"` otherwise). Never depends on Supabase.
- `GET /health/db` → reports whether Supabase env vars are present and a trivial probe
  succeeds. Never echoes secrets or raw upstream error messages.

**Backend env vars** (see `backend/.env.example`): `PORT`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GIT_SHA`.

**Frontend build-time env vars:** `VITE_API_BASE_URL` (empty locally → same-origin via
proxy; in deploys, the Lambda Function URL discovered at runtime), `VITE_COMMIT_SHA`.

**CORS** is configured in exactly one place: the Lambda Function URL (`infra/main`),
restricted to the CloudFront origin. Express does **not** add CORS middleware — doing both
produces duplicate headers.

## Deploy contract (what `deploy.yml` does → what the IAM role must allow)

On push to `main`, after the reusable CI workflow passes:

1. Assume `AWS_ROLE_ARN` via OIDC. Derive account ID with `aws sts get-caller-identity`.
2. `docker buildx build --platform linux/amd64 --provenance=false` the backend with
   `--build-arg GIT_SHA=<sha>`, push `ECR_REPOSITORY_URI:<sha>`.
   (`--provenance=false` matters: Lambda rejects OCI image indexes with attestations.)
3. `aws lambda update-function-code --image-uri …:<sha>` → `aws lambda wait function-updated`.
4. `aws lambda update-function-configuration` to set `SUPABASE_*` from GitHub secrets → wait.
5. `aws lambda get-function-url-config` → smoke-test `GET /health`, assert `commit == <sha>`.
6. Build frontend with `VITE_API_BASE_URL=<function url>`; `aws s3 sync` to `S3_FRONTEND_BUCKET`
   (hashed `assets/` immutable-cached, `index.html` `no-cache`); stale files removed last.
7. `aws cloudfront create-invalidation --paths "/*"`.

IAM actions required, each scoped to the specific resource ARN except where AWS requires `*`:
`ecr:GetAuthorizationToken` (`*`, AWS requirement), `ecr:BatchCheckLayerAvailability`,
`ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`,
`ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `lambda:UpdateFunctionCode`,
`lambda:UpdateFunctionConfiguration`, `lambda:GetFunctionConfiguration`,
`lambda:GetFunctionUrlConfig`, `s3:ListBucket`, `s3:PutObject`, `s3:DeleteObject`,
`cloudfront:CreateInvalidation`.

**GitHub secrets (exact names):** `AWS_REGION`, `AWS_ROLE_ARN`, `ECR_REPOSITORY_URI`,
`LAMBDA_FUNCTION_NAME`, `S3_FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. The AWS account ID is never stored.

## Coding conventions

- TypeScript `strict: true` (plus `noUncheckedIndexedAccess`). No `any`; use `unknown` and narrow.
- ESLint must pass with zero warnings; Prettier formatting is enforced in CI.
- ESM (`"type": "module"`) in both packages.
- Small modules, named exports, no default exports except where a framework requires them.
- Secrets come from environment variables only. Never hardcode them, never log them.
  `.env.example` files contain placeholders and comments only.
- Tests co-located as `*.test.ts(x)`. Infra endpoints (`/health*`) must have tests.

## Git, versioning, and release process

<!-- Finalized in Phase 7 — see README "Release Process". -->
_TBD in this session._

## Safety rules for every session

1. Never run anything that creates billable cloud resources or spends money
   (`terraform apply`, `aws … create/update/put/delete`, `docker push` to ECR) without asking
   the human in chat and receiving a clear go-ahead.
2. Never commit real secrets. Never generate or handle long-lived AWS access keys.
3. Never push to a remote, create tags, or open PRs without asking first.
4. `instructions.md` (if present) is maintained by the human. Do not overwrite it.
