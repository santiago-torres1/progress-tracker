# CLAUDE.md — progress-tracker

Project-level context for every Claude Code session and subagent. **Read this first.**
If something here conflicts with a subagent prompt, this file wins. If something here
conflicts with an explicit instruction from the human, the human wins — then update this file.

## What this is

A personal, minimalist life-tracking app: ongoing tasks/projects, a built-in calendar with
Google/Apple Calendar sync, and encouraging reminder notifications. Login is optional.
Single-user for now; may go public later.

**`0.1.0-alpha` — "the plumbing works" — is done and live.** A change merged to `main`
deploys automatically to a real URL, and the deploy fails unless the live `/health` reports the
pushed commit.

**`0.1.1-alpha` — the read-only Meadow dashboard — is done, live and tagged.**

**Current milestone: `0.2.0-alpha` — the first version people can actually use.** Visitors get an
**anonymous account** (Supabase anonymous sign-in: no sign-in screen, a real `auth.users` row and
token), create their own goals, complete them, and log measurements. The seeded demo data stops
being the product — a new visitor sees an empty board. A session whose owner has not returned for
**90 days** is deleted, freeing its rows. Converting an anonymous account into a real one
(email/OAuth) keeps every row and is a later release.

**Product rules that the code must not quietly break:**

- The design is **"Meadow"**: an unsorted canvas of goal tiles, where tile **size is how important
  the goal is** to the person. A goal is **a glass that fills** — "your glass is half full".
- **No failure states, ever.** A measured goal that moves backwards just makes the glass quietly
  lower. No red, no "behind" badge, no streak-guilt.
- **Habits have a target and a minimum.** Target 4 runs a week, minimum 1: while the minimum is
  met the app encourages. Above the minimum nothing is ever a failure. An unplanned completion
  counts toward the period just like a planned one.
- **Six fixed life areas**, and colour means area — never status, and never alone (every coloured
  element also says its area in text). Custom areas are a later release.
- Goal kinds are `scheduled` (sessions), `measured` (a value toward a target) and `habit`
  (repetition in a period); progress for all three is computed by `goal_dashboard`, never in
  TypeScript.

## Security posture — an open API with no login

`0.2.0-alpha` accepts writes from anyone with the URL, and every request costs money. These are
requirements, not suggestions; a change that weakens one needs the human's agreement.

- **Row-level security does the isolating, not our code.** Requests carry the caller's Supabase
  access token and the backend acts _as that user_, so a bug in a route handler cannot leak
  another session's goals. The service-role key is only for maintenance jobs (e.g. expiry
  cleanup), never for serving a request.
- **Limits live in the database**, where a forgotten check in a route cannot bypass them: a cap on
  goals per user, on entries per goal, and on the length of every free-text field.
- **Rate limiting** on writes, keyed by session and by IP, plus Supabase's own anonymous sign-in
  rate limit so one machine cannot mint thousands of accounts.
- **Cost ceilings are part of security**: Lambda reserved concurrency and an AWS Budgets alert
  bound the blast radius of abuse. Unbounded spend is the real vulnerability here.
- **Never echo upstream errors, tokens or IDs** in a response body. Short reason codes only.
- Request bodies are size-limited and every field is validated at the boundary; no `as` casts on
  anything that arrived over the wire.
- Deleting a session's data must actually delete it (cascade), not just hide it.

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

**Product API.** Every `/api` route requires `Authorization: Bearer <supabase access token>`
from the caller's anonymous session, responds `private, no-store` + `Vary: Authorization`, and is
served by a per-request client so RLS applies as that user — the service-role key never serves a
request. Missing or invalid token → 401 with a short reason code; over quota → 429 with
`Retry-After`. `/health*` stays anonymous.

- `GET /api/goals` → the dashboard: one entry per active goal, a union discriminated on `kind`
  with a `habit` / `measured` / `scheduled` block. Carries `size`, the area and its colour, and
  `progress.fraction` + `progress.basis`. The API names no failure state and the UI must not
  invent one.
- `GET /api/calendar?from=&to=` → entries in an inclusive date range (max 366 days), each with an
  explicit `timing: 'timed' | 'untimed'` discriminant, plus enough of its goal to render.
- `GET /api/areas` → the six life areas.
- `GET`/`PATCH /api/session` → the caller's profile: `timeZone`, `weekStartsOn`, `isAnonymous`,
  `expiresAt`. The client should send the browser's zone on first run — **nothing sets it
  automatically, and a visitor left on UTC completes things on the wrong day.** No account id is
  ever returned by any route; the token is the identity.
- `GET /api/goal-templates` → the catalogue (`docs/goal-catalogue.md` is its source of truth),
  grouped by area, plus a `custom` block. There is no `template_id` on a goal and no foreign key
  either way: a template seeds a form and is then forgotten, so editing one later cannot reach a
  goal someone already created, and "a custom goal" is the only write path rather than a special
  case.
- Writes: `POST`/`PATCH`/`DELETE /api/goals`, `PATCH /api/goals/layout` (batched reorder and
  resize — one request, all-or-nothing), `POST`/`DELETE /api/goals/:id/completions` (complete and
  undo), `POST`/`PATCH`/`DELETE /api/goals/:id/measurements`, and
  `POST`/`PUT`/`DELETE /api/goals/:id/recurrences`.
- Every mutating response returns the **recomputed goal**, so a tile refills from the response
  without refetching. `404` on an undo or delete means "already gone" — treat it as success. `409`
  carries `limit`, and its copy must stay encouraging: a cap is not a failure.
- Completing is idempotent per (goal, day); measurements upsert per (goal, day); undo restores the
  exact prior state, including returning a skipped day to skipped.

Shapes live in `backend/src/types/api.ts` and are the contract the frontend imports. Successful
responses carry `Cache-Control: public, max-age=60`; errors carry `no-store`. `backend/src/types/database.ts`
is hand-written and must be replaced by `supabase gen types typescript` once the project is linked.

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
  trust policy matches one exact `sub` claim.
- That claim is GitHub's **immutable** form — names each followed by their numeric ID:
  `repo:OWNER@OWNER_ID/NAME@REPO_ID:ref:refs/heads/main` (see `github_owner_id` /
  `github_repository_id` in `infra/main`). The older name-only form does not match what GitHub
  sends, and fails with a generic `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
  To see the claim a run actually sent, look up its `AssumeRoleWithWebIdentity` event in
  CloudTrail: `userIdentity.userName` is the subject claim.
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
