// What a template asks for (@4, §6.3): each connector kind named by its account slots and its
// proposals, once, required if any proposal says so. Pure, so the setup screen uses it too.

export interface Asks {
  accountSlots?: { connector: string }[];
  connectors?: { id: string; required?: boolean }[];
}

/** The connector kinds a template asks for, in the order it names them. */
export function asksFor(t: Asks): { id: string; required: boolean }[] {
  const out: { id: string; required: boolean }[] = [];
  for (const [id, required] of [...(t.accountSlots ?? []).map((a) => [a.connector, false] as const), ...(t.connectors ?? []).map((c) => [c.id, c.required === true] as const)]) {
    const had = out.find((x) => x.id === id);
    if (had) had.required ||= required;
    else out.push({ id, required });
  }
  return out;
}
