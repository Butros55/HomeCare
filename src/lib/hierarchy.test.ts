import { describe, expect, it } from 'vitest';

import {
  buildChildrenMap,
  collectSubtree,
  directReports,
  managerChain,
  wouldCreateCycle,
  type HierarchyNode,
} from './hierarchy';

/**
 * Testbaum:
 *   owner
 *   ├─ managerA
 *   │  ├─ emp1
 *   │  │  └─ emp1a
 *   │  └─ emp2
 *   └─ managerB
 *      └─ emp3
 *   solo (ohne Manager)
 */
const nodes: HierarchyNode[] = [
  { id: 'owner', managerEmployeeId: null },
  { id: 'managerA', managerEmployeeId: 'owner' },
  { id: 'managerB', managerEmployeeId: 'owner' },
  { id: 'emp1', managerEmployeeId: 'managerA' },
  { id: 'emp1a', managerEmployeeId: 'emp1' },
  { id: 'emp2', managerEmployeeId: 'managerA' },
  { id: 'emp3', managerEmployeeId: 'managerB' },
  { id: 'solo', managerEmployeeId: null },
];

describe('buildChildrenMap / directReports', () => {
  it('liefert direkte Mitarbeiter', () => {
    expect(directReports(nodes, 'managerA').sort()).toEqual(['emp1', 'emp2']);
    expect(directReports(nodes, 'emp1')).toEqual(['emp1a']);
    expect(directReports(nodes, 'emp3')).toEqual([]);
  });

  it('gruppiert Wurzeln unter null', () => {
    expect(buildChildrenMap(nodes).get(null)?.sort()).toEqual(['owner', 'solo']);
  });
});

describe('collectSubtree', () => {
  it('liefert alle transitiven Untergebenen ohne die Wurzel', () => {
    expect(collectSubtree(nodes, 'managerA').sort()).toEqual(['emp1', 'emp1a', 'emp2']);
    expect(collectSubtree(nodes, 'owner').sort()).toEqual([
      'emp1',
      'emp1a',
      'emp2',
      'emp3',
      'managerA',
      'managerB',
    ]);
    expect(collectSubtree(nodes, 'solo')).toEqual([]);
  });

  it('bricht bei defekten Zyklen nicht ab', () => {
    const cyclic: HierarchyNode[] = [
      { id: 'a', managerEmployeeId: 'b' },
      { id: 'b', managerEmployeeId: 'a' },
    ];
    expect(collectSubtree(cyclic, 'a')).toEqual(['b']);
  });
});

describe('wouldCreateCycle', () => {
  it('erkennt Selbstreferenz', () => {
    expect(wouldCreateCycle(nodes, 'emp1', 'emp1')).toBe(true);
  });

  it('erkennt direkten Zyklus (Untergebener wird Vorgesetzter)', () => {
    expect(wouldCreateCycle(nodes, 'managerA', 'emp1')).toBe(true);
  });

  it('erkennt transitiven Zyklus', () => {
    expect(wouldCreateCycle(nodes, 'managerA', 'emp1a')).toBe(true);
    expect(wouldCreateCycle(nodes, 'owner', 'emp3')).toBe(true);
  });

  it('erlaubt gültige Umhängungen', () => {
    expect(wouldCreateCycle(nodes, 'emp2', 'managerB')).toBe(false);
    expect(wouldCreateCycle(nodes, 'emp1a', 'owner')).toBe(false);
    expect(wouldCreateCycle(nodes, 'solo', 'managerA')).toBe(false);
    expect(wouldCreateCycle(nodes, 'emp1', null)).toBe(false);
  });

  it('meldet bestehende defekte Zyklen als Zyklus', () => {
    const cyclic: HierarchyNode[] = [
      { id: 'a', managerEmployeeId: 'b' },
      { id: 'b', managerEmployeeId: 'a' },
      { id: 'c', managerEmployeeId: null },
    ];
    expect(wouldCreateCycle(cyclic, 'c', 'a')).toBe(true);
  });
});

describe('managerChain', () => {
  it('liefert die Kette von unten nach oben', () => {
    expect(managerChain(nodes, 'emp1a')).toEqual(['emp1', 'managerA', 'owner']);
    expect(managerChain(nodes, 'owner')).toEqual([]);
  });
});
