// Build built/<id>.json from templates/<id>/ (manifest.json plus files/), with the app's own
// packer (checker/, copied from the app). The app fetches the built file at a pinned commit and
// checks its SHA-256, so every starter file is covered by one hash (design 7C §3.2, O2).
//   node scripts/build.ts          write built/
//   node scripts/build.ts --check  fail if built/ differs from what the templates build to (CI)

import fs from 'node:fs';
import path from 'node:path';
import { packGalleryEntry } from '../checker/template.ts';
import { BUILT, ID, TEMPLATES, builtText, fail, templateIds } from './lib.ts';

const check = process.argv.includes('--check');
const ids = templateIds();
let problems = 0;
for (const id of ids) {
  if (!ID.test(id)) fail(`templates/${id}: a folder name is lower-case letters, digits and dashes.`);
  let text: string;
  try {
    text = builtText(packGalleryEntry(path.join(TEMPLATES, id)));
  } catch (err) {
    console.error(`✗ templates/${id}: ${err instanceof Error ? err.message : String(err)}`);
    problems++;
    continue;
  }
  const out = path.join(BUILT, `${id}.json`);
  if (check) {
    const had = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (had !== text) {
      console.error(`✗ built/${id}.json is not what templates/${id} builds to. Run: node scripts/build.ts`);
      problems++;
    }
  } else {
    fs.mkdirSync(BUILT, { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`built/${id}.json`);
  }
}
// A built file with no template behind it would be listed with nothing to review.
for (const f of fs.existsSync(BUILT) ? fs.readdirSync(BUILT) : []) {
  if (!f.endsWith('.json') || !ids.includes(f.slice(0, -5))) {
    console.error(`✗ built/${f} has no templates/ folder.`);
    problems++;
  }
}
if (problems) process.exit(1);
console.log(check ? `✓ built/ matches templates/ (${ids.length} templates)` : `✓ ${ids.length} templates built`);
