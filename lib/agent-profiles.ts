export type AgentProfile = { name:string; owner:string; type:"代理商"|"API"; email:string; cooperationStart:string };
type Identity = Pick<AgentProfile,"name"|"owner"|"type">;
const normalized = (value:string) => value.normalize("NFKC").trim().toLowerCase();

export function findAgentProfile(profiles:AgentProfile[], row:Identity):AgentProfile|undefined {
  const matches = profiles.filter(p => normalized(p.name) === normalized(row.name) && p.type === row.type);
  const exact = matches.filter(p => normalized(p.owner) === normalized(row.owner));
  // Never guess between two same-named agents. A unique name/type can survive
  // the existing public-BD grouping without losing its source contact fields.
  return exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
}

export function compareCooperationStart(left:string, right:string, direction:"asc"|"desc") {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return left.localeCompare(right) * (direction === "asc" ? 1 : -1);
}
