import * as THREE from "three/webgpu";
import { anchorPoint } from "./web";

// Where the tree's limbs run, kept apart from how they are drawn so that the spider can know where the bark is too.

const v = (p: [number, number, number]) => new THREE.Vector3(...p);

export type Limb = {
  points: THREE.Vector3[];
  from: number;
  to: number;
  twigs: number;
  leaves: number;
};
// The tree: a trunk rising from far below and behind, heavy limbs spreading out round the edges of the view, and the
// branches the web hangs from growing out of those, each passing through the points its frame threads are tied to.
export const LIMBS: Limb[] = [
  // The trunk.
  { points: [v([-3.4, -11, -2.9]), v([-3.1, -6, -2.5]), v([-2.9, -3, -2.3]), v([-2.8, 0, -2.4]), v([-3.0, 3, -2.6]), v([-3.4, 6.5, -3.1])], from: 0.6, to: 0.3, twigs: 4, leaves: 0 },
  // A low limb sweeping out under the web to the right.
  { points: [v([-2.85, -2.6, -2.3]), v([-1.5, -2.95, -1.6]), v([0.5, -3.05, -1.0]), v([2.6, -2.65, -0.5]), v([4.6, -2.0, -0.6]), v([6.8, -1.3, -1.3])], from: 0.3, to: 0.07, twigs: 6, leaves: 4 },
  // A high limb arching over it.
  { points: [v([-2.85, 1.2, -2.4]), v([-1.6, 2.35, -1.7]), v([0.5, 2.95, -1.2]), v([2.8, 3.15, -1.0]), v([5.0, 3.65, -1.4]), v([7.2, 4.5, -2.1])], from: 0.28, to: 0.06, twigs: 6, leaves: 4 },
  // Back and away to the left, up from the high one, and down from the low one.
  { points: [v([-3.0, -0.5, -2.45]), v([-4.6, 0.6, -3.5]), v([-6.8, 2.0, -5.2])], from: 0.24, to: 0.07, twigs: 4, leaves: 2 },
  { points: [v([1.5, 3.05, -1.1]), v([2.2, 4.7, -2.4]), v([3.0, 6.8, -4.2])], from: 0.15, to: 0.04, twigs: 3, leaves: 2 },
  { points: [v([2.6, -2.65, -0.5]), v([3.6, -4.6, -1.5]), v([4.6, -7.2, -3.2])], from: 0.14, to: 0.04, twigs: 3, leaves: 2 },
  // The branches the web is strung between, out of the limbs.
  { points: [v([-1.6, -2.9, -1.6]), v([-2.0, -1.8, -0.6]), v(anchorPoint(4)), v(anchorPoint(5)), v(anchorPoint(0)), v([0.7, 1.85, -0.2]), v([1.4, 2.95, -1.1])], from: 0.14, to: 0.09, twigs: 7, leaves: 4 },
  { points: [v([3.6, 3.3, -1.1]), v([2.4, 1.5, -0.35]), v(anchorPoint(1)), v([0.85, 1.12, 0.06])], from: 0.08, to: 0.012, twigs: 4, leaves: 3 },
  { points: [v([2.0, -2.8, -0.65]), v([1.5, -1.8, -0.2]), v(anchorPoint(2)), v([1.25, -0.25, 0.03])], from: 0.05, to: 0.009, twigs: 2, leaves: 2 },
  { points: [v([-0.4, -3.0, -1.2]), v([-0.5, -2.0, -0.3]), v(anchorPoint(3)), v([0.12, -0.92, 0.05])], from: 0.032, to: 0.006, twigs: 1, leaves: 1 }
];

// The bark as it is actually grown, limbs and twigs alike, noted by the garden as it shapes each one: beads along it,
// where it is and how thick there, swellings and all. Only what is near the web, where she could be.
const grown: number[] = [];
let beads: Float32Array | null = null;
export function forgetBark() {
  grown.length = 0;
  beads = null;
}
export function noteBark(at: THREE.Vector3, r: number) {
  if (Math.hypot(at.x, at.y) > 2.2 || at.z < -0.8) return;
  grown.push(at.x, at.y, at.z, r);
  beads = null;
}

// Before the garden has grown, a guess from where the limbs run: no twigs or swellings, so taken generously.
function bead() {
  const list: number[] = [];
  for (const limb of LIMBS) {
    const curve = new THREE.CatmullRomCurve3(limb.points, false, "centripetal");
    const steps = Math.max(8, Math.ceil(curve.getLength() / 0.03));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const at = curve.getPointAt(t);
      // Only what she could ever be on: near the web and not far behind it.
      if (Math.hypot(at.x, at.y) > 2.2 || at.z < -0.6) continue;
      list.push(at.x, at.y, at.z, (limb.from + (limb.to - limb.from) * t ** 0.75) * 1.5);
    }
  }
  return new Float32Array(list);
}

// How far toward the eye the bark stands at a place in the web's plane: the front of whatever limb lies there, or far
// behind everything where there is none. The frame is tied to the middles of the limbs, so a spider keeping to the
// threads would walk through the wood: she rides over it at this height instead.
export function barkFront(x: number, y: number) {
  beads ??= grown.length ? new Float32Array(grown) : bead();
  let front = -Infinity;
  for (let k = 0; k < beads.length; k += 4) {
    const dx = x - beads[k];
    const dy = y - beads[k + 1];
    const r = beads[k + 3];
    const off = dx * dx + dy * dy;
    if (off >= r * r) continue;
    const z = beads[k + 2] + Math.sqrt(r * r - off);
    if (z > front) front = z;
  }
  return front;
}
