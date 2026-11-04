// What a template from outside must pass, and what its preview must point out (7C-1, design
// phase-7c-gallery-design.md §4). A template's text goes into AI instructions and starter files,
// so hiding text from the boss is the attack: R3 refuses every character that can't be seen, by
// Unicode category, in every string; R2 lists every address a line could send work to; R4 flags
// phrases that read like an attempt to steer the AI. Pure, no Node imports: the web preview
// folds long runs with foldRuns() from here.

import type { OfficeTemplate } from './template.ts';

// ---------- every string, with where it is ----------

export interface TemplateText {
  /** For the boss: "Ada's instructions", "the file notes/plan.md", "schedule \"Weekly report\"". */
  where: string;
  text: string;
}

/** Every string in a (parsed) template, labelled. A generic walk, so a new field is never missed. */
export function templateTexts(t: OfficeTemplate): TemplateText[] {
  const out: TemplateText[] = [];
  const label = (p: (string | number)[]): string => {
    const [top, i, field] = p;
    if (top === 'roles' && typeof i === 'number') {
      const r = t.roles[i];
      const who = r?.name || `role ${i + 1}`;
      return field === 'instructions' ? `${who}'s instructions` : `${who}'s ${String(field ?? 'role')}`;
    }
    if (top === 'manager') return field === undefined && typeof i === 'string' ? `the manager's ${i}` : "the manager's brief";
    if (top === 'files' && typeof i === 'number') {
      const f = t.files[i];
      return field === 'text' ? `the file ${f?.path ?? i + 1}` : 'a file name';
    }
    if (top === 'schedules' && typeof i === 'number') return `schedule "${t.schedules[i]?.title ?? i + 1}"`;
    if (top === 'starterGoals' && typeof i === 'number') return `starter goal ${i + 1}`;
    if (top === 'folders') return 'a folder name';
    if (top === 'connectors' && typeof i === 'number') return `connector suggestion ${i + 1}`;
    if (top === 'accountSlots' && typeof i === 'number') return `account question ${i + 1}`;
    if (top === 'personalFiles') return 'a personal-file pattern';
    if (top === 'setupNotes') return 'the setup notes';
    if (top === 'purpose') return "the template's one-line description";
    if (top === 'description') return "the template's description";
    if (top === 'name') return "the template's name";
    return `the template's ${p.join('.')}`;
  };
  const walk = (v: unknown, p: (string | number)[]) => {
    if (typeof v === 'string') out.push({ where: label(p), text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
  };
  walk(t, []);
  return out;
}

// ---------- R3: characters you can't see ----------

/**
 * Format (Cf: zero-width, direction controls, tag characters…), control (Cc) other than tab and
 * line feed, private use (Co), lone surrogates (Cs), the variation selectors (review 7C O3), and
 * every default-ignorable code point plus the braille blank: letters and marks that draw as
 * nothing, such as U+3164, U+115F and U+034F (review 7C-1 S2). One exception: U+FE0F right after
 * an emoji or a keycap digit, which is how ordinary emoji such as the check mark emoji are written (review 7C-1 N1).
 * Written as escapes, so a reader of this file sees every character in it (N2).
 */
const HIDDEN = /(?!(?<=[\p{Extended_Pictographic}#*0-9])\uFE0F)(?:[\p{Cf}\p{Co}\p{Cs}\p{Default_Ignorable_Code_Point}\u2800\uFE00-\uFE0F\u{E0100}-\u{E01EF}]|(?![\t\n])\p{Cc})/u;

/** Windows line endings (CR LF) become LF, and a leading byte-order mark goes, before R3 runs. */
export function normaliseText(raw: unknown): unknown {
  if (typeof raw === 'string') return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (Array.isArray(raw)) return raw.map(normaliseText);
  if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, normaliseText(v)]));
  return raw;
}

/** Whether a text has a character R3 refuses (for text shown outside a template, such as the
 *  online gallery's list). */
export const hasHiddenCharacter = (text: string): boolean => HIDDEN.test(text);

const codePoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** The first hidden character in the template, said plainly, or undefined. */
export function hiddenCharacter(t: OfficeTemplate): string | undefined {
  for (const { where, text } of templateTexts(t)) {
    const m = HIDDEN.exec(text);
    if (!m) continue;
    const line = text.slice(0, m.index).split('\n').length;
    return `${where}, line ${line}, has a character you can't see (${codePoint(m[0])}). Characters like this can hide text from you while the AI still reads it, so a template can't contain them.`;
  }
  return undefined;
}

// ---------- R2: every address ----------

export interface FoundAddress {
  /** As written: "https://x.example/a", "x.example", "someone@x.example". */
  text: string;
  kind: 'link' | 'host' | 'email';
  /** The host in punycode ("xn--…") when it has non-ASCII letters, so a look-alike shows. */
  punycode?: string;
  where: string[];
}

// Each pattern starts only where its run of characters starts (the lookbehinds), so a long run
// is scanned once, not once per position in it: the time grows with the text, not its square
// (review 7C-1 S1). The domain part is split on dots, which bounds its backtracking the same way.
const LINK = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`)\]}]+/giu;
const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}/gu;
/** A bare host name, perhaps with a path: letters in the last label, at least one dot. */
const HOST = /(?<![\p{L}\p{N}@/._-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,}(?![\p{L}\p{N}-])(?::\d{1,5})?(?:\/[^\s<>"'`)\]}]*)?/gu;
/** File names look like hosts ("plan.md"): these endings are files, not places on the internet. */
const FILE_ENDINGS = new Set(['md', 'txt', 'csv', 'json', 'html', 'htm', 'yaml', 'yml', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'zip', 'js', 'ts', 'py', 'ics', 'eml', 'log', 'xml', 'rtf', 'odt', 'ods', 'key', 'pages', 'numbers']);

function punycodeOf(host: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(host)) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

const hostOf = (s: string, kind: FoundAddress['kind']): string =>
  kind === 'email' ? s.slice(s.lastIndexOf('@') + 1) : kind === 'link' ? (s.split('://')[1] ?? '').split(/[/?#:]/)[0].split('@').pop()! : s.split(/[/:]/)[0];

/** Every link, bare host name and email address in the template, with where each appears. */
export function templateAddresses(t: OfficeTemplate): FoundAddress[] {
  const found = new Map<string, FoundAddress>();
  const add = (text: string, kind: FoundAddress['kind'], where: string) => {
    const clean = text.replace(/[.,;:!?]+$/, '');
    const key = `${kind}:${clean.toLowerCase()}`;
    const had = found.get(key);
    if (had) {
      if (!had.where.includes(where)) had.where.push(where);
      return;
    }
    const puny = punycodeOf(hostOf(clean, kind));
    found.set(key, { text: clean, kind, ...(puny ? { punycode: puny } : {}), where: [where] });
  };
  for (const { where, text } of templateTexts(t)) {
    // Links and emails first, then blank them out, so their hosts aren't listed twice.
    let rest = text.replace(LINK, (m) => (add(m, 'link', where), ' '.repeat(m.length)));
    rest = rest.replace(EMAIL, (m) => (add(m, 'email', where), ' '.repeat(m.length)));
    for (const m of rest.matchAll(HOST)) {
      const host = m[0].split(/[/:]/)[0];
      const ending = host.slice(host.lastIndexOf('.') + 1).toLowerCase();
      if (FILE_ENDINGS.has(ending) && m[0] === host) continue; // "plan.md": a file, unless a path follows
      add(m[0], 'host', where);
    }
  }
  return [...found.values()];
}

// ---------- R4: lines worth a careful read ----------

export interface TemplateWarning {
  where: string;
  /** Why it is flagged, in plain words. */
  why: string;
  /** The line, quoted (at most 160 characters). */
  line: string;
}

const PHRASES: [RegExp, string][] = [
  [/\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|other|system)\b[^.\n]{0,20}\b(?:instructions?|rules?|prompts?)\b/i, 'asks the AI to ignore other instructions'],
  [/\b(?:do not|don't|never)\s+(?:tell|inform|show|mention\b[^.\n]{0,40}\bto)\s+(?:the\s+)?(?:boss|user|owner|human)\b/i, 'asks the AI to keep something from you'],
  [/\bwithout\s+(?:telling|asking|informing)\s+(?:the\s+)?(?:boss|user|owner|human)\b/i, 'asks the AI to act without asking you'],
  // Asking for a key or password to be passed on, not merely mentioning one ("never ask for passwords").
  [/\b(?:send|share|include|reveal|copy|paste|post|e-?mail|forward|upload|write down|list)\b[^.\n]{0,40}\b(?:api[ _-]?keys?|passwords?|passcodes?|access[ _-]?tokens?|secret[ _-]?keys?|credentials?)\b/i, 'asks for a key or password to be passed on'],
  [/[A-Za-z0-9+/_-]{80,}={0,2}/, 'has a long run of encoded-looking text'],
];

const quote = (line: string) => (line.length > 160 ? `${line.slice(0, 157)}…` : line).trim();

/** Warnings for the top of the preview: never a block, a prompt to read those lines carefully. */
export function templateWarnings(t: OfficeTemplate): TemplateWarning[] {
  const out: TemplateWarning[] = [];
  for (const { where, text } of templateTexts(t)) {
    const lines = text.split('\n');
    for (const [re, why] of PHRASES) {
      const line = lines.find((l) => re.test(l));
      if (line !== undefined) out.push({ where, why, line: quote(line) });
    }
    const blanks = /\n(?:[ \t]*\n){4,}/.exec(text);
    if (blanks) out.push({ where, why: `has ${blanks[0].split('\n').length - 2} blank lines in a row, which can push text out of sight`, line: quote(text.slice(0, blanks.index).split('\n').pop() ?? '') });
    const spaces = / {21,}/.exec(text);
    if (spaces) out.push({ where, why: `has ${spaces[0].length} spaces in a row, which can push text out of sight`, line: quote(text.slice(0, spaces.index).split('\n').pop() ?? '') });
  }
  return out;
}

// ---------- the preview ----------

/**
 * For showing a template's text: more than 3 blank lines, or more than 20 spaces, become a
 * visible marker, so nothing sits out of sight. Display only: the text itself is unchanged.
 */
export function foldRuns(text: string): string {
  return text
    .replace(/\n(?:[ \t]*\n){4,}/g, (m) => `\n[${m.split('\n').length - 2} blank lines]\n`)
    .replace(/ {21,}/g, (m) => ` [${m.length} spaces] `);
}

/** What the preview needs from these rules, sent with every template preview. */
export interface TemplateReport {
  addresses: FoundAddress[];
  warnings: TemplateWarning[];
}

export function templateReport(t: OfficeTemplate): TemplateReport {
  return { addresses: templateAddresses(t), warnings: templateWarnings(t) };
}
