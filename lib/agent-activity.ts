type Entity = { name: string; owner?: string; type: string; consumption: number };
type Day = { date: string; details: Entity[] };
export type Activity = { status: "active" | "attention" | "inactive" | "observing"; days: number; last: string | null; asOf: string };
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400000;
// Match the dashboard's identity until a canonical agent ID is available.
// Equal display names under different owners must not share activity.
export const activityKey = (entity: { name: string; owner?: string; type: string }) => JSON.stringify([entity.owner??"",entity.type,entity.name.trim()]);

export function agentActivity(reports: Day[], asOf: string): Map<string, Activity> {
  const end = dayNumber(asOf);
  const dates = new Set<string>();
  const entities = new Map<string, Set<string>>();
  for (const report of reports) {
    if (report.date > asOf) continue;
    if (dayNumber(report.date) >= end - 29) dates.add(report.date);
    for (const entity of report.details) {
      const key = activityKey(entity);
      const activeDates = entities.get(key) ?? new Set<string>();
      // Use actual positive consumption, not funding, card issuance or import time.
      if (Number.isFinite(entity.consumption) && entity.consumption > 0) activeDates.add(report.date);
      entities.set(key, activeDates);
    }
  }
  return new Map([...entities].map(([key, activeDates]) => {
    const history = [...activeDates].sort();
    const last = history.at(-1) ?? null;
    const days = history.filter(date => dayNumber(date) >= end - 29).length;
    const recent = last !== null && dayNumber(last) >= end - 13;
    const status = days >= 3 && recent ? "active" : dates.size < 30 ? "observing" : days === 0 ? "inactive" : "attention";
    return [key, { status, days, last, asOf }];
  }));
}
