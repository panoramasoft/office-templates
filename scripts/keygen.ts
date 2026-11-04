// Make the gallery's signing key, once, on the human's Mac. The private key is written OUTSIDE
// this repository (never commit it, never put it in CI); the public key is printed for the app
// (GALLERY_KEYS in app server/galleryOnline.ts) and for keys/public-keys.txt here.
//   node scripts/keygen.ts                    writes ~/.office-templates-key/signing-key.pem
//   node scripts/keygen.ts --out <file.pem>   writes there instead (still never in this repo)

import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, fail, rawPublicKey } from './lib.ts';

const at = process.argv.indexOf('--out');
const out = path.resolve(at > 0 ? process.argv[at + 1] : path.join(os.homedir(), '.office-templates-key', 'signing-key.pem'));
const inside = path.relative(ROOT, out);
if (!inside.startsWith('..') && !path.isAbsolute(inside)) fail('The private key must not be written inside this repository. Pick a folder outside it.');
if (fs.existsSync(out)) fail(`${out} already exists. Keygen never overwrites a key: move it away first if you mean to replace it.`);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
fs.writeFileSync(out, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
fs.chmodSync(out, 0o600);
const pub = rawPublicKey(publicKey.export({ format: 'der', type: 'spki' }));
console.log(`✓ Private key written to ${out} (only you can read it). Back it up somewhere safe and offline.`);
console.log('  Never commit it, paste it anywhere, or give it to CI.');
console.log('');
console.log(`Public key (safe to share): ${pub}`);
console.log('  Send this to the app team for GALLERY_KEYS, and add it as a line in keys/public-keys.txt.');
