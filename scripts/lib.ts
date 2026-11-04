// Shared by the scripts: where things are, and the index format the app reads
// (app server/galleryOnline.ts). Keep the two in step.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATES = path.join(ROOT, 'templates');
export const BUILT = path.join(ROOT, 'built');
export const INDEX = path.join(ROOT, 'index.json');
export const SIGNATURE = path.join(ROOT, 'index.json.sig');
export const PUBLIC_KEYS = path.join(ROOT, 'keys', 'public-keys.txt');

export const INDEX_FORMAT = 'virtual-office-gallery-index@1';
/** The app refuses an index signed for longer than this. */
export const MAX_SIGNED_DAYS = 90;
/** What make-index sets, leaving room before the app's limit. */
export const SIGNED_DAYS = 60;
export const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Template ids: one folder each under templates/. */
export function templateIds(): string[] {
  return fs
    .readdirSync(TEMPLATES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** A built file's exact text: the packed template, two-space JSON, one final newline. */
export const builtText = (template: unknown) => `${JSON.stringify(template, null, 2)}\n`;

/** The 32-byte Ed25519 public key, base64, from a key object (what the app's GALLERY_KEYS holds). */
export function rawPublicKey(spkiDer: Buffer): string {
  return spkiDer.subarray(spkiDer.length - 32).toString('base64');
}

export function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
