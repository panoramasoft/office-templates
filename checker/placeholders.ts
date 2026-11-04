// Placeholders in template text, and the names a template's people get. Pure (no Node
// imports), so the setup and import screens fill text exactly as the server does.
//
// {{bossName}}, {{officeName}} and {{managerName}} name this office's people; {{name:<key>}}
// names the role with that key, so a brief can say "send drafts to {{name:jim}}" and still
// reach the copywriter after the boss renames them.

export const PLACEHOLDERS = ['{{bossName}}', '{{officeName}}', '{{managerName}}', '{{name:<role key>}}'] as const;

export interface PlaceholderNames {
  bossName: string;
  officeName: string;
  managerName: string;
  /** Each role's final name, by role key ("manager" is the manager). */
  roles?: Record<string, string>;
}

const ROLE_REF = /\{\{name:([a-z0-9-]+)\}\}/g;

/** The role keys a text refers to with {{name:<key>}}. */
export function roleRefs(text: string): string[] {
  return [...text.matchAll(ROLE_REF)].map((m) => m[1]);
}

/** Fill the placeholders with this office's names. A {{name:x}} with no such role stays as written. */
export function fillPlaceholders(text: string, names: PlaceholderNames): string {
  const roles: Record<string, string> = { manager: names.managerName, ...names.roles };
  // Replacer functions, never strings: a name like "Ana $& Co" must go in as written, not
  // be read as a replacement pattern ($&, $', $`).
  return text
    .replaceAll('{{bossName}}', () => names.bossName)
    .replaceAll('{{officeName}}', () => names.officeName)
    .replaceAll('{{managerName}}', () => names.managerName)
    .replace(ROLE_REF, (whole, key: string) => (Object.hasOwn(roles, key) ? roles[key] : whole));
}

/**
 * What a person left out is called in the briefs that mention them: "the Outreach
 * Copywriter (not hired)" at import, "(not in this template)" at export. It names nobody, so
 * a message meant for them can't reach someone else who has their name (or the boss).
 */
export function notHiredName(title: string, why = 'not hired'): string {
  return `the ${title.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim() || 'teammate'} (${why})`;
}

/** `name`, or the first "name N" that isn't in `taken` (compared ignoring case). */
export function freeName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (!used.has(name.trim().toLowerCase()) && name.trim().toLowerCase() !== 'boss') return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

/**
 * The name shown (and sent) for each role: the boss's edit, or a free version of the
 * template's name. `taken` holds the names already in use (the boss, the manager, and at
 * import everyone already hired); a role whose name is taken is offered "Jim 2".
 */
export function roleNamesFor(roles: { key: string; name: string }[], edits: Record<string, string>, taken: string[]): Record<string, string> {
  const used = [...taken];
  const out: Record<string, string> = {};
  for (const r of roles) {
    out[r.key] = Object.hasOwn(edits, r.key) ? edits[r.key] : freeName(r.name, used);
    used.push(out[r.key]);
  }
  return out;
}
