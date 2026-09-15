# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries below the `[Unreleased]` heading are generated automatically by
`.github/workflows/release.yml` when a `v*` tag is pushed. See the
[Release Process](README.md#release-process) section of the README.

## [Unreleased]

## [0.1.0-alpha] - 2026-09-14

### Added

- Initial alpha infrastructure pass — no product features yet.
- React + Vite + TypeScript frontend with an "Alpha infra status" panel that
  probes the backend `/health` endpoint.
- Express + TypeScript backend split into `app.ts` / `server.ts` / `lambda.ts`
  so the same app runs locally and on AWS Lambda.
- `GET /health` and `GET /health/db` endpoints proving env-var wiring to Supabase.
- Multi-stage Dockerfile targeting the AWS Lambda Node.js 20 base image.
- Terraform: remote-state bootstrap (S3 + DynamoDB lock table) and main stack
  (ECR, Lambda + Function URL, S3 + CloudFront with OAC, GitHub OIDC role).
- GitHub Actions: `ci.yml`, `deploy.yml` (OIDC, no static keys), `release.yml`.
- Project conventions and subagent roles captured in `CLAUDE.md`.

[Unreleased]: https://github.com/santiago-torres1/progress-tracker/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/santiago-torres1/progress-tracker/releases/tag/v0.1.0-alpha
