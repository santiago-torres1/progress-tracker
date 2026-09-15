// An empty VITE_COMMIT_SHA (e.g. from .env.example) should also fall back to "local".
const commitSha = import.meta.env.VITE_COMMIT_SHA?.trim();

export const buildInfo = {
  version: __APP_VERSION__,
  commit: commitSha !== undefined && commitSha.length > 0 ? commitSha : 'local',
} as const;

/** First 7 characters of a git SHA; non-SHA values like "local" pass through unchanged. */
export function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 7) : commit;
}
