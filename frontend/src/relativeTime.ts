const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["week", 7 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

// English, as the sentences it's set in are.
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** How long ago `date` was, in the largest unit it's at least one of ("2 hours ago", "yesterday"), or "just now". */
export function relativeTime(date: string): string {
  // A date a little ahead of this clock (GitHub's runs on its own) is just now, not in the future.
  const ago = Math.max(0, Date.now() - Date.parse(date));
  const unit = UNITS.find(([, length]) => ago >= length);
  if (!unit) return "just now";
  const [name, length] = unit;
  return RELATIVE_TIME_FORMAT.format(-Math.round(ago / length), name);
}
