// Recurring work ("every weekday at 8:00"). Times are in this computer's time zone.
// Pure helpers, shared with the web UI.

export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayName = (typeof DAY_NAMES)[number];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(time: string): boolean {
  return TIME.test(time);
}

/** The first moment after `from` that matches one of `days` (0 = Sunday) at `time` ("HH:MM"). */
export function nextRun(days: number[], time: string, from: Date): Date {
  const m = TIME.exec(time);
  if (!m || days.length === 0) throw new Error('A schedule needs at least one day and a time like 08:00.');
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(from);
    d.setDate(d.getDate() + offset);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (days.includes(d.getDay()) && d > from) return d;
  }
  throw new Error('Could not compute the next run.');
}

/** "Weekdays at 8:00 AM", "Every day at 6:30 PM", "Mon, Thu at 9:00 AM". */
export function describeCadence(days: number[], time: string): string {
  const sorted = [...new Set(days)].sort();
  const [h, min] = time.split(':').map(Number);
  const clock = new Date(2000, 0, 1, h, min).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const label =
    sorted.length === 7 ? 'Every day' :
    sorted.join() === '1,2,3,4,5' ? 'Weekdays' :
    sorted.join() === '0,6' ? 'Weekends' :
    sorted.map((d) => DAY_NAMES[d][0].toUpperCase() + DAY_NAMES[d].slice(1)).join(', ');
  return `${label} at ${clock}`;
}
