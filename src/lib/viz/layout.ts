export type LayoutLine = { from: number; to: number; switchType: string };

export type LayoutPoint = { x: number; y: number; depth: number };

/**
 * Deterministic polar tree layout. The substation sits at the centre and the
 * feeders fan out by depth; angular span is allocated by subtree leaf count so
 * branches do not overlap. No physics simulation, so layouts are stable across
 * runs and comparable side by side.
 */
export function computeLayout(
  busCount: number,
  lines: LayoutLine[],
  slack: number,
  width: number,
  height: number,
): { points: LayoutPoint[]; maxDepth: number } {
  const adj: { to: number; tie: boolean }[][] = Array.from({ length: busCount }, () => []);
  for (const line of lines) {
    const tie = line.switchType === "tie";
    adj[line.from].push({ to: line.to, tie });
    adj[line.to].push({ to: line.from, tie });
  }

  const parent = new Int32Array(busCount).fill(-1);
  const depth = new Int32Array(busCount).fill(-1);
  const order: number[] = [];
  const children: number[][] = Array.from({ length: busCount }, () => []);
  const visited = new Uint8Array(busCount);

  const bfs = (root: number, useTies: boolean) => {
    const queue = [root];
    visited[root] = 1;
    parent[root] = root;
    depth[root] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head];
      order.push(node);
      for (const edge of adj[node]) {
        if (useTies === false && edge.tie) continue;
        if (visited[edge.to]) continue;
        visited[edge.to] = 1;
        parent[edge.to] = node;
        depth[edge.to] = depth[node] + 1;
        children[node].push(edge.to);
        queue.push(edge.to);
      }
    }
  };

  bfs(slack, false);
  for (let i = 0; i < busCount; i += 1) if (!visited[i]) bfs(i, true);
  for (let i = 0; i < busCount; i += 1) if (!visited[i]) {
    visited[i] = 1;
    parent[i] = slack;
    depth[i] = 1;
    children[slack].push(i);
  }

  const leafCount = new Int32Array(busCount).fill(0);
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const node = order[i];
    if (children[node].length === 0) leafCount[node] = 1;
    else leafCount[node] = children[node].reduce((a, c) => a + leafCount[c], 0);
    if (parent[node] !== node) leafCount[parent[node]] += 0;
  }

  const maxDepth = Math.max(1, ...Array.from(depth));
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.43;
  const points: LayoutPoint[] = Array.from({ length: busCount }, () => ({ x: cx, y: cy, depth: 0 }));

  const place = (node: number, start: number, end: number) => {
    const angle = (start + end) / 2;
    const r = (Math.max(0, depth[node]) / maxDepth) * radius;
    points[node] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), depth: depth[node] };
    const kids = children[node];
    if (kids.length === 0) return;
    const total = kids.reduce((a, c) => a + leafCount[c], 0) || kids.length;
    let cursor = start;
    const span = end - start;
    for (const kid of kids) {
      const share = (leafCount[kid] / total) * span;
      place(kid, cursor, cursor + share);
      cursor += share;
    }
  };
  place(slack, -Math.PI / 2, (3 * Math.PI) / 2);

  return { points, maxDepth };
}
