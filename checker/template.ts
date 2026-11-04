// Office templates (virtual-office-template@1, and @2 when it proposes connectors): a reusable office (a manager brief, roles,
// starter files and suggested schedules) as one JSON file, so it downloads and uploads
// from a phone. A template is data, not instructions to the app: the schema is strict,
// so there is simply no field for keys, budgets, tools, enabled schedules or the office
// folder, and every string and list is capped. Industry content lives in templates
// (app/gallery/), never in app code.
//
// Gallery entries are authored as folders (manifest.json + files/) so they read well in
// diffs; packGalleryEntry turns one into a template through the same validator.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { OfficeError } from './errors.ts';
import { isValidTime } from './schedule.ts';
import { roleRefs } from './placeholders.ts';
import { asksFor } from './templateAsks.ts';

export { asksFor };

export const TEMPLATE_FORMAT = 'virtual-office-template@1';
/** Phase 3b (§11, N4): a template that proposes connectors is written as @2, so an older app
 *  says "made with a newer version" instead of "unknown key". @1 files read unchanged. */
export const TEMPLATE_FORMAT_2 = 'virtual-office-template@2';
/** Phase 5 (C13): a template with `starterGoals` is written as @3, for the same reason. */
export const TEMPLATE_FORMAT_3 = 'virtual-office-template@3';
/** Phase 6 (§6.1): purpose, audience, required connectors, account slots and personal files.
 *  An @4 file has a manager. Older files read unchanged. */
export const TEMPLATE_FORMAT_4 = 'virtual-office-template@4';
/** The newest template format this app reads. */
const NEWEST_FORMAT = 4;
const FORMAT_RE = /^virtual-office-template@(\d{1,4})$/;

/** Limits (design note, section 5). */
export const TEMPLATE_CAPS = {
  templateBytes: 5_000_000,
  roles: 20,
  files: 200,
  fileBytes: 500_000,
  folders: 100,
  instructionChars: 20_000,
  schedules: 20,
  scheduleTitleChars: 120,
  pathChars: 200,
  connectors: 40,
  starterGoals: 5,
  starterGoalChars: 300,
  purposeChars: 200,
  personalFiles: 20,
  accountSlots: 6,
  slotLabelChars: 40,
  slotHintChars: 160,
} as const;

import { hiddenCharacter, normaliseText } from './templateSafety.ts';
export { PLACEHOLDERS, fillPlaceholders, type PlaceholderNames } from './placeholders.ts';

/** Starter files are text only; anything else is left out of a template. */
export const TEXT_EXTENSIONS = ['.md', '.txt', '.csv', '.json', '.html', '.yaml', '.yml'];

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_VERSION: string = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;
export const GALLERY_DIR = path.join(here, '..', 'gallery');

// ---------- paths ----------

/** Why a path can't be in a template, or null if it's fine. */
export function pathProblem(p: string, kind: 'file' | 'folder'): string | null {
  if (!p || p.length > TEMPLATE_CAPS.pathChars) return 'must be 1 to 200 characters';
  if (p.includes('\\') || p.includes('\0')) return 'must use forward slashes';
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return 'must be relative to the office folder';
  const parts = p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return 'must not contain empty, "." or ".." parts';
  // Covers .office/ (the app's own data) and hidden files like .env.
  if (parts.some((s) => s.startsWith('.'))) return 'must not name a hidden file or folder';
  if (kind === 'file' && !TEXT_EXTENSIONS.includes(path.extname(p).toLowerCase())) {
    return `must be a text file (${TEXT_EXTENSIONS.join(', ')})`;
  }
  return null;
}

const filePath = z.string().superRefine((p, ctx) => {
  const problem = pathProblem(p, 'file');
  if (problem) ctx.addIssue({ code: 'custom', message: `File path "${p}" ${problem}.` });
});
const folderPath = z.string().superRefine((p, ctx) => {
  const problem = pathProblem(p, 'folder');
  if (problem) ctx.addIssue({ code: 'custom', message: `Folder "${p}" ${problem}.` });
});

// ---------- schema ----------

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'must look like 1.2.3');
const instructions = z.string().max(TEMPLATE_CAPS.instructionChars);
const suggestedModel = z.strictObject({
  provider: z.enum(['anthropic', 'gemini', 'openai']),
  // Model ids are looked up in price and suggestion tables, so no spaces, odd characters
  // or names an object already has ("constructor", "__proto__").
  model: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/, 'must be a model id like claude-sonnet-5-5')
    .refine((m) => !(m in Object.prototype), 'must be a model id like claude-sonnet-5-5'),
});

const manager = z.strictObject({
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  instructions,
  suggestedModel: suggestedModel.optional(),
});

const role = manager.extend({
  /** How schedules refer to this role; stable even if the user renames the person. */
  key: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/, 'must be lowercase letters, digits or dashes')
    // Schedules and model choices name the manager by this key, so a role can't take it.
    .refine((k) => k !== 'manager', 'is reserved for the manager'),
});

const schedule = z.strictObject({
  role: z.string(),
  title: z.string().trim().min(1).max(TEMPLATE_CAPS.scheduleTitleChars),
  instructions,
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: z.string().refine(isValidTime, 'must look like 08:00 or 17:30'),
});

const file = z.strictObject({
  path: filePath,
  text: z.string().refine((t) => Buffer.byteLength(t) <= TEMPLATE_CAPS.fileBytes, 'is larger than 500 KB'),
});

/**
 * A connector the template suggests for a role (§11). Proposed, never granted by the file:
 * the boss ticks it at import, on the Mac, and only a connector set up here can be granted.
 * By catalog id only: there is no field for a command, an address, a secret, a tool list or
 * the private flag, so a template can't bring a connector with it.
 */
const connectorId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, 'must be a connector id like calendar-caldav');
const connectorProposal = z.strictObject({
  role: z.string(),
  id: connectorId,
  access: z.enum(['read', 'act']),
  why: z.string().trim().max(300).optional(),
  /** @4: shown as "Set this up first" when the office is made. It never blocks making it. */
  required: z.boolean().optional(),
});

/** One line of plain text: no control or format characters, so it shows exactly as written. */
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(v), 'must be one line of plain text');

/**
 * @4: a kind of account the office asks the boss to pick when it is made ("Which mailbox?").
 * It names a kind by catalog id, never an account: there is no field for one.
 */
const accountSlot = z.strictObject({
  connector: connectorId,
  label: oneLine(TEMPLATE_CAPS.slotLabelChars),
  hint: oneLine(TEMPLATE_CAPS.slotHintChars).optional(),
});

/** Why a personal-files entry can't be used, or null. A file path, or a folder as `folder/**`; no other patterns. */
export function personalPatternProblem(p: string): string | null {
  const base = p.endsWith('/**') ? p.slice(0, -3) : p;
  if (/[*?[\]{}]/.test(base)) return 'must be a file path or a folder followed by /**, with no other patterns';
  return pathProblem(base, 'folder');
}

/** At most this many personal-file patterns are kept for one office (from every template it used). */
export const OFFICE_PERSONAL_MAX = 100;

/** The valid patterns, once each (ignoring case), at most OFFICE_PERSONAL_MAX. */
export function cleanPersonalFiles(list: unknown[]): string[] {
  const out: string[] = [];
  for (const p of list) {
    if (typeof p !== 'string' || personalPatternProblem(p) || out.some((x) => x.toLowerCase() === p.toLowerCase())) continue;
    if (out.length >= OFFICE_PERSONAL_MAX) break;
    out.push(p);
  }
  return out;
}

/** An account slot as an office remembers it: which kind of account, and the template's words for it. */
export type AccountSlot = { connector: string; label: string; hint?: string };

/** At most this many account slots are kept for one office (from every template it used). */
export const OFFICE_SLOTS_MAX = 20;

/** The valid slots, one per connector kind (the first template's words win), at most OFFICE_SLOTS_MAX. */
export function cleanAccountSlots(list: unknown[]): AccountSlot[] {
  const out: AccountSlot[] = [];
  for (const raw of list) {
    const r = accountSlot.safeParse(raw);
    if (!r.success || out.some((s) => s.connector === r.data.connector)) continue;
    if (out.length >= OFFICE_SLOTS_MAX) break;
    out.push({ connector: r.data.connector, label: r.data.label, ...(r.data.hint ? { hint: r.data.hint } : {}) });
  }
  return out;
}

/** @4: the files that hold the boss's own data. Never saved in a template (review 6, M9). */
const personalPattern = z.string().superRefine((p, ctx) => {
  const problem = personalPatternProblem(p);
  if (problem) ctx.addIssue({ code: 'custom', message: `Personal file "${p}" ${problem}.` });
});

/** Whether a drive path is one of the personal files: the path itself, or inside a `folder/**`. Ignores case, as the Mac's disk does. */
export function isPersonalPath(p: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns?.length) return false;
  const low = p.toLowerCase();
  return patterns.some((raw) => {
    const pat = raw.toLowerCase();
    return pat.endsWith('/**') ? low.startsWith(pat.slice(0, -2)) : low === pat;
  });
}

/** Plain text, one line: no control characters, so a goal shows exactly as it will be sent. */
const starterGoal = z
  .string()
  .trim()
  .min(1)
  .max(TEMPLATE_CAPS.starterGoalChars)
  .refine((g) => !/[\u0000-\u001f\u007f]/.test(g), 'must be one line of plain text');

const templateSchema = z
  .strictObject({
    format: z.enum([TEMPLATE_FORMAT, TEMPLATE_FORMAT_2, TEMPLATE_FORMAT_3, TEMPLATE_FORMAT_4]),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000),
    industry: z.string().trim().min(1).max(60),
    version: semver,
    minAppVersion: semver,
    author: z.string().max(100).optional(),
    setupNotes: z.string().max(5000).optional(),
    manager: manager.optional(),
    roles: z.array(role).max(TEMPLATE_CAPS.roles),
    files: z.array(file).max(TEMPLATE_CAPS.files),
    folders: z.array(folderPath).max(TEMPLATE_CAPS.folders),
    schedules: z.array(schedule).max(TEMPLATE_CAPS.schedules),
    connectors: z.array(connectorProposal).max(TEMPLATE_CAPS.connectors).optional(),
    /** The floor plan's name only (PNR-144), never desks or art. One this build doesn't know means studio. */
    floorPlan: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/).optional(),
    /** First goals the setup screen offers the boss (C13): shown in full, sent only on Send. */
    starterGoals: z.array(starterGoal).min(1).max(TEMPLATE_CAPS.starterGoals).optional(),
    /** @4: one line for the catalogue card. */
    purpose: oneLine(TEMPLATE_CAPS.purposeChars).optional(),
    /** @4: groups the catalogue cards ("For you", "For a business"). No other effect. */
    audience: z.enum(['individual', 'business']).optional(),
    /** @4: the kinds of account the office asks for when it is made. */
    accountSlots: z.array(accountSlot).max(TEMPLATE_CAPS.accountSlots).optional(),
    /** @4: files holding the boss's own data; left out of every saved template (M9). */
    personalFiles: z.array(personalPattern).max(TEMPLATE_CAPS.personalFiles).optional(),
  })
  .superRefine((t, ctx) => {
    const dupes = (list: string[]) => list.filter((x, i) => list.indexOf(x) !== i);
    const names = [...(t.manager ? [t.manager.name] : []), ...t.roles.map((r) => r.name)].map((n) => n.toLowerCase());
    for (const d of dupes(names)) ctx.addIssue({ code: 'custom', message: `Two people are called "${d}".` });
    for (const d of dupes(t.roles.map((r) => r.key))) ctx.addIssue({ code: 'custom', message: `Two roles have the key "${d}".` });
    for (const d of dupes(t.files.map((f) => f.path.toLowerCase()))) ctx.addIssue({ code: 'custom', message: `The file "${d}" appears twice.` });
    // A path can't be both a file and a folder: no file is also a folder, and nothing sits
    // inside a file. Compared ignoring case, as the Mac's disk does.
    const folders = new Map(t.folders.map((f) => [f.toLowerCase(), f]));
    const files = new Map(t.files.map((f) => [f.path.toLowerCase(), f.path]));
    for (const [low, p] of files) if (folders.has(low)) ctx.addIssue({ code: 'custom', message: `"${p}" is both a file and a folder in this template.` });
    for (const [low, p] of [...files, ...folders]) {
      const parts = low.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = files.get(parts.slice(0, i).join('/'));
        if (parent) ctx.addIssue({ code: 'custom', message: `"${p}" is inside "${parent}", which is a file in this template.` });
      }
    }
    const keys = new Set(t.roles.map((r) => r.key));
    // {{name:<key>}} must name a role in this template, or the manager (every office has one).
    const known = new Set([...keys, 'manager']);
    const texts: [string, string][] = [
      ['setupNotes', t.setupNotes ?? ''],
      ...(t.manager ? ([['manager', `${t.manager.title}\n${t.manager.instructions}`]] as [string, string][]) : []),
      ...t.roles.map((r): [string, string] => [r.name, `${r.title}\n${r.instructions}`]),
      ...t.schedules.map((s): [string, string] => [`schedule "${s.title}"`, `${s.title}\n${s.instructions}`]),
      ...(t.starterGoals ?? []).map((g, i): [string, string] => [`starter goal ${i + 1}`, g]),
    ];
    for (const [where, text] of texts) {
      for (const key of roleRefs(text)) {
        if (!known.has(key)) ctx.addIssue({ code: 'custom', message: `${where} mentions {{name:${key}}}, but no role in this template has the key "${key}".` });
      }
    }
    if (t.manager) keys.add('manager');
    for (const s of t.schedules) {
      if (!keys.has(s.role)) ctx.addIssue({ code: 'custom', message: `Schedule "${s.title}" is for "${s.role}", who isn't in this template.` });
    }
    if (t.connectors && t.format === TEMPLATE_FORMAT) ctx.addIssue({ code: 'custom', message: `A template that proposes connectors must say format "${TEMPLATE_FORMAT_2}" or later.` });
    if (t.starterGoals && t.format !== TEMPLATE_FORMAT_3 && t.format !== TEMPLATE_FORMAT_4) ctx.addIssue({ code: 'custom', message: `A template with starter goals must say format "${TEMPLATE_FORMAT_3}" or later.` });
    const uses4 = t.purpose !== undefined || t.audience !== undefined || t.accountSlots !== undefined || t.personalFiles !== undefined || (t.connectors ?? []).some((c) => c.required !== undefined);
    if (uses4 && t.format !== TEMPLATE_FORMAT_4) ctx.addIssue({ code: 'custom', message: `A template with a purpose, an audience, account slots, personal files or required connectors must say format "${TEMPLATE_FORMAT_4}".` });
    if (t.format === TEMPLATE_FORMAT_4 && !t.manager) ctx.addIssue({ code: 'custom', message: 'A template in this format must have a manager.' });
    for (const d of dupes((t.accountSlots ?? []).map((a) => a.connector))) ctx.addIssue({ code: 'custom', message: `Two account slots are for "${d}"; an office picks one account of each kind.` });
    for (const d of dupes((t.personalFiles ?? []).map((p) => p.toLowerCase()))) ctx.addIssue({ code: 'custom', message: `The personal file "${d}" appears twice.` });
    // The manager is always hired, so it may be proposed one even without a brief of its own.
    const people = new Set([...keys, 'manager']);
    const seenProposal = new Set<string>();
    for (const c of t.connectors ?? []) {
      if (!people.has(c.role)) ctx.addIssue({ code: 'custom', message: `The connector "${c.id}" is proposed for "${c.role}", who isn't in this template.` });
      const k = `${c.role}:${c.id}`;
      if (seenProposal.has(k)) ctx.addIssue({ code: 'custom', message: `The connector "${c.id}" is proposed twice for "${c.role}".` });
      seenProposal.add(k);
    }
  });

export type OfficeTemplate = z.infer<typeof templateSchema>;
export type TemplateRole = z.infer<typeof role>;

function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * Check anything claiming to be a template. Throws an OfficeError in plain language
 * (the first few problems), so an upload can say what is wrong with the file.
 */
export function validateTemplate(raw: unknown, appVersion = APP_VERSION): OfficeTemplate {
  // 7C-1 (R3): Windows line endings become plain ones first, so only a stray carriage return is refused.
  raw = normaliseText(raw);
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw) ?? '');
  } catch {
    throw new OfficeError('This is not a valid office template.');
  }
  if (size > TEMPLATE_CAPS.templateBytes) throw new OfficeError('This template is larger than 5 MB.');
  // A later format: say so plainly instead of listing unknown fields (N4).
  const format = raw && typeof raw === 'object' ? (raw as { format?: unknown }).format : undefined;
  const m = typeof format === 'string' ? FORMAT_RE.exec(format) : null;
  if (m && Number(m[1]) > NEWEST_FORMAT) throw new OfficeError('This template was made with a newer version of the app. Update the app to use it.');
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 3).map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
    throw new OfficeError(`This is not a valid office template. ${problems.join('; ')}`);
  }
  if (newer(parsed.data.minAppVersion, appVersion)) {
    throw new OfficeError(`This template needs version ${parsed.data.minAppVersion} of the app or newer (this is ${appVersion}).`);
  }
  // R3: a character that can't be seen, in any string, file contents included (review 7C O3).
  const hidden = hiddenCharacter(parsed.data);
  if (hidden) throw new OfficeError(`This template can't be used: ${hidden}`);
  return parsed.data;
}

// ---------- the gallery ----------

/** Every file under `dir`, as forward-slash paths relative to it. Symlinks are refused. */
function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue; // made by macOS Finder, never part of a template
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new OfficeError(`${rel} is a link; templates hold plain files only.`);
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Turn app/gallery/<id>/ (manifest.json, plus starter files under files/) into a validated template. */
export function packGalleryEntry(folder: string, appVersion = APP_VERSION): OfficeTemplate {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  if ('files' in manifest) throw new OfficeError('A gallery manifest lists no files; they live in files/.');
  const filesDir = path.join(folder, 'files');
  const files = fs.existsSync(filesDir)
    ? listFiles(filesDir).sort().map((p) => ({ path: p, text: fs.readFileSync(path.join(filesDir, p), 'utf8') }))
    : [];
  return validateTemplate({ ...manifest, files }, appVersion);
}

export interface GalleryEntry {
  id: string;
  template: OfficeTemplate;
}

/** Pack every gallery entry. A broken one is skipped and logged, never fatal. */
export function loadGallery(dir = GALLERY_DIR, appVersion = APP_VERSION): GalleryEntry[] {
  if (!fs.existsSync(dir)) return [];
  const out: GalleryEntry[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[a-z0-9-]+$/.test(entry.name)) continue;
    try {
      out.push({ id: entry.name, template: packGalleryEntry(path.join(dir, entry.name), appVersion) });
    } catch (err) {
      console.warn(`Skipping gallery template "${entry.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/** At most this many catalogue entries (review 6, S6). */
export const CATALOG_MAX = 12;

/**
 * The catalogue (§6.2): app/gallery/catalog.json orders the entries New office shows first.
 * Checked when it is loaded (review 6, S6): `v` 1, at most 12 ids, each a gallery folder that
 * packed as @4. A bad entry is skipped with one log line; a bad file gives no catalogue (plain
 * gallery order). It never stops start-up.
 */
export function loadCatalogIndex(gallery: GalleryEntry[], file = path.join(GALLERY_DIR, 'catalog.json'), log: (line: string) => void = console.warn): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log('The template catalogue (catalog.json) could not be read; showing the gallery in plain order.');
    return [];
  }
  const c = raw as { v?: unknown; entries?: unknown };
  if (!c || typeof c !== 'object' || c.v !== 1 || !Array.isArray(c.entries) || c.entries.length > CATALOG_MAX) {
    log('The template catalogue (catalog.json) is not valid; showing the gallery in plain order.');
    return [];
  }
  const out: string[] = [];
  for (const id of c.entries) {
    const entry = typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id) ? gallery.find((g) => g.id === id) : undefined;
    if (!entry || entry.template.format !== TEMPLATE_FORMAT_4 || out.includes(entry.id)) {
      log(`Skipping catalogue entry ${JSON.stringify(id).slice(0, 60)}: not a gallery template in the newest format.`);
      continue;
    }
    out.push(entry.id);
  }
  return out;
}

/** What the gallery list shows: counts and notes, never the file bodies. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  industry: string;
  roleCount: number;
  fileCount: number;
  scheduleCount: number;
  connectorCount: number;
  setupNotes?: string;
  purpose?: string;
  audience?: 'individual' | 'business';
  /** "Asks for": each connector kind from the account slots and proposals, once, required ones marked. */
  asks?: { id: string; required: boolean; name?: string }[];
}


export function summarize(entry: GalleryEntry): TemplateSummary {
  const t = entry.template;
  return {
    id: entry.id,
    name: t.name,
    description: t.description,
    industry: t.industry,
    roleCount: t.roles.length + (t.manager ? 1 : 0),
    fileCount: t.files.length,
    scheduleCount: t.schedules.length,
    connectorCount: t.connectors?.length ?? 0,
    setupNotes: t.setupNotes,
    ...(t.purpose ? { purpose: t.purpose } : {}),
    ...(t.audience ? { audience: t.audience } : {}),
    ...(t.accountSlots || t.connectors ? { asks: asksFor(t) } : {}),
  };
}
