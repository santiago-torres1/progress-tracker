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

| Layer       | Choice                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------- |
| Frontend    | React + Vite + TypeScript                                                                     |
| Backend     | Express + TypeScript; wrapped for Lambda with `serverless-http`                               |
| DB / Auth   | Supabase                                                                                      |
| Compute     | AWS Lambda (container image, `x86_64`) + Lambda Function URL                                  |
| Static host | S3 (private) + CloudFront with Origin Access Control                                          |
| Images      | Amazon ECR                                                                                    |
| IaC         | Terraform; remote state in S3 with a DynamoDB lock table                                      |
| CI/CD       | GitHub Actions → AWS via GitHub OIDC + IAM role. **No static AWS access keys, ever.**         |
| Versioning  | SemVer, starting at `0.1.0-alpha`; conventional commits; changelog generated with `git-cliff` |

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

| Agent               | Owns                                                                                   | Must not touch                         |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------------------------- |
| `design-agent`      | CSS, design tokens, layout, component appearance                                       | Terraform, workflows, backend, logic   |
| `features-agent`    | Business logic: tasks/projects, reminders, calendar UX, client state, product routes   | Infra, Supabase schema/client, styling |
| `integration-agent` | Backend runtime shell, Supabase schema/client, external APIs, Terraform, CI/CD, deploy | Styling, business logic                |

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

| Script         | Meaning                        |
| -------------- | ------------------------------ |
| `dev`          | local dev server with reload   |
| `build`        | production build to `dist/`    |
| `lint`         | ESLint, zero warnings allowed  |
| `typecheck`    | `tsc --noEmit`                 |
| `test`         | Vitest, single run (not watch) |
| `format`       | Prettier write                 |
| `format:check` | Prettier check                 |

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

Constraints that break deploys if ignored (learned while writing `infra/main`):

- Use `aws lambda wait function-updated`, **not** `function-updated-v2` (needs `lambda:GetFunction`).
- Deploy jobs must **not** use `environment:` and must run only on `refs/heads/main`: the role's
  trust policy matches `sub = repo:santiago-torres1/progress-tracker:ref:refs/heads/main` exactly.
- No `--acl` flags on S3 uploads (bucket uses `BucketOwnerEnforced`).
- `update-function-configuration --environment` replaces the whole map: always send all
  `SUPABASE_*` together, and never set `GIT_SHA` there (it's baked into the image).
- Terraform's `aws_lambda_function` ignores `image_uri` and `environment` — CI owns both.
- `infra/main` needs AWS provider `~> 6.28` (auto-creates both public Function URL permissions).
- Adding an AWS call to `deploy.yml` means adding its IAM action to `infra/main/github_oidc.tf`
  and to the list above, in the same PR.

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

**Trunk-based.** `main` is always deployable and always deployed: every push to it runs
`deploy.yml`. Work happens on short-lived branches (`feat/…`, `fix/…`, `chore/…`) and reaches
`main` only through a pull request. Never commit directly to `main`.

**Squash merge, and the PR title is the commit message.** That title is the only thing git-cliff
sees, so it must be a Conventional Commit: `type(optional-scope): summary`, with type one of
`feat | fix | perf | refactor | docs | ci | build | chore | test | style | revert`.
`.github/workflows/pr-title.yml` enforces it. `feat` → Added, `fix` → Fixed, `perf`/`refactor` →
Changed, `docs` → Documentation, everything else → Maintenance (`cliff.toml`). `!` or a
`BREAKING CHANGE:` footer flags a break.

**SemVer, starting at `0.1.0-alpha`.** While pre-1.0 and alpha: `0.1.1-alpha`, `0.1.0-alpha.1`,
etc. (`-alpha` sorts before `-alpha.1`). Move to `0.2.0-alpha` at a milestone, `1.0.0` when the app
is real and public. The version lives in three `package.json` files plus their lockfiles — always
change it with `npm run release:prepare`, never by hand. `GET /health` reports it, so it is the
deployed artifact's identity.

**Releasing** (details in `README.md#release-process`):

1. `git switch -c release/vX.Y.Z` → `npm run release:prepare -- X.Y.Z` (bumps versions, writes the
   `CHANGELOG.md` section with git-cliff). Edit the generated section for humans if needed.
2. PR titled `chore(release): vX.Y.Z` → merge → `deploy.yml` deploys it.
3. Tag that merged commit on `main` and push the tag → `release.yml` publishes the GitHub Release.

A tag never deploys. The commit was already live when it merged; the Release is the record.

**Conventions that keep this working:**

- `CHANGELOG.md`'s top must stay byte-identical to `[changelog].header` in `cliff.toml`, or
  `--prepend` duplicates it. It is in `.prettierignore` for that reason — never format it.
- Third-party actions are pinned to a major version and tracked by Dependabot.
- `AWS_REGION` is a secret (as specified), so any job output containing the region — including the
  Function URL — is dropped by the runner. That is why `deploy.yml` re-reads the Function URL in
  each job instead of passing it between them. Making it a repository _variable_ would be cleaner
  and would stop regions being masked as `***` in logs; it needs the human's go-ahead.
- Branch protection is recommended but must be enabled by hand in GitHub's UI (see README).

## Safety rules for every session

1. Never run anything that creates billable cloud resources or spends money
   (`terraform apply`, `aws … create/update/put/delete`, `docker push` to ECR) without asking
   the human in chat and receiving a clear go-ahead.
2. Never commit real secrets. Never generate or handle long-lived AWS access keys.
3. Never push to a remote, create tags, or open PRs without asking first.
4. `instructions.md` (if present) is maintained by the human. Do not overwrite it.
