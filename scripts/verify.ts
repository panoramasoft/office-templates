// CI: if index.json is here, its signature must verify with a public key listed on origin/main
// (keys/public-keys.txt there), never one the pull request itself brings (review 7C-4 S3). CI
// holds no private key and signs nothing.

import { execFileSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import { INDEX, ROOT, SIGNATURE, fail } from './lib.ts';
import { fetchMain, MAIN } from './indexRules.ts';

if (!fs.existsSync(INDEX)) {
  console.log('No index.json yet: nothing to verify.');
  process.exit(0);
}
if (!fs.existsSync(SIGNATURE)) fail('index.json has no index.json.sig. Sign it with node scripts/sign.ts on your Mac.');
try {
  fetchMain();
} catch (err) {
  fail((err as Error).message);
}
let listed = '';
try {
  listed = execFileSync('git', ['show', `${MAIN}:keys/public-keys.txt`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
} catch {
  fail('main has no keys/public-keys.txt.');
}
const keys = listed.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
if (!keys.length) fail('keys/public-keys.txt on main lists no public key.');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const bytes = fs.readFileSync(INDEX);
const sig = Buffer.from(fs.readFileSync(SIGNATURE, 'utf8').trim(), 'base64');
const ok = keys.some((k) => {
  const raw = Buffer.from(k, 'base64');
  return raw.length === 32 && verify(null, bytes, createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' }), sig);
});
if (!ok) fail('index.json.sig does not verify with any key listed on main.');
console.log('✓ index.json is signed with a key listed on main.');
