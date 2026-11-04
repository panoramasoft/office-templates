// What a signed index may say, re-derived from origin/main, never taken from the file on disk
// (review 7C-4 S1). make-index writes from these rules; sign checks every field against them
// before signing, so a hand-edited or stale index.json can't be signed:
// - every commit is on origin/main (GitHub serves a fork's commits under this repository's raw
//   address, so a pull request's own commit would ship unreviewed content as reviewed);
// - each entry is exactly what built/<id>.json at that commit says, hash included;
// - the entries are exactly the templates on origin/main (a withdrawn one can't stay listed);
// - the serial is higher than the one on origin/main, and the dates are ones the app accepts.

import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { validateTemplate } from '../checker/template.ts';
import { INDEX_FORMAT, MAX_SIGNED_DAYS, ROOT, sha256 } from './lib.ts';

export const MAIN = 'origin/main';

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
const gitOk = (...args: string[]) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};

/** Bring origin/main up to date. Offline, the last fetched origin/main is used, and said so. */
export function fetchMain(): void {
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    console.warn('! Could not fetch origin/main (offline?): using the last one fetched.');
  }
  if (!gitOk('rev-parse', '--verify', '--quiet', `${MAIN}^{commit}`)) throw new Error('There is no origin/main yet. The index is made from main, after the reviewed templates are merged.');
}

export const mainCommit = (): string => git('rev-parse', `${MAIN}^{commit}`).toString().trim();

/** The serial of the index on origin/main, or 0 when main has none yet. */
export function mainSerial(): number {
  if (!gitOk('cat-file', '-e', `${MAIN}:index.json`)) return 0;
  const serial = (JSON.parse(git('show', `${MAIN}:index.json`).toString('utf8')) as { serial?: unknown }).serial;
  return typeof serial === 'number' && Number.isInteger(serial) && serial > 0 ? serial : 0;
}

/** The template ids with a built file on origin/main. */
export function mainIds(): string[] {
  return git('ls-tree', '--name-only', `${MAIN}:built`)
    .toString()
    .split('\n')
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** Whether a commit is on origin/main (the commit itself or an ancestor of it). */
export const onMain = (commit: string): boolean => /^[0-9a-f]{40}$/.test(commit) && gitOk('merge-base', '--is-ancestor', commit, MAIN);

/** The entry the index must hold for a template at a commit, from that commit's built file. */
export function entryAt(id: string, commit: string) {
  const path = `built/${id}.json`;
  const bytes = git('show', `${commit}:${path}`);
  const t = validateTemplate(JSON.parse(bytes.toString('utf8')));
  return {
    id,
    name: t.name,
    description: t.description,
    version: t.version,
    ...(t.industry ? { industry: t.industry } : {}),
    ...(t.author ? { author: t.author } : {}),
    commit,
    path,
    sha256: sha256(bytes),
    roleCount: t.roles.length,
    fileCount: t.files.length,
    scheduleCount: t.schedules.length,
  };
}

// The app's own index schema (app server/galleryOnline.ts): no other keys, the same limits.
const entrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    version: z.string().min(1).max(40),
    industry: z.string().min(1).max(60).optional(),
    author: z.string().min(1).max(100).optional(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    path: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    roleCount: z.number().int().min(0).max(100),
    fileCount: z.number().int().min(0).max(1000),
    scheduleCount: z.number().int().min(0).max(100),
  })
  .strict();
const indexSchema = z
  .object({
    format: z.literal(INDEX_FORMAT),
    serial: z.number().int().min(1),
    signedAt: z.string(),
    expires: z.string(),
    entries: z.array(entrySchema).max(500),
  })
  .strict();

const DAY = 24 * 3600_000;
/** Key order doesn't matter when comparing an entry with the expected one. */
const canonical = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

/**
 * Every reason this index must not be signed, re-derived from origin/main. Empty: sign it.
 * `bytes` is exactly what will be signed.
 */
export function refusals(bytes: Buffer, now = Date.now()): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    return ['index.json is not JSON.'];
  }
  const parsed = indexSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `index.json: ${i.path.join('.') || 'the file'}: ${i.message}`);
  const index = parsed.data;
  const out: string[] = [];

  const previous = mainSerial();
  if (index.serial <= previous) out.push(`The serial is ${index.serial}, but main already has ${previous}. Run node scripts/make-index.ts again.`);

  const signedAt = Date.parse(index.signedAt);
  const expires = Date.parse(index.expires);
  if (!Number.isFinite(signedAt) || !Number.isFinite(expires)) out.push('index.json has no valid signedAt or expires date.');
  else {
    if (signedAt > now + 5 * 60_000) out.push('signedAt is in the future.');
    if (expires - signedAt > MAX_SIGNED_DAYS * DAY) out.push(`It is signed for longer than ${MAX_SIGNED_DAYS} days; the app would refuse it.`);
    if (expires <= now) out.push('It has already expired. Run node scripts/make-index.ts again.');
  }

  const ids = index.entries.map((e) => e.id);
  const want = mainIds();
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(want)) out.push(`The entries must be exactly the templates on main (${want.join(', ') || 'none'}); the index lists ${ids.join(', ') || 'none'}.`);

  for (const e of index.entries) {
    if (e.path !== `built/${e.id}.json`) {
      out.push(`${e.id}: the path must be built/${e.id}.json.`);
      continue;
    }
    if (!onMain(e.commit)) {
      out.push(`${e.id}: commit ${e.commit.slice(0, 7)} is not on main. Only reviewed, merged commits may be pinned.`);
      continue;
    }
    let expected: ReturnType<typeof entryAt>;
    try {
      expected = entryAt(e.id, e.commit);
    } catch {
      out.push(`${e.id}: commit ${e.commit.slice(0, 7)} has no valid built/${e.id}.json.`);
      continue;
    }
    if (expected.sha256 !== e.sha256) out.push(`${e.id}: the sha256 is not the one of built/${e.id}.json at ${e.commit.slice(0, 7)}.`);
    else if (canonical(expected) !== canonical(e)) out.push(`${e.id}: the name, description, version or counts differ from built/${e.id}.json at ${e.commit.slice(0, 7)}.`);
  }
  return out;
}
