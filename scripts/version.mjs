// Version label helper: "v." + first 4 chars of the deployed commit.
// Cloudflare Workers Builds exposes WORKERS_CI_COMMIT_SHA; locally we use git HEAD.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export function getCommitSha() {
  return process.env.WORKERS_CI_COMMIT_SHA || git('rev-parse HEAD');
}

export function getVersion() {
  const sha = getCommitSha();
  return sha ? `v.${sha.slice(0, 4)}` : 'v.dev';
}

export function isDirty() {
  return git('status --porcelain') !== '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(getVersion());
  if (process.argv.includes('--check') && isDirty()) {
    console.warn(
      '\x1b[33mWarning: the working tree has uncommitted changes. The version label shows HEAD ' +
        `(${getVersion()}), not these changes.\x1b[0m`,
    );
  }
}
