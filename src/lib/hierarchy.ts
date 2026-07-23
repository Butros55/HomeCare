/**
 * Reine Funktionen für die rekursive Mitarbeiterhierarchie
 * (selbstreferenzierendes managerEmployeeId). Unit-getestet.
 */

export interface HierarchyNode {
  id: string;
  managerEmployeeId: string | null;
}

/** Map: managerId → direkte Mitarbeiter. */
export function buildChildrenMap(nodes: HierarchyNode[]): Map<string | null, string[]> {
  const map = new Map<string | null, string[]>();
  for (const node of nodes) {
    const key = node.managerEmployeeId;
    const list = map.get(key);
    if (list) list.push(node.id);
    else map.set(key, [node.id]);
  }
  return map;
}

/** Direkte Mitarbeiter eines Managers. */
export function directReports(nodes: HierarchyNode[], managerId: string): string[] {
  return buildChildrenMap(nodes).get(managerId) ?? [];
}

/**
 * Alle untergeordneten Mitarbeiter (transitiv), ohne die Wurzel selbst.
 * Bricht bei (fehlerhaften) Zyklen sicher ab.
 */
export function collectSubtree(nodes: HierarchyNode[], rootId: string): string[] {
  const children = buildChildrenMap(nodes);
  const result: string[] = [];
  const visited = new Set<string>([rootId]);
  const queue = [...(children.get(rootId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    queue.push(...(children.get(current) ?? []));
  }
  return result;
}

/**
 * Prüft, ob das Setzen von `newManagerId` als Vorgesetzter von `employeeId`
 * einen Zyklus erzeugen würde (inkl. Selbstreferenz).
 */
export function wouldCreateCycle(
  nodes: HierarchyNode[],
  employeeId: string,
  newManagerId: string | null,
): boolean {
  if (newManagerId === null) return false;
  if (newManagerId === employeeId) return true;

  // Zyklus genau dann, wenn der neue Manager im Unterbaum des Mitarbeiters liegt.
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  let current: string | null = newManagerId;
  const seen = new Set<string>();
  while (current !== null) {
    if (current === employeeId) return true;
    if (seen.has(current)) return true; // bestehender (defekter) Zyklus
    seen.add(current);
    current = byId.get(current)?.managerEmployeeId ?? null;
  }
  return false;
}

/** Kette der Vorgesetzten von unten nach oben (ohne den Mitarbeiter selbst). */
export function managerChain(nodes: HierarchyNode[], employeeId: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const chain: string[] = [];
  const seen = new Set<string>([employeeId]);
  let current = byId.get(employeeId)?.managerEmployeeId ?? null;
  while (current !== null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = byId.get(current)?.managerEmployeeId ?? null;
  }
  return chain;
}
