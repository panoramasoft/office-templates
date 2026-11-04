// The checks a pull request must pass, with the app's own rules (checker/, copied from the app):
// the template format and size caps, characters you can't see (R3), and the reviewer's list of
// addresses and lines to read carefully (R2, R4). Warnings never fail the check: a person reads
// them. Never runs anything from a template.

import fs from 'node:fs';
import path from 'node:path';
import { validateTemplate } from '../checker/template.ts';
import { templateAddresses, templateWarnings } from '../checker/templateSafety.ts';
import { BUILT, fail, templateIds } from './lib.ts';

const ids = templateIds();
let problems = 0;
for (const id of ids) {
  const file = path.join(BUILT, `${id}.json`);
  if (!fs.existsSync(file)) fail(`built/${id}.json is missing. Run: node scripts/build.ts`);
  try {
    const t = validateTemplate(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!t.manager) throw new Error('a gallery template has a manager');
    if (!t.purpose || !t.audience) throw new Error('a gallery template says its purpose and audience');
    // The app's gallery list takes a description of at most 500 characters (app server/galleryOnline.ts).
    if (t.description.length > 500) throw new Error('a gallery description is at most 500 characters');
    for (const w of templateWarnings(t)) console.log(`::warning title=${id}: read carefully::${w.where} ${w.why}: "${w.line}"`);
    const addresses = templateAddresses(t);
    if (addresses.length) console.log(`::notice title=${id}: addresses::${addresses.map((a) => `${a.text}${a.punycode ? ` (really ${a.punycode})` : ''} in ${a.where.join(', ')}`).join('; ')}`);
    console.log(`✓ ${id}`);
  } catch (err) {
    console.error(`✗ ${id}: ${err instanceof Error ? err.message : String(err)}`);
    problems++;
  }
}
if (problems) process.exit(1);
