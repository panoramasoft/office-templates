// Write index.json, unsigned, for the human to sign (scripts/sign.ts). Run on main after a
// reviewed pull request is merged:
//   node scripts/make-index.ts                 pins HEAD
//   node scripts/make-index.ts --commit <sha>  pins that commit
// Each entry pins a full 40-character commit that holds built/<id>.json, and the SHA-256 of that
// file as committed there (design 7C §3.2, O2, O9). The serial is one more than the current
// index's; the index expires in 60 days (the app refuses more than 90, O1).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { validateTemplate } from '../checker/template.ts';
import { INDEX, INDEX_FORMAT, ROOT, SIGNED_DAYS, fail, sha256, templateIds } from './lib.ts';

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT });
const at = process.argv.indexOf('--commit');
const commit = (at > 0 ? process.argv[at + 1] : git('rev-parse', 'HEAD').toString()).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) fail('The commit must be a full 40-character commit hash.');

const previous = fs.existsSync(INDEX) ? (JSON.parse(fs.readFileSync(INDEX, 'utf8')) as { serial?: number }).serial ?? 0 : 0;
const entries = templateIds().map((id) => {
  let bytes: Buffer;
  try {
    bytes = git('show', `${commit}:built/${id}.json`);
  } catch {
    fail(`Commit ${commit.slice(0, 7)} has no built/${id}.json. Pin a commit on main after the merge.`);
  }
  const t = validateTemplate(JSON.parse(bytes.toString('utf8')));
  return {
    id,
    name: t.name,
    description: t.description,
    version: t.version,
    ...(t.industry ? { industry: t.industry } : {}),
    ...(t.author ? { author: t.author } : {}),
    commit,
    path: `built/${id}.json`,
    sha256: sha256(bytes),
    roleCount: t.roles.length,
    fileCount: t.files.length,
    scheduleCount: t.schedules.length,
  };
});
const now = new Date();
const index = {
  format: INDEX_FORMAT,
  serial: previous + 1,
  signedAt: now.toISOString(),
  expires: new Date(now.getTime() + SIGNED_DAYS * 24 * 3600_000).toISOString(),
  entries,
};
fs.writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);
fs.rmSync(`${INDEX}.sig`, { force: true });
console.log(`✓ index.json: serial ${index.serial}, ${entries.length} templates at ${commit.slice(0, 7)}, expires ${index.expires.slice(0, 10)}.`);
console.log('  Next, on your Mac: node scripts/sign.ts');
