#!/usr/bin/env node
/**
 * Prepare a release: `npm run release:prepare -- <version>`
 *
 * Run on a clean `release/v<version>` branch. The script:
 *   1. validates <version> as SemVer (pre-release allowed, e.g. 0.1.1-alpha, 0.2.0-alpha.1);
 *   2. refuses a dirty working tree, an existing tag, or a version not newer than the latest tag;
 *   3. sets `version` in package.json + package-lock.json of the root, frontend/ and backend/;
 *   4. prepends the release section to CHANGELOG.md with git-cliff (cliff.toml);
 *   5. prints the commit / PR / tag steps.
 * It never commits, pushes, or tags. Plain Node ESM, no dependencies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exact pin: reproducible changelog formatting. Keep in sync with GIT_CLIFF_VERSION in
// .github/workflows/release.yml.
const GIT_CLIFF = 'git-cliff@2.13.1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIRS = ['.', 'frontend', 'backend'];
const CHANGELOG = 'CHANGELOG.md';

// SemVer 2.0.0 (semver.org's official pattern) minus build metadata: npm drops `+build`,
// so the tag and the package versions would no longer match.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

let touchedFiles = false;

function fail(message) {
  console.error(`\nrelease:prepare: ${message}`);
  if (touchedFiles) {
    console.error(
      'The working tree was clean before this run; `git restore .` undoes any partial changes.',
    );
  }
  process.exit(1);
}

function warn(message) {
  console.warn(`\nWARNING: ${message}`);
}

function run(cmd, args, { cwd = ROOT, capture = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    // npm and npx are .cmd shims on Windows and can only be spawned through a shell.
    shell: process.platform === 'win32' && cmd !== 'git',
  });
  if (result.error) fail(`could not run \`${cmd}\`: ${result.error.message}`);
  return result;
}

function git(...args) {
  const result = run('git', args, { capture: true });
  if (result.status !== 0) fail(`\`git ${args.join(' ')}\` failed:\n${result.stderr.trim()}`);
  return result.stdout.trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** SemVer precedence (semver.org §11). Inputs must already match SEMVER. */
function compareSemver(a, b) {
  const split = (v) => {
    const [core, pre] = v.split(/-(.*)/s);
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);
    if (pNum && qNum) return Number(p) < Number(q) ? -1 : 1;
    if (pNum !== qNum) return pNum ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const countLines = (text, pattern) => text.split('\n').filter((line) => pattern.test(line)).length;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '-h' || args[0] === '--help') {
  console.log('Usage: npm run release:prepare -- <version>   (e.g. 0.1.1-alpha)');
  process.exit(args.length === 1 ? 0 : 1);
}
const version = args[0].replace(/^v/, '');
if (!SEMVER.test(version)) {
  fail(`"${args[0]}" is not a valid SemVer version (e.g. 0.1.1-alpha, 0.2.0-alpha.1, 1.0.0).`);
}
const tag = `v${version}`;
const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]( |$)`);

// --- preconditions -----------------------------------------------------------

if (run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { capture: true }).status !== 0) {
  fail('this repository has no commits yet; git-cliff needs history to build a changelog.');
}
const dirty = git('status', '--porcelain');
if (dirty) {
  fail(
    `the working tree is not clean:\n${dirty}\n` +
      'Commit or stash first so the release commit contains only release changes.',
  );
}
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists.`);

for (const file of ['cliff.toml', CHANGELOG, ...PACKAGE_DIRS.map((d) => `${d}/package.json`)]) {
  if (!existsSync(path.join(ROOT, file))) fail(`missing ${path.normalize(file)}.`);
}

const released = git('tag', '--list', 'v*')
  .split('\n')
  .map((t) => t.slice(1))
  .filter((v) => SEMVER.test(v))
  .sort(compareSemver);
const previous = released.at(-1);
if (previous && compareSemver(version, previous) <= 0) {
  fail(`${version} is not greater than the latest release tag v${previous}.`);
}
if (!previous) {
  warn(
    'no v* release tags exist locally (run `git fetch --tags` if that is unexpected).\n' +
      'Treating this as the first release: every conventional commit reachable from HEAD is ' +
      `attributed to ${tag}.`,
  );
}

const branch = git('branch', '--show-current');
if (branch !== `release/${tag}`) {
  warn(
    `you are on "${branch || '(detached HEAD)'}", not "release/${tag}". ` +
      'main only accepts changes through pull requests.',
  );
}

// --- CHANGELOG.md --------------------------------------------------------------
// Done before the version bumps: it is the step most likely to fail (network, header drift).

const changelogPath = path.join(ROOT, CHANGELOG);
const before = readFileSync(changelogPath, 'utf8');
if (countLines(before, heading) > 0) {
  console.log(`\n${CHANGELOG} already has a "## [${version}]" section; leaving it untouched.`);
} else {
  console.log(`\nGenerating the ${tag} section of ${CHANGELOG} with ${GIT_CLIFF}...`);
  touchedFiles = true;
  const cliff = run('npx', [
    '--yes',
    GIT_CLIFF,
    '--unreleased',
    '--tag',
    tag,
    '--prepend',
    CHANGELOG,
  ]);
  const after = readFileSync(changelogPath, 'utf8');
  const problem =
    cliff.status !== 0
      ? `git-cliff exited with status ${cliff.status}.`
      : countLines(after, /^# /) !== 1 || countLines(after, /^## \[Unreleased\]/) > 1
        ? `the header in ${CHANGELOG} does not match [changelog].header in cliff.toml, so ` +
          'git-cliff duplicated it. Make them identical and re-run.'
        : countLines(after, heading) !== 1
          ? `expected exactly one "## [${version}]" section after generation.`
          : null;
  if (problem) {
    writeFileSync(changelogPath, before);
    fail(`${problem} ${CHANGELOG} has been restored.`);
  }
  const section = after.split(heading)[1] ?? '';
  if (!/^### /m.test(section.split(/^## \[/m)[0] ?? '')) {
    warn(`no releasable conventional commits since ${previous ? `v${previous}` : 'the first commit'}; the ${tag} section is empty.`);
  }
}

// --- package versions --------------------------------------------------------

for (const dir of PACKAGE_DIRS) {
  const cwd = path.join(ROOT, dir);
  touchedFiles = true;
  const result = run(
    'npm',
    ['version', version, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts'],
    { cwd, capture: true },
  );
  if (result.status !== 0) fail(`npm version failed in ${dir}/:\n${result.stderr.trim()}`);

  const pkg = readJson(path.join(cwd, 'package.json'));
  const lockPath = path.join(cwd, 'package-lock.json');
  const lock = existsSync(lockPath) ? readJson(lockPath) : null;
  if (pkg.version !== version || (lock && (lock.version !== version || lock.packages?.['']?.version !== version))) {
    fail(`${dir}/package.json or its package-lock.json was not updated to ${version}.`);
  }
  if (!lock) warn(`${path.join(dir, 'package-lock.json')} does not exist; only package.json was updated.`);
  console.log(`  ${path.join(dir, 'package.json')}${lock ? ' + package-lock.json' : ''} -> ${version}`);
}

// --- next steps ----------------------------------------------------------------

const onBranch = branch === `release/${tag}`;
console.log(`
Prepared ${tag}. Next steps:

  1. Review the changes (edit CHANGELOG.md wording freely):
       git diff
  2. Commit${onBranch ? '' : ' on a release branch'}:${onBranch ? '' : `\n       git switch -c release/${tag}`}
       git commit -am "chore(release): ${tag}"
  3. Push and open a pull request into main with the same title:
       git push -u origin release/${tag}
       gh pr create --base main --title "chore(release): ${tag}" --body "Release ${tag}."
  4. Merge when CI is green. Merging to main deploys this version.
     (If main moves before you merge, rebase; re-run this script only after removing the
     ${tag} section, or edit CHANGELOG.md by hand.)
  5. Tag the merge commit on main and push the tag. This publishes the GitHub Release; it
     does not deploy again:
       git switch main && git pull --ff-only
       git tag ${tag} <merge-sha>
       git push origin ${tag}
`);
