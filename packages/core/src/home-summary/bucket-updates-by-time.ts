// Home sparkline — puts the update array that the “recent transactions list” has already read into buckets along the time axis (effectiveAt).
//
// The point is that there is no separate lookup. The list and the graph come from the same array, so the same
// offset snapshot holds for free and the two cannot diverge (Home screen design rule: one snapshot).
//
// **Label honestly.** This is not “daily transaction volume” — the window is taken by offset width, so the period is
// not fixed (a few minutes on a busy node, a few weeks on an idle one). So this function returns, along with the count, the actual
// start·end times (from·to), and the screen writes it as “distribution of the latest N (from–to)”.
// Fixed-period charts (1/7/30 days) cannot be built without stored history, so they are not offered.
//
// This function neither reads the clock nor stores anything — it only splits the array it received.

export type TimeBucketSource = {
  effectiveAt: string;
};

export type UpdateTimeDistribution =
  // There is not a single update in the window — named “none” rather than 0, so the screen uses that wording as is.
  | { status: "empty" }
  // The input is not an array or effectiveAt cannot be read as a time — the same grade as a failed lookup.
  | { status: "unavailable"; reason: string }
  | {
      status: "ok";
      count: number;
      // The original ISO strings as is (the earliest·the latest). Not reformatted.
      from: string;
      to: string;
      // Length bucketCount. Each cell is the number of updates that fall into that equal-width time interval.
      buckets: number[];
    };

const DEFAULT_BUCKET_COUNT = 24;

export function bucketUpdatesByTime(
  rows: unknown,
  opts?: { bucketCount?: number },
): UpdateTimeDistribution {
  if (!Array.isArray(rows)) {
    return { status: "unavailable", reason: "rows_not_array" };
  }
  const bucketCount = opts?.bucketCount ?? DEFAULT_BUCKET_COUNT;
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    return { status: "unavailable", reason: "invalid_bucket_count" };
  }

  const times: { ms: number; raw: string }[] = [];
  for (const raw of rows) {
    const row = raw as Partial<TimeBucketSource>;
    if (typeof row?.effectiveAt !== "string") {
      return { status: "unavailable", reason: "effective_at_missing" };
    }
    const ms = new Date(row.effectiveAt).getTime();
    if (Number.isNaN(ms)) {
      // If even one cannot be read, the whole thing stops — dropping it silently would make the N in “distribution of N” a lie.
      return { status: "unavailable", reason: "effective_at_not_parseable" };
    }
    times.push({ ms, raw: row.effectiveAt });
  }

  if (times.length === 0) {
    return { status: "empty" };
  }

  let earliest = times[0] as { ms: number; raw: string };
  let latest = earliest;
  for (const t of times) {
    if (t.ms < earliest.ms) earliest = t;
    if (t.ms > latest.ms) latest = t;
  }
  const span = latest.ms - earliest.ms;

  const buckets: number[] = new Array<number>(bucketCount).fill(0);
  for (const t of times) {
    // If all are the same instant (span 0), pile them into the last cell — “closer to now” is on the right.
    const index =
      span === 0
        ? bucketCount - 1
        : Math.min(bucketCount - 1, Math.floor(((t.ms - earliest.ms) / span) * bucketCount));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }

  return { status: "ok", count: times.length, from: earliest.raw, to: latest.raw, buckets };
}
