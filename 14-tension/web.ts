import type { Look } from "./versions";

// An orb web, spun the way a garden spider spins one: a few frame threads strung between twigs, spokes from the hub out
// to the frame, a tight mesh at the hub, then the sticky spiral wound out from the free zone to the edge, wider spaced
// below the hub than above. Every crossing is a point the silk can move at, and every length of silk between two is a
// thread that pulls when stretched and goes slack when not, solved a few times a frame (position-based dynamics).

export const enum Kind {
  Frame,
  Spoke,
  Spiral,
  Hub
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where the frame is tied to the twigs, by angle round the hub (degrees) and distance from it. The garden is drawn to pass
// through these, so the web always hangs from something.
export const ANCHORS: [number, number, number][] = [
  [104, 1.42, 0.02],
  [36, 1.5, -0.04],
  [-38, 1.38, 0.05],
  [-104, 1.3, -0.02],
  [-166, 1.46, 0.03],
  [158, 1.4, -0.05]
];
export const anchorPoint = (i: number): [number, number, number] => {
  const [deg, r, z] = ANCHORS[i];
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r, z];
};

// One stretch of silk laid without a break when the web is spun before the eye: the points it runs through in the order
// she passes them, the threads between, the points let go to swing once it is made fast, and how briskly she lays it.
// She never walks on air, so how a line gets across depends on what is there already. With nothing to walk on it is let
// out on the breeze to catch on the next twig ("float"), or she lets herself down on it as she spins it ("drop"). With
// silk to walk on she makes it fast at one end and carries it round by the threads already up to the other ("carry"),
// or, where every point of it is on a thread already, lays it as she walks it ("lay"). The first line across the
// middle is a "sling": carried along the top of the frame and left hanging loose between two points of it, then walked
// out on to its middle, where her weight and the silk she pays out draw it down into a V whose point is the hub.
export type Run = {
  mode: "float" | "drop" | "carry" | "lay" | "sling";
  nodes: number[];
  segs: number[];
  free: number[];
  pace: number;
  kind: Kind;
};

export class Web {
  count = 0;
  position: Float32Array;
  previous: Float32Array;
  inverseMass: Float32Array;
  // Mass the dew adds to each point; the silk itself is next to nothing.
  load: Float32Array;
  pinned: Uint8Array;
  segments: {
    a: number;
    b: number;
    rest: number;
    kind: Kind;
    alive: boolean;
    // Laid yet: a thread not yet spun is not there, where one that has snapped was and is gone.
    spun: boolean;
  }[] = [];
  // For each point, the threads that meet there, for the spider to find its way.
  around: number[][] = [];
  hub = 0;
  radius = 1;
  // Spiral threads, for dew to sit on.
  spiral: number[] = [];
  grabbed = -1;
  target = new Float32Array(3);
  // Set by the scene: the wind's push this frame, along z mostly.
  wind = 0;
  time = 0;
  snapped: { x: number; y: number; z: number; kind: Kind }[] = [];
  // How hard the web has been shaken since last asked, for the drops and the spider.
  shaken: Float32Array;
  calm: Float32Array;
  // While she spins it from nothing: the points silk has reached, which a foot can take hold of, and those let go to
  // swing. A line she is still drawing out is held still until its far end is made fast. A finished web has all of both.
  hung: Uint8Array;
  free: Uint8Array;
  // The order she spins it in, how far she has got, and the thread she is drawing out now: from a point to where she is.
  runs: Run[] = [];
  building: { run: number } | null = null;
  laying = { seg: -1, from: 0, x: 0, y: 0, z: 0 };
  // The sling as it sinks: its points, where they hang while it is loose, and where they end up.
  private pose: { nodes: number[]; from: Float32Array; to: Float32Array } | null = null;
  // Before she spins it again the old web comes down, as a spider takes hers down: she goes to a point on the frame,
  // cuts the web from the frame, hauls it in to her and eats it, and spins the new one inside the frame she kept. First
  // she is asked to leave for that point; then how long she has been hauling, or less than nought when she is not; what
  // she is hauling in; whether the frame stays; and where every point hangs at rest, to be put back for the new web.
  leaving: object | null = null;
  eating = -1;
  keeps = false;
  private meal: { nodes: number[]; from: Float32Array; far: Float32Array; stays: Uint8Array } | null = null;
  private home: Float32Array | null = null;
  // Threads snapped and not yet mended, and when the last one went.
  torn: number[] = [];
  tornAt = 0;
  // All the silk in it, end to end.
  silk = 0;
  // How it was put together, kept for spinning it again: the frame from corner to corner, each spoke from the hub out,
  // the way each spoke points, and the rings of the hub.
  private chains: { frame: number[][]; spokes: number[][]; angles: number[]; rings: number[][] } = { frame: [], spokes: [], angles: [], rings: [] };

  constructor(look: Look, seed: number, fine: number) {
    const random = mulberry32(seed);
    const points: number[] = [];
    const pins: number[] = [];
    const add = (x: number, y: number, z: number, pin = false) => {
      points.push(x, y, z);
      pins.push(pin ? 1 : 0);
      return points.length / 3 - 1;
    };
    const link = (a: number, b: number, kind: Kind, slack = 1) => {
      const dx = points[b * 3] - points[a * 3];
      const dy = points[b * 3 + 1] - points[a * 3 + 1];
      const dz = points[b * 3 + 2] - points[a * 3 + 2];
      // Spun taut: each thread a little shorter than the gap it spans, so it pulls.
      const taut = kind === Kind.Spiral ? 0.992 : kind === Kind.Hub ? 0.99 : 0.982;
      this.segments.push({
        a,
        b,
        rest: Math.hypot(dx, dy, dz) * taut * slack,
        kind,
        alive: true,
        spun: true
      });
    };

    const hubY = look.hubLift * 0.5;
    const hubX = (random() - 0.5) * 0.08;
    this.hub = add(hubX, hubY, 0);

    // The frame: corners tied to the twigs, and the polygon between them.
    const corners = ANCHORS.map((_, i) => {
      const [x, y, z] = anchorPoint(i);
      return {
        x,
        y,
        z,
        angle: Math.atan2(y - hubY, x - hubX),
        node: add(x, y, z, true)
      };
    }).sort((p, q) => p.angle - q.angle);
    const reach = (angle: number) => {
      // Where a ray from the hub at this angle meets the frame.
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      for (let i = 0; i < corners.length; i++) {
        const p = corners[i];
        const q = corners[(i + 1) % corners.length];
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p.x - hubX) * ey - (p.y - hubY) * ex) / den;
        const u = ((p.x - hubX) * dy - (p.y - hubY) * dx) / den;
        if (t > 0 && u >= 0 && u <= 1) return { t, edge: i, u };
      }
      return { t: 1, edge: 0, u: 0 };
    };

    const spokes = Math.max(12, Math.round(look.spokes * fine));
    const turns = Math.max(10, Math.round(look.turns * fine));
    const angles = Array.from({ length: spokes }, (_, i) => ((i + (random() - 0.5) * 0.35) / spokes) * Math.PI * 2 - Math.PI);
    const ends = angles.map(reach);
    this.radius = ends.reduce((sum, end) => sum + end.t, 0) / spokes;

    // Along each spoke, from the hub out: the hub rings, the spiral's crossings, then the frame.
    const along: { r: number; node: number }[][] = angles.map(() => []);
    const hubRings = [0.028, 0.05, 0.072, 0.094];
    const free = 0.15;
    const outer = this.radius * 0.9;
    const spacing = (outer - free) / turns;
    const rings: number[][] = hubRings.map(() => []);
    const crossings: number[][] = [];
    angles.forEach((angle, i) => {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const at = (r: number) => add(hubX + dx * r, hubY + dy * r, (random() - 0.5) * 0.004);
      hubRings.forEach((r, k) => {
        const node = at(r);
        rings[k][i] = node;
        along[i].push({ r, node });
      });
      // Wider spaced below the hub, as the spider winds it.
      const below = Math.max(0, -dy);
      const step = spacing * (1 + (look.lopsided - 1) * below) * (1 / (1 + (look.lopsided - 1) * 0.35));
      for (let j = 0; ; j++) {
        const r = free + (j + i / spokes) * step;
        if (r > ends[i].t * 0.94) break;
        const node = at(r);
        along[i].push({ r, node });
        (crossings[j] ??= [])[i] = node;
      }
    });
    // The spokes' ends on the frame, and the frame threads between them and the corners in order round it.
    const onEdge: { u: number; node: number }[][] = corners.map(() => []);
    ends.forEach((end, i) => {
      const p = corners[end.edge];
      const q = corners[(end.edge + 1) % corners.length];
      const node = add(p.x + (q.x - p.x) * end.u, p.y + (q.y - p.y) * end.u, p.z + (q.z - p.z) * end.u);
      along[i].push({ r: end.t, node });
      onEdge[end.edge].push({ u: end.u, node });
    });
    this.count = points.length / 3;
    corners.forEach((p, i) => {
      const chain = [p.node, ...onEdge[i].sort((a, b) => a.u - b.u).map((e) => e.node), corners[(i + 1) % corners.length].node];
      for (let k = 1; k < chain.length; k++) link(chain[k - 1], chain[k], Kind.Frame);
      this.chains.frame.push(chain);
    });
    this.chains.spokes = along.map((chain) => [this.hub, ...chain.map((c) => c.node)]);
    this.chains.angles = angles;
    this.chains.rings = rings;
    along.forEach((chain) => {
      let last = this.hub;
      for (const { node } of chain) {
        link(last, node, Kind.Spoke);
        last = node;
      }
    });
    rings.forEach((ring) => ring.forEach((node, i) => link(node, ring[(i + 1) % spokes], Kind.Hub, 1.01)));
    // The sticky spiral: each crossing to the next spoke's, and round from the last spoke to the first one turn on.
    crossings.forEach((ring, j) =>
      ring.forEach((node, i) => {
        if (node === undefined) return;
        const next = i + 1 < spokes ? ring[i + 1] : crossings[j + 1]?.[0];
        if (next === undefined) return;
        if (random() < look.broken) return;
        this.spiral.push(this.segments.length);
        link(node, next, Kind.Spiral, 1 + random() * 0.01);
      })
    );

    this.position = new Float32Array(points);
    this.previous = new Float32Array(points);
    this.inverseMass = new Float32Array(this.count).fill(1);
    this.load = new Float32Array(this.count);
    this.pinned = new Uint8Array(pins);
    this.shaken = new Float32Array(this.count);
    this.calm = new Float32Array(this.count);
    this.hung = new Uint8Array(this.count).fill(1);
    this.free = new Uint8Array(this.count).fill(1);
    for (const seg of this.segments) this.silk += seg.rest;
    for (let i = 0; i < this.count; i++) if (this.pinned[i]) this.inverseMass[i] = 0;
    this.around = Array.from({ length: this.count }, () => []);
    this.segments.forEach((s, i) => {
      this.around[s.a].push(i);
      this.around[s.b].push(i);
    });
  }

  // Hung and left to settle before anyone sees it, so it starts at rest rather than dropping into its sag.
  settle() {
    for (let n = 0; n < 120; n++) this.step(1 / 60, 8);
    this.previous.set(this.position);
    this.shaken.fill(0);
    this.calm.fill(0);
    this.time = 0;
    // Where it hangs at rest in still air, for spinning it again.
    this.home = this.position.slice();
  }

  // Dew weighs the points it hangs nearest.
  weigh() {
    for (let i = 0; i < this.count; i++) this.inverseMass[i] = this.pinned[i] || !this.free[i] ? 0 : 1 / (1 + this.load[i] * 2.4e5);
  }

  // The order a spider spins an orb web in. The frame first, from twig to twig. Then a line dropped from the top of the
  // frame to where the hub will be, and two more from there to make a Y that holds it; then the rest of the spokes, out
  // along one and back in along the next. Then the hub, wound round and round, and last the sticky spiral, from the
  // outside in.
  private plan() {
    const n = this.count;
    const between = new Map<number, number>();
    this.segments.forEach((s, i) => {
      between.set(s.a * n + s.b, i);
      between.set(s.b * n + s.a, i);
    });
    const runs: Run[] = [];
    const run = (mode: Run["mode"], nodes: number[], kind: Kind, free: number[], pace = 1) => {
      const segs: number[] = [];
      for (let k = 1; k < nodes.length; k++) segs.push(between.get(nodes[k - 1] * n + nodes[k])!);
      runs.push({ mode, nodes, segs, free, pace, kind });
    };
    const { frame, spokes, angles, rings } = this.chains;

    // Round the frame from its highest corner: each side let out on the breeze to the next twig, then walked across.
    let top = 0;
    frame.forEach((chain, i) => {
      if (this.position[chain[0] * 3 + 1] > this.position[frame[top][0] * 3 + 1]) top = i;
    });
    for (let k = 0; k < frame.length; k++) {
      const chain = frame[(top + k) % frame.length];
      run("float", chain, Kind.Frame, chain);
    }

    const apart = (i: number, j: number) => Math.abs(Math.atan2(Math.sin(angles[i] - angles[j]), Math.cos(angles[i] - angles[j])));
    const nearest = (angle: number) => {
      let best = 0;
      let bestBy = Infinity;
      angles.forEach((a, i) => {
        const by = Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle)));
        if (by < bestBy) {
          bestBy = by;
          best = i;
        }
      });
      return best;
    };
    // The Y, as a spider makes it: a loose line slung between two points on the top of the frame, drawn down into a V
    // from its middle, and from the point of the V a line let down to the bottom of the frame. The point is the hub
    // and the three arms the first spokes. Then the others, each carried out along the spoke beside it. All are held
    // still, as she holds them taut, until the last is fast: a hub with spokes to one side only is pulled over, and
    // the spokes it is pulled toward hang slack.
    const left = nearest(Math.PI / 2 + 0.7);
    const right = nearest(Math.PI / 2 - 0.7);
    const down = nearest(-Math.PI / 2);
    const first = [left, right, down];
    run("sling", [...spokes[left]].reverse().concat(spokes[right].slice(1)), Kind.Spoke, []);
    run("drop", spokes[down], Kind.Spoke, []);
    const rest: number[] = [];
    for (let k = 1; k < spokes.length; k++) {
      const i = (left + k) % spokes.length;
      if (!first.includes(i)) rest.push(i);
    }
    // Two at a time, out and back, to one side and then the other.
    const order: number[] = [];
    for (let side = 0; rest.length; side ^= 1) order.push(...(side ? rest.splice(-2).reverse() : rest.splice(0, 2)));
    let atHub = false;
    let last = down;
    order.forEach((i, k) => {
      // Made fast at the frame first when she is out there and the next spoke's end is a short walk along it, and
      // carried in to the hub; otherwise made fast at the hub and carried out.
      const inward = !atHub && apart(i, last) < 1;
      const nodes = inward ? [...spokes[i]].reverse() : spokes[i];
      run("carry", nodes, Kind.Spoke, k < order.length - 1 ? [] : spokes.flat());
      atHub = inward;
      last = i;
    });

    // The hub, from the middle out. It is small beside her: she turns about on it more than walks.
    rings.forEach((ring, k) => run("lay", [...ring, ring[0]], Kind.Hub, [], 0.12 + k * 0.1));

    // The sticky spiral, from the outside in: the threads in the order they were reckoned, backwards, in as many
    // stretches as it takes, since it stops wherever the frame comes in close and wherever she left a gap.
    let nodes: number[] = [];
    const flush = () => {
      if (nodes.length > 1) run("lay", nodes, Kind.Spiral, []);
      nodes = [];
    };
    for (let k = this.spiral.length - 1; k >= 0; k--) {
      const seg = this.segments[this.spiral[k]];
      if (nodes.length && nodes[nodes.length - 1] !== seg.b) flush();
      if (!nodes.length) nodes.push(seg.b);
      nodes.push(seg.a);
    }
    flush();
    this.runs = runs;
  }

  // Asked to come down, to be spun again: nothing happens to it until she has left it for the twig she starts from.
  clear() {
    if (this.leaving || this.eating >= 0) return;
    if (!this.runs.length) this.plan();
    // The frame stays up if every thread of it is whole.
    this.keeps = this.segments.every((seg) => seg.kind !== Kind.Frame || seg.alive);
    // A web half spun comes down like any other: what she was holding still is let go.
    this.sink(1);
    this.pose = null;
    this.building = null;
    this.laying.seg = -1;
    this.free.fill(1);
    this.weigh();
    this.leaving = {};
  }

  // The first line of the new web: the first of all, or with the frame kept, the first after it.
  get first() {
    return this.keeps ? Math.max(0, this.runs.findIndex((run) => run.kind !== Kind.Frame)) : 0;
  }

  // Where she stands to take it down, and starts the new one from.
  get perch() {
    return this.runs[this.first].nodes[0];
  }

  // She is at her perch: the old web is cut from what stays up and hauled in to her. What stays is the frame, if it
  // is whole; if not, only the twigs.
  eat() {
    this.leaving = null;
    this.grabbed = -1;
    this.torn.length = 0;
    const stays = new Uint8Array(this.pinned);
    if (this.keeps) for (const chain of this.chains.frame) for (const n of chain) stays[n] = 1;
    const nodes: number[] = [];
    for (let i = 0; i < this.count; i++) if (!stays[i]) nodes.push(i);
    const p = this.position;
    const to = this.perch * 3;
    const from = new Float32Array(nodes.length * 3);
    const far = new Float32Array(nodes.length);
    nodes.forEach((n, k) => {
      for (let c = 0; c < 3; c++) from[k * 3 + c] = p[n * 3 + c];
      far[k] = Math.max(1e-4, Math.hypot(p[n * 3] - p[to], p[n * 3 + 1] - p[to + 1], p[n * 3 + 2] - p[to + 2]));
      this.free[n] = 0;
      this.hung[n] = 0;
    });
    // Cut where it joins what stays, a few of the cuts loud enough to hear.
    let cuts = 0;
    for (const seg of this.segments) {
      if (!seg.alive || stays[seg.a] === stays[seg.b]) continue;
      seg.alive = false;
      const at = (stays[seg.a] ? seg.a : seg.b) * 3;
      if (cuts++ % 6 === 0) this.snapped.push({ x: p[at], y: p[at + 1], z: p[at + 2], kind: seg.kind });
    }
    this.meal = { nodes, from, far, stays };
    this.eating = 0;
    this.weigh();
  }

  // Hauled in: every point of it drawn straight to her at one speed, so the near parts reach her first and the far
  // edge last, and a thread is gone once both its ends are in. Then the points are put back where they hang, bare.
  private haul(dt: number) {
    const meal = this.meal;
    if (!meal) return;
    this.eating += dt;
    const reach = this.eating * 0.8;
    const p = this.position;
    const to = this.perch * 3;
    const inAt = new Uint8Array(this.count);
    let furthest = 0;
    meal.nodes.forEach((n, k) => {
      const f = Math.min(1, reach / meal.far[k]);
      const ease = f * f * (3 - 2 * f);
      for (let c = 0; c < 3; c++) p[n * 3 + c] = this.previous[n * 3 + c] = meal.from[k * 3 + c] + (p[to + c] - meal.from[k * 3 + c]) * ease;
      if (f >= 1) inAt[n] = 1;
      furthest = Math.max(furthest, meal.far[k]);
    });
    for (const seg of this.segments) if (seg.alive && inAt[seg.a] && inAt[seg.b]) seg.alive = false;
    if (reach > furthest + 0.5) {
      const home = this.home ?? p;
      for (const n of meal.nodes) for (let c = 0; c < 3; c++) p[n * 3 + c] = this.previous[n * 3 + c] = home[n * 3 + c];
      this.meal = null;
      this.eating = -1;
      this.unspin(this.keeps);
    }
  }

  // Taken down to the bare twigs, for her to spin again from nothing. Every point stays where it hung, and is still
  // until silk reaches it.
  unspin(keep = false) {
    if (!this.runs.length) this.plan();
    this.keeps = keep;
    for (const seg of this.segments) if (!(keep && seg.kind === Kind.Frame)) seg.alive = seg.spun = false;
    this.hung.set(this.pinned);
    this.free.fill(0);
    if (keep) for (const chain of this.chains.frame) for (const n of chain) this.hung[n] = this.free[n] = 1;
    this.torn.length = 0;
    this.building = { run: this.first };
    this.laying.seg = -1;
    this.grabbed = -1;
    this.snapped.length = 0;
    this.weigh();
  }

  // A line just slung between two points hangs loose between them, a shallow curve below the straight way across.
  slacken(nodes: number[]) {
    const p = this.position;
    const to = new Float32Array(nodes.length * 3);
    const from = new Float32Array(nodes.length * 3);
    nodes.forEach((n, k) => {
      for (let c = 0; c < 3; c++) to[k * 3 + c] = p[n * 3 + c];
    });
    // How far along it each point is, by length.
    const along = [0];
    for (let k = 1; k < nodes.length; k++) along.push(along[k - 1] + Math.hypot(to[k * 3] - to[k * 3 - 3], to[k * 3 + 1] - to[k * 3 - 2], to[k * 3 + 2] - to[k * 3 - 1]));
    const end = (nodes.length - 1) * 3;
    nodes.forEach((_, k) => {
      const t = along[k] / along[nodes.length - 1];
      for (let c = 0; c < 3; c++) from[k * 3 + c] = to[c] + (to[end + c] - to[c]) * t;
      from[k * 3 + 1] -= 0.14 * 4 * t * (1 - t);
    });
    this.pose = { nodes, from, to };
    this.sink(0);
  }

  // The sling drawn down, from loose (0) to the V (1). Its two ends are on the frame and stay the frame's.
  sink(by: number) {
    const pose = this.pose;
    if (!pose) return;
    for (let k = 1; k < pose.nodes.length - 1; k++) {
      const n = pose.nodes[k] * 3;
      for (let c = 0; c < 3; c++) this.position[n + c] = this.previous[n + c] = pose.from[k * 3 + c] + (pose.to[k * 3 + c] - pose.from[k * 3 + c]) * by;
    }
    if (by >= 1) this.pose = null;
  }

  // A thread laid.
  spin(seg: number) {
    this.segments[seg].alive = this.segments[seg].spun = true;
  }

  // A line made fast: its points are let go, from rest.
  hang(nodes: number[]) {
    for (const i of nodes) {
      this.free[i] = 1;
      for (let k = 0; k < 3; k++) this.previous[i * 3 + k] = this.position[i * 3 + k];
    }
    this.weigh();
  }

  // The last thread is in.
  finish() {
    for (const seg of this.segments) if (!seg.spun) seg.alive = seg.spun = true;
    this.hung.fill(1);
    this.free.fill(1);
    this.building = null;
    this.laying.seg = -1;
    this.weigh();
  }

  step(delta: number, iterations: number) {
    // A frame with no time in it moves nothing, and would make every speed nought over nought.
    if (!(delta > 0)) return;
    const substeps = 2;
    const dt = Math.min(delta, 1 / 30) / substeps;
    const p = this.position;
    const q = this.previous;
    for (let s = 0; s < substeps; s++) {
      this.time += dt;
      const t = this.time;
      for (let i = 0; i < this.count; i++) {
        if (this.inverseMass[i] === 0 || i === this.grabbed) continue;
        const a = i * 3;
        const x = p[a];
        const y = p[a + 1];
        const z = p[a + 2];
        // Silk rings for a long while: very little damping, more on heavier points.
        const keep = 0.993 - this.load[i] * 900;
        const vx = (x - q[a]) * keep;
        const vy = (y - q[a + 1]) * keep;
        const vz = (z - q[a + 2]) * keep;
        q[a] = x;
        q[a + 1] = y;
        q[a + 2] = z;
        // The breeze through the web: a slow swell over the whole of it, ripples crossing it, and gusts.
        const push = this.wind * (0.6 + 0.4 * Math.sin(t * 1.7 + x * 2.3 + y * 1.1) + 0.25 * Math.sin(t * 5.3 - y * 6 + x * 3));
        p[a] = x + vx + push * 0.15 * dt * dt;
        p[a + 1] = y + vy - 0.5 * dt * dt;
        p[a + 2] = z + vz + push * dt * dt;
      }
      if (this.grabbed >= 0) {
        const g = this.grabbed * 3;
        for (let k = 0; k < 3; k++) {
          q[g + k] = p[g + k];
          p[g + k] += (this.target[k] - p[g + k]) * 0.5;
        }
      }
      for (let n = 0; n < iterations; n++) {
        for (const seg of this.segments) {
          if (!seg.alive) continue;
          const wa = seg.a === this.grabbed ? 0 : this.inverseMass[seg.a];
          const wb = seg.b === this.grabbed ? 0 : this.inverseMass[seg.b];
          const sum = wa + wb;
          if (sum === 0) continue;
          const a = seg.a * 3;
          const b = seg.b * 3;
          const dx = p[b] - p[a];
          const dy = p[b + 1] - p[a + 1];
          const dz = p[b + 2] - p[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // Silk only pulls: slack it hangs loose.
          if (d <= seg.rest || d === 0) continue;
          const k = ((d - seg.rest) / (d * sum)) * (seg.kind === Kind.Spiral ? 0.8 : 1);
          p[a] += dx * k * wa;
          p[a + 1] += dy * k * wa;
          p[a + 2] += dz * k * wa;
          p[b] -= dx * k * wb;
          p[b + 1] -= dy * k * wb;
          p[b + 2] -= dz * k * wb;
        }
      }
    }
    if (this.eating >= 0) this.haul(Math.min(delta, 1 / 30));
    // How sharply each point has been jolted, for what hangs on it: its speed over and above its own recent average,
    // so a web swaying in a steady breeze keeps its dew and only a pluck or a gust throws it off.
    for (let i = 0; i < this.count; i++) {
      const a = i * 3;
      const speed = Math.hypot(p[a] - q[a], p[a + 1] - q[a + 1], p[a + 2] - q[a + 2]) / dt;
      this.calm[i] += (speed - this.calm[i]) * 0.04;
      this.shaken[i] = Math.max(this.shaken[i] * 0.9, speed - this.calm[i] * 1.5);
    }
    if (this.grabbed >= 0) {
      for (const seg of this.segments) {
        if (!seg.alive) continue;
        const a = seg.a * 3;
        const b = seg.b * 3;
        const d = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
        if (d > seg.rest * (seg.kind === Kind.Spiral ? 1.9 : seg.kind === Kind.Hub ? 1.7 : 1.45)) {
          seg.alive = false;
          this.torn.push(this.segments.indexOf(seg));
          this.tornAt = this.time;
          this.snapped.push({
            x: (p[a] + p[b]) / 2,
            y: (p[a + 1] + p[b + 1]) / 2,
            z: (p[a + 2] + p[b + 2]) / 2,
            kind: seg.kind
          });
        }
      }
    }
  }

  // The point nearest a ray, if the ray passes close enough to any.
  // The thread a ray passes closest to, if it passes within `within` (an angle, so the same on screen however far the
  // web), and the point of that thread nearest where it was touched. Only a press right on the silk takes hold: one in
  // the gaps between threads is left to turn the view.
  pick(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, within: number) {
    if (this.eating >= 0) return null;
    const p = this.position;
    let best = -1;
    let bestScore = within;
    let bestT = 0;
    for (const seg of this.segments) {
      if (!seg.alive) continue;
      const a = seg.a * 3;
      const b = seg.b * 3;
      // Closest approach between the ray and the thread, as two lines, the thread's end clamped.
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const wx = p[a] - ox;
      const wy = p[a + 1] - oy;
      const wz = p[a + 2] - oz;
      const uu = ux * ux + uy * uy + uz * uz;
      const ud = ux * dx + uy * dy + uz * dz;
      const uw = ux * wx + uy * wy + uz * wz;
      const dw = dx * wx + dy * wy + dz * wz;
      const den = uu - ud * ud;
      const k = den > 1e-12 ? Math.max(0, Math.min(1, (ud * dw - uw) / den)) : 0;
      const qx = p[a] + ux * k - ox;
      const qy = p[a + 1] + uy * k - oy;
      const qz = p[a + 2] + uz * k - oz;
      const t = qx * dx + qy * dy + qz * dz;
      if (t <= 0) continue;
      const miss = Math.hypot(qx - dx * t, qy - dy * t, qz - dz * t) / t;
      if (miss < bestScore) {
        const end = k < 0.5 ? seg.a : seg.b;
        const other = k < 0.5 ? seg.b : seg.a;
        // The nearer end, unless it is tied to a twig or held still while she spins.
        best = this.inverseMass[end] === 0 ? (this.inverseMass[other] === 0 ? -1 : other) : end;
        if (best < 0) continue;
        bestScore = miss;
        bestT = t;
      }
    }
    return best < 0 ? null : { node: best, distance: bestT };
  }

  // The way along the silk from one point to another, for the spider.
  path(from: number, to: number) {
    const came = new Int32Array(this.count).fill(-1);
    came[from] = from;
    const queue = [from];
    for (let h = 0; h < queue.length; h++) {
      const n = queue[h];
      if (n === to) break;
      for (const s of this.around[n]) {
        const seg = this.segments[s];
        if (!seg.alive) continue;
        const m = seg.a === n ? seg.b : seg.a;
        if (came[m] >= 0 || this.pinned[m]) continue;
        came[m] = n;
        queue.push(m);
      }
    }
    if (came[to] < 0) return [];
    const route = [to];
    while (route[route.length - 1] !== from) route.push(came[route[route.length - 1]]);
    return route.reverse();
  }

  // How far it is along the silk from one point to every other, for choosing which torn thread to mend next.
  reach(from: number) {
    const far = new Float32Array(this.count).fill(Infinity);
    const done = new Uint8Array(this.count);
    far[from] = 0;
    const open = [from];
    while (open.length) {
      let k = 0;
      for (let i = 1; i < open.length; i++) if (far[open[i]] < far[open[k]]) k = i;
      const n = open[k];
      open[k] = open[open.length - 1];
      open.pop();
      if (done[n]) continue;
      done[n] = 1;
      for (const s of this.around[n]) {
        const seg = this.segments[s];
        if (!seg.alive) continue;
        const m = seg.a === n ? seg.b : seg.a;
        if (far[n] + seg.rest < far[m]) {
          far[m] = far[n] + seg.rest;
          open.push(m);
        }
      }
    }
    return far;
  }

  // The shortest way along the silk from one point to another by length, twigs and all, for when she is spinning and
  // must get from the end of one line to the start of the next.
  way(from: number, to: number) {
    const far = new Float32Array(this.count).fill(Infinity);
    const came = new Int32Array(this.count).fill(-1);
    const done = new Uint8Array(this.count);
    far[from] = 0;
    const open = [from];
    while (open.length) {
      let k = 0;
      for (let i = 1; i < open.length; i++) if (far[open[i]] < far[open[k]]) k = i;
      const n = open[k];
      open[k] = open[open.length - 1];
      open.pop();
      if (done[n]) continue;
      done[n] = 1;
      if (n === to) break;
      for (const s of this.around[n]) {
        const seg = this.segments[s];
        if (!seg.alive) continue;
        const m = seg.a === n ? seg.b : seg.a;
        const d = far[n] + seg.rest;
        if (d < far[m]) {
          far[m] = d;
          came[m] = n;
          open.push(m);
        }
      }
    }
    if (from === to || came[to] < 0) return [];
    const route = [to];
    while (route[route.length - 1] !== from) route.push(came[route[route.length - 1]]);
    return route.reverse();
  }
}
