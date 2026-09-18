# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release sections are generated from Conventional Commit messages by `npm run release:prepare`
(git-cliff, configured in `cliff.toml`) and may be edited by hand before the release pull request
is merged. See the [Release Process](README.md#release-process) section of the README.

## [0.2.0-alpha] - 2026-09-18

The first version you can actually use. The demo data is gone: you get your own board, and what is
on it is what you put there.

### Added

- **Your goals, kept.** A first visit quietly creates an anonymous account — no sign-up screen, no
  password, nothing to fill in. Your goals live in that browser for **90 days from your last
  visit**, and the app says so plainly rather than leaving you to find out.
- **Add a goal** from a catalogue of six suggestions per life area, or start from nothing with
  "Something else". Every suggested target, minimum and unit is yours to change, before and after —
  a template fills the form in and is then forgotten.
- **Tick a goal done** for the day, or **log a value** for goals that are a number moving toward a
  target. Either can be **undone in one tap**, with no confirmation to dismiss: undoing a day that
  was already skipped puts it back to skipped, not to planned.
- **Target days and times.** Give a goal a repeat rule and it appears on the calendar. Editing a
  rule changes only what has not happened yet — days already lived keep the plan they were lived
  under.
- **Arrange the board** by dragging tiles, or entirely from the keyboard: pick a tile up with
  Space, move it with the arrow keys, resize it with `+` and `−`, drop it with Space, and Escape
  puts it back.
- **"My full glasses"** — finished goals move to a shelf. Not a trophy cabinet: nothing there is
  counted, ranked or awarded.
- **The glass moves like a glass.** Ticking something pours it; undoing lowers it through the same
  motion in reverse. Reaching full darkens the water and holds still.
- Your **time zone and week start** come from your browser, so "today" means your today.

### Changed

- Every `/api` route now requires the caller's own token, and row-level security — not application
  code — is what keeps one person's goals away from another's.

### Security

- Limits live in the database, where a forgotten check in a route cannot bypass them: caps on goals
  per account and on entries, check-ins and rules per goal, plus a length limit on every free-text
  field.
- Writes are rate limited per session, counted in one place rather than per server instance.
- Two cross-tenant holes found and closed while re-reading the existing policies. The serious one
  let a session claim another's repeat rule and quietly blank days out of their calendar.
- An account untouched for 90 days is deleted with everything hanging off it.

### Notes

- **There is still no sign-in, and no export.** If you clear this browser's storage, those goals are
  gone. Permanent accounts are the next release.
- Nothing here can tell you that you are behind: no field in the API and no prop in the interface
  can express a failure state.

[0.2.0-alpha]: https://github.com/santiago-torres1/progress-tracker/compare/v0.1.1-alpha...v0.2.0-alpha

## [0.1.1-alpha] - 2026-09-17

The first release with a product in it: a goals dashboard and calendar, shipped as a **read-only
live demo**. The app renders real data and writes nothing — there is no login and no way to add a
goal yet, so everything on screen comes from `supabase/seed.sql`.

### Added

- **Goals dashboard ("Meadow").** An unsorted canvas of goal tiles, where a tile's size is how
  much the goal matters to you. Each goal is a glass that fills as you go.
- **Three kinds of goal**, which all share one notion of progress: _scheduled_ (sessions kept),
  _measured_ (a value moving toward a target) and _habit_ (repetition within a period).
- **Habits have a minimum as well as a target.** While the minimum is met the app encourages you;
  above it, nothing is ever a failure. A completion on an unplanned day counts just the same.
- **Calendar** with day, week and month views. Entries that have a time and entries that only have
  a day sit together as equals, and every bar carries its own text.
- **Six life areas** — Health & Wellbeing, Learning & Skills, Money & Finances, Relationships,
  Work & Career, Creativity & Hobbies. Colour means area, and never means status.
- **Read-only API**: `GET /api/goals`, `/api/calendar?from&to` and `/api/areas`, with the response
  shapes as the contract the frontend is built against.
- **Postgres schema** for goals, recurrence, calendar entries and progress check-ins, with
  row-level security written and ready for the login that arrives in `0.1.2-alpha`.

### Changed

- The dashboard is now the page. The alpha infra status panel moves to the footer, where it still
  reports the deployed version and commit.

### Notes

- **Nothing here can tell you that you are behind**, by construction: a goal that moves backwards
  simply lowers its glass, and no field in the API or prop in the UI can express a failure state.
- The demo's data is seeded relative to the day it is applied, so re-running the seed refreshes it.

### Fixed

- **infra:** Match GitHub's immutable OIDC subject claim, which had been blocking every deploy (#5).

### Maintenance

- CI, deployment and release automation: GitHub Actions workflows, changelog generation and the
  release script (landed after the `0.1.0-alpha` notes were written).

[0.1.1-alpha]: https://github.com/santiago-torres1/progress-tracker/releases/tag/v0.1.1-alpha

## [0.1.0-alpha] - 2026-09-14

### Added

- Initial alpha infrastructure pass — no product features yet.
- React + Vite + TypeScript frontend with an "Alpha infra status" panel that
  probes the backend `/health` endpoint.
- Express + TypeScript backend split into `app.ts` / `server.ts` / `lambda.ts`
  so the same app runs locally and on AWS Lambda.
- `GET /health` and `GET /health/db` endpoints proving env-var wiring to Supabase.
- Multi-stage Dockerfile targeting the AWS Lambda Node.js 22 base image.
- Terraform: remote-state bootstrap (S3 + DynamoDB lock table) and main stack
  (ECR, Lambda + Function URL, S3 + CloudFront with OAC, GitHub OIDC role).
- GitHub Actions: `ci.yml`, `deploy.yml` (OIDC, no static keys), `release.yml`.
- Project conventions and subagent roles captured in `CLAUDE.md`.

[0.1.0-alpha]: https://github.com/santiago-torres1/progress-tracker/releases/tag/v0.1.0-alpha
