type DataRow = Record<string, unknown> & { owner?: unknown; name?: unknown };
type Period = Record<string, unknown> & {
  overall?: unknown; details?: unknown; daily?: unknown;
};

const sameOwner = (value: unknown, owner: string) =>
  typeof value === "string" && value.trim().toLocaleLowerCase("en-US") === owner.trim().toLocaleLowerCase("en-US");
const records = (value: unknown): DataRow[] =>
  Array.isArray(value) ? value.filter((row): row is DataRow => row !== null && typeof row === "object" && !Array.isArray(row)) : [];

/** Return a new snapshot containing only one BD. Never mutate the published admin copy. */
export function scopedDashboard(snapshot: unknown, platform: "business" | "wallet", owner: string): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const publication = snapshot as Record<string, unknown>;
  const source = publication[platform];
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const sourceObject = source as Record<string, unknown>;
  if (!Array.isArray(sourceObject.periods)) return null;
  const periods = sourceObject.periods.map((raw): Period => {
    const period: Period = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Period : {};
    const overall = records(period.overall).filter(row => sameOwner(row.name, owner));
    const details = records(period.details).filter(row => sameOwner(row.owner, owner));
    const daily = Array.isArray(period.daily) ? period.daily.map(rawDay => {
      const day = rawDay && typeof rawDay === "object" && !Array.isArray(rawDay) ? rawDay as Record<string, unknown> : {};
      return { date: day.date, details: records(day.details).filter(row => sameOwner(row.owner, owner)) };
    }) : [];
    // Explicit allowlist: future period fields cannot silently disclose other BD data.
    return { id: period.id, label: period.label, start: period.start, end: period.end, overall, details, daily };
  });
  const profiles = records(sourceObject.profiles).filter(row => sameOwner(row.owner, owner));
  return {
    environment: publication.environment,
    updatedAt: publication.updatedAt,
    scope: { owner },
    [platform]: { periods, profiles },
  };
}
