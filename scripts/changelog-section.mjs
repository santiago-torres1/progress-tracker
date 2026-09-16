#!/usr/bin/env node
/**
 * Print the body of one release section of CHANGELOG.md (Keep a Changelog format):
 *
 *   node scripts/changelog-section.mjs <version> [file]      (file defaults to CHANGELOG.md; "-" = stdin)
 *
 * A section starts at the line "## [<version>]" (optionally followed by " - <date>") and ends
 * before the next "## " heading. The heading line and link reference definitions
 * ("[0.1.0]: https://...") are dropped, and leading/trailing blank lines are trimmed, so the
 * output can be used directly as a GitHub Release body.
 *
 * Exit status: 0 = section found (stdout is empty if the section has no entries),
 *              2 = no such section, 1 = usage or read error.
 *
 * Used by .github/workflows/release.yml and scripts/release-prepare.mjs. Plain Node ESM, no
 * dependencies.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S/;

const isHeadingFor = (line, version) => {
  const heading = `## [${version}]`;
  return line === heading || line.startsWith(`${heading} `);
};

/** Number of "## [<version>]" headings in `markdown`. */
export function countSections(markdown, version) {
  return markdown.split(/\r?\n/).filter((line) => isHeadingFor(line, version)).length;
}

/**
 * Body of the first "## [<version>]" section, or null if there is none. An empty string means the
 * heading exists but has no entries.
 */
export function findSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => isHeadingFor(line, version));
  if (start === -1) return null;

  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const body = lines
    .slice(start + 1, next === -1 ? lines.length : next)
    .filter((line) => !LINK_REFERENCE_DEFINITION.test(line));

  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  return body.join('\n');
}

function main(argv) {
  const [version, file = 'CHANGELOG.md'] = argv;
  if (!version || argv.length > 2 || version.startsWith('-')) {
    console.error('Usage: node scripts/changelog-section.mjs <version> [file|-]');
    return 1;
  }
  let markdown;
  try {
    markdown = readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (error) {
    console.error(`changelog-section: cannot read ${file}: ${error.message}`);
    return 1;
  }
  const section = findSection(markdown, version.replace(/^v/, ''));
  if (section === null) return 2;
  if (section !== '') process.stdout.write(`${section}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
