// Sign index.json, on the human's Mac, with the key from scripts/keygen.ts. The signature covers
// the exact bytes of index.json, which the app checks before reading anything else (design 7C
// §3.3, O10). Writes index.json.sig; commit both files.
//   node scripts/sign.ts                    uses ~/.office-templates-key/signing-key.pem
//   node scripts/sign.ts --key <file.pem>

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INDEX, INDEX_FORMAT, MAX_SIGNED_DAYS, SIGNATURE, fail, rawPublicKey } from './lib.ts';

const at = process.argv.indexOf('--key');
const keyFile = path.resolve(at > 0 ? process.argv[at + 1] : path.join(os.homedir(), '.office-templates-key', 'signing-key.pem'));
if (!fs.existsSync(keyFile)) fail(`No key at ${keyFile}. Run node scripts/keygen.ts first, or pass --key.`);
if (!fs.existsSync(INDEX)) fail('No index.json. Run node scripts/make-index.ts first.');

const bytes = fs.readFileSync(INDEX);
const index = JSON.parse(bytes.toString('utf8')) as { format?: string; serial?: number; signedAt?: string; expires?: string; entries?: unknown[] };
// The app's own limits, checked here so a signed index is never one the app refuses.
if (index.format !== INDEX_FORMAT) fail(`index.json is not in the format ${INDEX_FORMAT}.`);
if (!Number.isInteger(index.serial) || index.serial! < 1) fail('index.json has no serial.');
const signedAt = Date.parse(index.signedAt ?? '');
const expires = Date.parse(index.expires ?? '');
if (!Number.isFinite(signedAt) || !Number.isFinite(expires)) fail('index.json has no signedAt or expires date.');
if (expires - signedAt > MAX_SIGNED_DAYS * 24 * 3600_000) fail(`index.json is signed for longer than ${MAX_SIGNED_DAYS} days; the app would refuse it.`);
if (expires <= Date.now()) fail('index.json has already expired. Run node scripts/make-index.ts again.');

const key = createPrivateKey(fs.readFileSync(keyFile));
const signature = sign(null, bytes, key);
const pub = createPublicKey(key);
if (!verify(null, bytes, pub, signature)) fail('The signature did not verify. Nothing was written.');
fs.writeFileSync(SIGNATURE, `${signature.toString('base64')}\n`);
console.log(`✓ index.json.sig written: serial ${index.serial}, ${index.entries?.length ?? 0} templates, expires ${index.expires!.slice(0, 10)}.`);
console.log(`  Signed with the key whose public half is ${rawPublicKey(pub.export({ format: 'der', type: 'spki' }))}`);
console.log('  Commit index.json and index.json.sig together.');
