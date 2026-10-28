/**
 * Local calendar helpers.
 *
 * `new Date().toISOString()` gives the UTC date. Kampala runs at UTC+3, so
 * between local midnight and 03:00 it returns *yesterday*, and on the first of
 * the month, last month. A clinic that opens early, or an officer finishing a
 * late entry, would have the wrong date defaulted into a clinical form or the
 * wrong reporting month opened in the returns screen, and neither is obvious
 * enough to catch by eye.
 *
 * Everything that needs "today" or "this month" comes from here. There should
 * be no `toISOString()` in a page.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** Today in the browser's own timezone, as YYYY-MM-DD. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The current reporting month in the browser's own timezone, as YYYY-MM. */
export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** The current local time as HH:MM, for a form that records one. */
export function timeNow(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** The reporting month a date falls in. */
export const periodOf = (date: string): string => date.slice(0, 7);

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A reporting month as "Mar", for a chart axis. */
export function shortMonth(period: string): string {
  return monthNames[Number(period.slice(5, 7)) - 1]?.slice(0, 3) ?? period;
}

/** A reporting month as "March 2026". */
export function longMonth(period: string): string {
  const name = monthNames[Number(period.slice(5, 7)) - 1];
  return name ? `${name} ${period.slice(0, 4)}` : period;
}

/** The `count` most recent reporting months, this one first. */
export function recentPeriods(count = 24): string[] {
  const periods: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
  }
  return periods;
}
