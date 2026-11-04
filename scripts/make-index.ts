// Write index.json, unsigned, for the maintainer to sign (scripts/sign.ts). Everything comes
// from origin/main, never from the working copy (review 7C-4 S1):
//   node scripts/make-index.ts                 pins origin/main's latest commit
//   node scripts/make-index.ts --commit <sha>  pins that commit, which must be on origin/main
// The entries are the templates on origin/main, each pinned to the commit with the SHA-256 of
// its built file there (design 7C §3.2, O2, O9). The serial is one more than origin/main's
// index; it expires in 60 days (the app refuses more than 90, O1).

import fs from 'node:fs';
import { INDEX, INDEX_FORMAT, SIGNED_DAYS, fail } from './lib.ts';
import { entryAt, fetchMain, mainCommit, mainIds, mainSerial, onMain, refusals } from './indexRules.ts';

try {
  fetchMain();
} catch (err) {
  fail((err as Error).message);
}
const at = process.argv.indexOf('--commit');
const commit = at > 0 ? (process.argv[at + 1] ?? '').trim() : mainCommit();
if (!/^[0-9a-f]{40}$/.test(commit)) fail('The commit must be a full 40-character commit hash.');
if (!onMain(commit)) fail(`Commit ${commit.slice(0, 7)} is not on origin/main. Only reviewed, merged commits may be pinned.`);

const entries = mainIds().map((id) => {
  try {
    return entryAt(id, commit);
  } catch {
    return fail(`Commit ${commit.slice(0, 7)} has no valid built/${id}.json. Pin a later commit on main.`);
  }
});
const now = new Date();
const index = {
  format: INDEX_FORMAT,
  serial: mainSerial() + 1,
  signedAt: now.toISOString(),
  expires: new Date(now.getTime() + SIGNED_DAYS * 24 * 3600_000).toISOString(),
  entries,
};
const text = `${JSON.stringify(index, null, 2)}\n`;
const problems = refusals(Buffer.from(text));
if (problems.length) fail(problems.join('\n  '));
fs.writeFileSync(INDEX, text);
fs.rmSync(`${INDEX}.sig`, { force: true });
console.log(`✓ index.json: serial ${index.serial}, ${entries.length} templates at ${commit.slice(0, 7)}, expires ${index.expires.slice(0, 10)}.`);
console.log('  Next, on your Mac: node scripts/sign.ts');
