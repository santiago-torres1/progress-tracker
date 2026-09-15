<!--
The pull request TITLE becomes the commit message on main (squash merge) and the changelog entry,
so write it as a Conventional Commit:

  <type>(<optional scope>): <description>
  feat: add the task list        fix(api): return 404 for unknown tasks
  types: feat, fix, perf, refactor, docs, ci, build, chore, test, style, revert
  breaking change: add "!" before the colon, e.g. feat(api)!: drop /v1
-->

## What and why

<!-- One or two sentences. Link an issue if there is one. -->

## Checklist

- [ ] Title is a Conventional Commit (the `pr-title` check enforces it)
- [ ] Stays inside one agent's scope (design = styling, features = product logic, integration =
      backend shell, Supabase, Terraform, CI/CD); anything else is called out below
- [ ] Tests added or updated, and `npm run lint`, `npm run typecheck`, `npm test` pass locally
- [ ] No secrets, credentials, or AWS account IDs in code, config, logs, or fixtures
- [ ] Infrastructure changes: every new `aws` call in a workflow has a matching IAM action in
      `infra/main/github_oidc.tf` and in CLAUDE.md's Deploy contract
- [ ] Merging this to `main` deploys it — I am happy for that to happen now

## Notes for the reviewer

<!-- Out-of-scope changes, follow-ups, manual steps (e.g. a GitHub secret that must be set first). -->
