// make-index, sign, verify and keygen against a throwaway repository with its own bare origin
// (review 7C-4 S1-S3, N2). Every key is made for the run and deleted with it. No network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.resolve(import.meta.dirname, '..');
let tmp = '';
let work = '';
let keyFile = '';
let pub = '';

const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
function run(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [path.join('scripts', script), ...args], { cwd: work, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}
const readIndex = () => JSON.parse(fs.readFileSync(path.join(work, 'index.json'), 'utf8'));
const writeIndex = (i: unknown) => fs.writeFileSync(path.join(work, 'index.json'), `${JSON.stringify(i, null, 2)}\n`);
function refusedWith(edit: (i: Record<string, any>) => void, why: RegExp) {
  assert.ok(run('make-index.ts').ok);
  const i = readIndex();
  edit(i);
  writeIndex(i);
  const r = run('sign.ts', '--key', keyFile);
  assert.equal(r.ok, false, r.out);
  assert.match(r.out, why);
  assert.equal(fs.existsSync(path.join(work, 'index.json.sig')), false, 'nothing signed');
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-sign-')));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', path.join(tmp, 'origin.git')]);
  work = path.join(tmp, 'work');
  execFileSync('git', ['clone', '-q', path.join(tmp, 'origin.git'), work], { stdio: 'ignore' });
  for (const d of ['scripts', 'checker']) fs.cpSync(path.join(HERE, d), path.join(work, d), { recursive: true });
  for (const id of ['job-search', 'landlord']) fs.cpSync(path.join(HERE, 'templates', id), path.join(work, 'templates', id), { recursive: true });
  for (const f of ['package.json', '.gitignore']) fs.copyFileSync(path.join(HERE, f), path.join(work, f));
  fs.symlinkSync(path.join(HERE, 'node_modules'), path.join(work, 'node_modules'));
  assert.ok(run('build.ts').ok);
  const k = run('keygen.ts', '--out', path.join(tmp, 'key', 'k.pem'));
  assert.ok(k.ok, k.out);
  keyFile = path.join(tmp, 'key', 'k.pem');
  pub = /Public key \(safe to share\): (\S+)/.exec(k.out)![1];
  fs.mkdirSync(path.join(work, 'keys'));
  fs.writeFileSync(path.join(work, 'keys', 'public-keys.txt'), `${pub}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'templates');
  git('push', '-q', 'origin', 'main');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('a good index is made from main, signed, and verified with the key listed on main', () => {
  const m = run('make-index.ts');
  assert.ok(m.ok, m.out);
  const i = readIndex();
  assert.equal(i.serial, 1);
  assert.deepEqual(i.entries.map((e: { id: string }) => e.id), ['job-search', 'landlord']);
  assert.ok(i.entries.every((e: { commit: string }) => e.commit === git('rev-parse', 'origin/main')));
  const s = run('sign.ts', '--key', keyFile);
  assert.ok(s.ok, s.out);
  const v = run('verify.ts');
  assert.ok(v.ok, v.out);
  // Publish it, as the maintainer would.
  git('add', 'index.json', 'index.json.sig');
  git('commit', '-q', '-m', 'Index 1');
  git('push', '-q', 'origin', 'main');
});

test("the serial comes from main's index: a deleted index.json doesn't restart it, and an equal or lower one is refused", () => {
  fs.rmSync(path.join(work, 'index.json'));
  assert.ok(run('make-index.ts').ok);
  assert.equal(readIndex().serial, 2);
  refusedWith((i) => (i.serial = 1), /main already has 1/);
  refusedWith((i) => (i.serial = 1_000_000_000_000.5), /serial/);
});

test('a commit that is not on main is refused, even with the right hash (a pull request or fork commit)', () => {
  const head = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-b', 'pr');
  const f = path.join(work, 'templates', 'landlord', 'manifest.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"version": "1.0.0"', '"version": "1.0.1"'));
  assert.ok(run('build.ts').ok);
  git('commit', '-q', '-am', 'unreviewed change');
  git('push', '-q', 'origin', 'pr');
  const foreign = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.ok(run('build.ts').ok);
  refusedWith((i) => {
    const e = i.entries.find((x: { id: string }) => x.id === 'landlord');
    e.commit = foreign;
    e.sha256 = createHash('sha256').update(execFileSync('git', ['show', `${foreign}:built/landlord.json`], { cwd: work })).digest('hex');
    e.version = '1.0.1';
  }, /landlord: commit [0-9a-f]{7} is not on main/);
  assert.equal(run('make-index.ts', '--commit', foreign).ok, false);
});

test('a wrong hash, path, name, missing or extra entry, future date, long life or unknown key is refused', () => {
  refusedWith((i) => (i.entries[0].sha256 = 'f'.repeat(64)), /job-search: the sha256 is not the one/);
  refusedWith((i) => (i.entries[0].path = 'built/landlord.json'), /job-search: the path must be built\/job-search\.json/);
  refusedWith((i) => (i.entries[0].name = 'Something else'), /job-search: the name, description, version or counts differ/);
  refusedWith((i) => i.entries.pop(), /exactly the templates on main/);
  refusedWith((i) => i.entries.push({ ...i.entries[0], id: 'extra', path: 'built/extra.json' }), /exactly the templates on main/);
  refusedWith((i) => (i.signedAt = new Date(Date.now() + 2 * 24 * 3600_000).toISOString()), /signedAt is in the future/);
  refusedWith((i) => (i.expires = new Date(Date.parse(i.signedAt) + 91 * 24 * 3600_000).toISOString()), /longer than 90 days/);
  refusedWith((i) => (i.repo = 'evil/templates'), /Unrecognized key/);
  refusedWith((i) => (i.entries[0].repo = 'evil/templates'), /Unrecognized key/);
});

test('verify trusts only the keys listed on main, not ones a pull request adds', () => {
  const other = run('keygen.ts', '--out', path.join(tmp, 'key', 'other.pem'));
  const otherPub = /Public key \(safe to share\): (\S+)/.exec(other.out)![1];
  fs.appendFileSync(path.join(work, 'keys', 'public-keys.txt'), `${otherPub}\n`);
  assert.ok(run('make-index.ts').ok);
  assert.ok(run('sign.ts', '--key', path.join(tmp, 'key', 'other.pem')).ok);
  const v = run('verify.ts');
  assert.equal(v.ok, false, v.out);
  assert.match(v.out, /does not verify with any key listed on main/);
  git('checkout', '-q', '--', 'keys/public-keys.txt');
});

test('keygen refuses any path inside the repository: a folder named ..x, or a symlink to it', () => {
  fs.mkdirSync(path.join(work, '..x'), { recursive: true });
  const dotted = run('keygen.ts', '--out', path.join(work, '..x', 'k.pem'));
  assert.equal(dotted.ok, false, dotted.out);
  const link = path.join(tmp, 'link-to-repo');
  fs.symlinkSync(work, link);
  const linked = run('keygen.ts', '--out', path.join(link, 'k.pem'));
  assert.equal(linked.ok, false, linked.out);
  for (const r of [dotted, linked]) assert.match(r.out, /must not be written inside this repository/);
  assert.equal(fs.existsSync(path.join(work, '..x', 'k.pem')) || fs.existsSync(path.join(work, 'k.pem')), false);
});
