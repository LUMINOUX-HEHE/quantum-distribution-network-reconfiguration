import { adjacency, type NetModel } from "./model";

export type LoopInfo = {
  index: number;
  chord: number; // line index of the chord (normally a tie switch)
  options: number[]; // line indices that may be opened for this loop
  label: string;
};

export type TopologyAnalysis = {
  reachable: boolean;
  components: number;
  edgesClosed: number;
  parent: Int32Array;
  parentLine: Int32Array;
  order: number[]; // BFS order from slack
  isRadial: boolean;
  cycleEdges: number[];
};

export function analyseTopology(model: NetModel, openSet: Set<number>): TopologyAnalysis {
  const n = model.buses.length;
  const adj = adjacency(model, openSet);
  const parent = new Int32Array(n).fill(-1);
  const parentLine = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const order: number[] = [];
  const queue = [model.slack];
  seen[model.slack] = 1;
  parent[model.slack] = model.slack;

  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head];
    order.push(node);
    for (const edge of adj[node]) {
      if (seen[edge.to]) continue;
      seen[edge.to] = 1;
      parent[edge.to] = node;
      parentLine[edge.to] = edge.line;
      queue.push(edge.to);
    }
  }

  let reachableCount = 0;
  for (let i = 0; i < n; i += 1) if (seen[i]) reachableCount += 1;

  let edgesClosed = 0;
  for (const line of model.lines) if (!openSet.has(line.index)) edgesClosed += 1;

  // detect cycle edges: any closed line that is not a BFS tree edge and not
  // a self-loop of the spanning forest.
  const treeEdges = new Set<number>();
  for (let i = 0; i < n; i += 1) if (parentLine[i] >= 0) treeEdges.add(parentLine[i]);
  const cycleEdges: number[] = [];
  for (const line of model.lines) {
    if (openSet.has(line.index)) continue;
    if (treeEdges.has(line.index)) continue;
    if (seen[line.from] || seen[line.to]) cycleEdges.push(line.index);
  }

  const reachable = reachableCount === n;
  const components = countComponents(model, openSet);
  const isRadial = reachable && components === 1 && edgesClosed === n - 1 && cycleEdges.length === 0;

  return {
    reachable,
    components,
    edgesClosed,
    parent,
    parentLine,
    order,
    isRadial,
    cycleEdges,
  };
}

export function countComponents(model: NetModel, openSet: Set<number>): number {
  const n = model.buses.length;
  const adj = adjacency(model, openSet);
  const seen = new Uint8Array(n);
  let components = 0;
  for (let start = 0; start < n; start += 1) {
    if (seen[start]) continue;
    components += 1;
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      for (const edge of adj[node]) {
        if (!seen[edge.to]) {
          seen[edge.to] = 1;
          queue.push(edge.to);
        }
      }
    }
  }
  return components;
}

function unionFind(size: number) {
  const parent = new Int32Array(size).map((_, i) => i);
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[rb] = ra;
    return true;
  };
  return { find, union };
}

/**
 * Fundamental loop discovery: build a spanning tree that prefers
 * non-tie branches, then every remaining branch is a chord and defines one
 * independent fundamental loop. Loop-contraction keeps only switchable
 * branches as decision variables.
 */
export function findLoops(model: NetModel): {
  loops: LoopInfo[];
  treeEdges: number[];
  requiredOpenCount: number;
  switchableCount: number;
  contractedCount: number;
} {
  const n = model.buses.length;
  const uf = unionFind(n);
  const treeEdges: number[] = [];
  const ordered = [...model.lines].sort((a, b) => {
    const rank = (l: typeof a) => (l.switchType === "tie" ? 2 : l.isSwitch ? 1 : 0);
    return rank(a) - rank(b) || a.index - b.index;
  });
  for (const line of ordered) {
    if (uf.union(line.from, line.to)) treeEdges.push(line.index);
  }

  const treeAdj: { to: number; line: number }[][] = model.buses.map(() => []);
  const treeEdgeSet = new Set(treeEdges);
  for (const line of model.lines) {
    if (!treeEdgeSet.has(line.index)) continue;
    treeAdj[line.from].push({ to: line.to, line: line.index });
    treeAdj[line.to].push({ to: line.from, line: line.index });
  }

  const pathBetween = (a: number, b: number): number[] => {
    const parent = new Int32Array(n).fill(-1);
    const parentLine = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    seen[a] = 1;
    const queue = [a];
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      if (node === b) break;
      for (const edge of treeAdj[node]) {
        if (seen[edge.to]) continue;
        seen[edge.to] = 1;
        parent[edge.to] = node;
        parentLine[edge.to] = edge.line;
        queue.push(edge.to);
      }
    }
    if (!seen[b]) return [];
    const edges: number[] = [];
    let cur = b;
    while (cur !== a && parentLine[cur] >= 0) {
      edges.push(parentLine[cur]);
      cur = parent[cur];
    }
    return edges;
  };

  const loops: LoopInfo[] = [];
  const chords = model.lines.filter((l) => !treeEdgeSet.has(l.index));
  for (const chord of chords) {
    const path = pathBetween(chord.from, chord.to);
    const options = [chord.index, ...path.filter((i) => model.lines[i].isSwitch)].filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );
    loops.push({
      index: loops.length,
      chord: chord.index,
      options,
      label: `${model.buses[chord.from].name}–${model.buses[chord.to].name}`,
    });
  }

  return {
    loops,
    treeEdges,
    requiredOpenCount: loops.length,
    switchableCount: model.lines.filter((l) => l.isSwitch).length,
    contractedCount: model.lines.filter((l) => !l.isSwitch).length,
  };
}

export type RepairResult = {
  openSet: Set<number>;
  repaired: boolean;
  actions: string[];
  radial: boolean;
};

/**
 * Classical repair: reconnect islands by closing the least-resistive open
 * switch on the cut, then break remaining cycles by opening the weakest-flow
 * switch on the cycle. Deterministic for reproducibility.
 */
export function repairConfiguration(
  model: NetModel,
  candidate: Iterable<number>,
  loops: LoopInfo[],
  approximateCurrent: (openSet: Set<number>) => Float64Array,
): RepairResult {
  const target = loops.length;
  const openSet = new Set<number>();
  const actions: string[] = [];
  const switchable = (i: number) => model.lines[i].isSwitch;

  const considered = [...candidate].filter((i) => switchable(i));
  let dropped = 0;
  for (const i of considered) {
    if (openSet.has(i)) continue;
    openSet.add(i);
    if (openSet.size > target) {
      openSet.delete(i);
      dropped += 1;
    }
  }
  if (dropped > 0) actions.push(`Dropped ${dropped} redundant opening(s) beyond radial edge budget`);
  if (openSet.size < target) {
    actions.push(`Need ${target - openSet.size} additional opening(s) to reach a spanning tree`);
  }

  // 1. Reconnect islands. An open switch that joins two different components
  //    is closed; repeated until only one component remains or impossible.
  for (let guard = 0; guard < model.lines.length * 2; guard += 1) {
    const comp = componentLabels(model, openSet);
    if (new Set(comp).size === 1) break;
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const line of model.lines) {
      if (!openSet.has(line.index)) continue;
      if (comp[line.from] === comp[line.to]) continue;
      const score = line.rPu;
      if (score < bestScore) {
        bestScore = score;
        best = line.index;
      }
    }
    if (best < 0) break;
    openSet.delete(best);
    actions.push(`Closed branch ${model.lines[best].branch} to reconnect an island`);
  }

  // 2. Break cycles by opening the lowest approximate-flow switch on a cycle.
  for (let guard = 0; guard < model.lines.length * 2; guard += 1) {
    const topo = analyseTopology(model, openSet);
    if (topo.edgesClosed <= target) break;
    const flow = approximateCurrent(openSet);
    const cycle = findCycle(model, openSet);
    if (!cycle) break;
    const candidates = cycle.filter((i) => switchable(i));
    if (candidates.length === 0) break;
    let chosen = candidates[0];
    let bestFlow = Number.POSITIVE_INFINITY;
    for (const i of candidates) {
      const f = flow[i];
      if (f < bestFlow - 1e-12) {
        bestFlow = f;
        chosen = i;
      }
    }
    openSet.add(chosen);
    actions.push(`Opened branch ${model.lines[chosen].branch} to break a loop (weakest flow)`);
  }

  // 3. Final count adjustment: pad with low-flow openings if needed.
  for (let guard = 0; guard < model.lines.length && openSet.size < target; guard += 1) {
    const topo = analyseTopology(model, openSet);
    if (topo.edgesClosed <= target) break;
    const flow = approximateCurrent(openSet);
    let chosen = -1;
    let bestFlow = Number.POSITIVE_INFINITY;
    for (const line of model.lines) {
      if (!line.isSwitch || openSet.has(line.index)) continue;
      if (flow[line.index] < bestFlow) {
        bestFlow = flow[line.index];
        chosen = line.index;
      }
    }
    if (chosen < 0) break;
    openSet.add(chosen);
    actions.push(`Opened branch ${model.lines[chosen].branch} to complete the radial edge count`);
  }

  const final = analyseTopology(model, openSet);
  return {
    openSet,
    repaired: actions.length > 0,
    actions,
    radial: final.isRadial,
  };
}

function componentLabels(model: NetModel, openSet: Set<number>): Int32Array {
  const n = model.buses.length;
  const adj = adjacency(model, openSet);
  const labels = new Int32Array(n).fill(-1);
  let label = 0;
  for (let start = 0; start < n; start += 1) {
    if (labels[start] >= 0) continue;
    const queue = [start];
    labels[start] = label;
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      for (const edge of adj[node]) {
        if (labels[edge.to] < 0) {
          labels[edge.to] = label;
          queue.push(edge.to);
        }
      }
    }
    label += 1;
  }
  return labels;
}

/** Returns the list of closed line indices forming one cycle, if any. */
export function findCycle(model: NetModel, openSet: Set<number>): number[] | null {
  const n = model.buses.length;
  const adj: { to: number; line: number }[][] = model.buses.map(() => []);
  for (const line of model.lines) {
    if (openSet.has(line.index)) continue;
    adj[line.from].push({ to: line.to, line: line.index });
    adj[line.to].push({ to: line.from, line: line.index });
  }
  const state = new Uint8Array(n);
  const parentLine = new Int32Array(n).fill(-1);
  const stack: { node: number; from: number }[] = [];
  const seenLocal = new Set<string>();
  const dfs = (node: number, fromLine: number): number[] | null => {
    state[node] = 1;
    for (const edge of adj[node]) {
      if (edge.line === fromLine) continue;
      if (state[edge.to] === 1) {
        const cycle = [edge.line];
        let cur = node;
        while (cur !== edge.to) {
          if (parentLine[cur] < 0) break;
          cycle.push(parentLine[cur]);
          cur = model.lines[parentLine[cur]].from === cur ? model.lines[parentLine[cur]].to : model.lines[parentLine[cur]].from;
        }
        return cycle;
      }
      if (state[edge.to] === 0) {
        parentLine[edge.to] = edge.line;
        stack.push({ node: edge.to, from: edge.line });
        const found = dfs(edge.to, edge.line);
        if (found) return found;
      }
    }
    state[node] = 2;
    return null;
  };
  for (let start = 0; start < n; start += 1) {
    if (state[start] === 0) {
      const found = dfs(start, -1);
      if (found) return found;
    }
  }
  void seenLocal;
  return null;
}

export function radialityCheck(model: NetModel, openSet: Set<number>) {
  const topo = analyseTopology(model, openSet);
  return { radial: topo.isRadial, topo };
}

export function switchStatesFromOpen(model: NetModel, openSet: Iterable<number>) {
  const set = new Set(openSet);
  const states: Record<string, boolean> = {};
  for (const line of model.lines) {
    if (!line.isSwitch) continue;
    states[String(line.branch)] = !set.has(line.index);
  }
  return states;
}
