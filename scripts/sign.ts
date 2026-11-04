// Sign index.json, on the maintainer's Mac, with the key from scripts/keygen.ts. Before signing,
// every field is re-derived from origin/main (scripts/indexRules.ts, review 7C-4 S1): commits on
// main, hashes of the built files there, the entries exactly main's templates, a serial above
// main's, dates the app accepts. Anything else is refused and nothing is signed. The signature
// covers the exact bytes of index.json (design 7C §3.3, O10). Writes index.json.sig.
//   node scripts/sign.ts                    uses ~/.office-templates-key/signing-key.pem
//   node scripts/sign.ts --key <file.pem>

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INDEX, SIGNATURE, fail, rawPublicKey } from './lib.ts';
import { fetchMain, refusals } from './indexRules.ts';

const at = process.argv.indexOf('--key');
const keyFile = path.resolve(at > 0 ? process.argv[at + 1] : path.join(os.homedir(), '.office-templates-key', 'signing-key.pem'));
if (!fs.existsSync(keyFile)) fail(`No key at ${keyFile}. Run node scripts/keygen.ts first, or pass --key.`);
if (!fs.existsSync(INDEX)) fail('No index.json. Run node scripts/make-index.ts first.');
try {
  fetchMain();
} catch (err) {
  fail((err as Error).message);
}

const bytes = fs.readFileSync(INDEX);
const problems = refusals(bytes);
if (problems.length) fail(`index.json was not signed:\n  ${problems.join('\n  ')}`);
const index = JSON.parse(bytes.toString('utf8')) as { serial: number; expires: string; entries: unknown[] };

const key = createPrivateKey(fs.readFileSync(keyFile));
const signature = sign(null, bytes, key);
const pub = createPublicKey(key);
if (!verify(null, bytes, pub, signature)) fail('The signature did not verify. Nothing was written.');
fs.writeFileSync(SIGNATURE, `${signature.toString('base64')}\n`);
console.log(`✓ index.json.sig written: serial ${index.serial}, ${index.entries.length} templates, expires ${index.expires.slice(0, 10)}.`);
console.log(`  Signed with the key whose public half is ${rawPublicKey(pub.export({ format: 'der', type: 'spki' }))}`);
console.log('  Commit index.json and index.json.sig together.');
