# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release sections are generated from Conventional Commit messages by `npm run release:prepare`
(git-cliff, configured in `cliff.toml`) and may be edited by hand before the release pull request
is merged. See the [Release Process](README.md#release-process) section of the README.

## [0.3.1-alpha] - 2026-09-24

Four things reported from the live app, and the first two turned out to be one.

### Fixed

- **Saving target days made a new rule every time.** The screen never refreshed what it knew about
  a goal's rules after writing one, so it still believed there were none — and a second press
  created a second rule rather than replacing the first. Since the interface could only ever
  address one rule per goal, the extras and every calendar day they generated were unreachable
  forever. Saving now closes the panel, which is the confirmation that was missing, and reopening
  offers to **replace** the rule rather than set it again.
- **A day can come off the calendar.** "I am not running this Thursday" had no way to be said:
  a whole repeat rule could be removed and a completion undone, but a single day could not. Each
  day in a goal's list now offers to remove it. A day you have already ticked is kept — take the
  tick back first, and the app says so rather than refusing.
- **An entry on the calendar now leads somewhere.** The calendar was entirely read-only; clicking
  an entry opens the goal that put it there.
- **The water only moved for a few seconds after a tap.** Movement is noticed by measuring, and
  measuring only happens while the animation is running — which stops itself over still water. It
  had switched off its only sense, so dragging a tile could never wake it. It now runs for as long
  as you are touching the screen.
- **The water moved like jelly, and now moves like water.** Each column of it was bobbing on its
  own spring, in phase with its neighbours, so the surface rose and fell as one rigid sheet. Water
  is carried sideways instead: a disturbance now travels across the glass, comes off the far wall
  and meets itself on the way back. Dragging a tile pushes the water at the wall, which is the only
  place a moving glass touches it.

### Maintenance

- A script that finds and merges the duplicate repeat rules the bug above left behind. It reports
  before it changes anything, keeps the most recently updated of each identical group, and never
  deletes or restatuses a day you completed. Rules that differ in any way that changes which days
  they produce are two real plans and are left alone.

[0.3.1-alpha]: https://github.com/santiago-torres1/progress-tracker/compare/v0.3.0-alpha...v0.3.1-alpha

## [0.3.0-alpha] - 2026-09-24

The app stops being one page, the glasses stop being rectangles with a coloured bottom, and three
things that had been quietly wrong on screen are put right.

### Added

- **Somewhere to go.** Four pages instead of one — your board, the calendar, My full glasses and a
  profile — behind a frame that stays put: a top bar, and a column beside it you can collapse. On a
  phone that column is a drawer behind the menu button, and it behaves: it holds the keyboard
  inside it, closes on Escape, and puts you back where you were.
- **A profile page.** When you started, how many glasses you have filled, how many goals are on the
  board, and how much you have ticked off. Nothing here is a trophy, a streak or a score, and
  nothing is ranked. Your **time zone and week start are editable for the first time** — until now
  nothing in the app showed them, and a browser left on UTC quietly rolls the day over at the wrong
  moment.
- **The water behaves like water.** The surface carries waves that travel and bounce off the walls,
  ticking a goal pours into it, undoing drains it back, and dragging a tile makes the liquid pile
  up against the wall it is moving towards and keep going after the tile stops. It settles, because
  this is a calm app.
- **The glasses became glass.** Thickness at the rim, light down the near wall, depth in the water,
  and a pool of the goal's own colour on the floor that fades as the glass empties.

### Fixed

- **The "Today" pill sat on top of the calendar entry beside it**, and today's row was seven pixels
  out of line with the other six. Every row now reserves the same box, and the week defines its
  columns once rather than seven times.
- **"Done" hung out of both ends of its own button**, with the tick stranded outside. One class
  named two different elements, and the rule for the smaller one was handing the button a 13px
  width.
- **The panels you open from a goal ignored its colour.** Editing a Learning & Skills goal was
  highlighted in green like everything else; 26 places across the detail panel, the forms and the
  repeat-rule editor now follow the area. The focus ring stays the one colour, because focus has to
  look the same everywhere.
- **The etched habit minimum was drawn through the goal's own title.** It is now two marks on the
  glass walls, where no text can reach at any level.
- Every icon in the app was being clamped by a rule meant for photographs, which made any control
  pairing an icon with a word collapse.
- **The API had been unreachable from the browser since `0.2.0-alpha` shipped** — the Function URL
  allowed one method and no `Authorization` header, so the browser refused every request before
  sending it, while `/health` stayed green throughout (#8).

### Changed

- Pixi drives the liquid where a GPU context is going spare and canvas 2D draws the same picture
  everywhere else, and it is fetched only when a tile asks for it rather than before the page can
  paint.

### Notes

- **Still no sign-in, and still no export.** Your goals live in this browser for 90 days from your
  last visit. The profile page now tells you the date.
- There is still no way for this app to tell you that you are behind, in any field, on any screen.

[0.3.0-alpha]: https://github.com/santiago-torres1/progress-tracker/compare/v0.2.0-alpha...v0.3.0-alpha

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
