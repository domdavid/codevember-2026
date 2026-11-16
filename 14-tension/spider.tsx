"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three/webgpu";
import { Fn, cameraPosition, color, dot, float, fract, max, mix, mx_fractal_noise_float, normalWorld, normalize, positionLocal, positionWorld, pow, smoothstep } from "three/tsl";
import { useDispose } from "../shared/engine/dispose";
import { sound } from "../shared/engine/sound";
import { sky } from "./backdrop";
import { barkFront } from "./limbs";
import type { Look } from "./versions";
import { Kind as Thread, type Run, type Web } from "./web";

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL's node types do not model every operator. */

// The web's owner, built and moved like the real animal. Each leg is coxa, femur, patella, tibia, metatarsus and tarsus,
// of fixed lengths, solved each frame so the femur rises to a high knee and the lower leg comes down steeply to a foot
// that grips a thread, and rides that thread as the web swings. She walks in an alternating tetrapod: legs 1 and 3 of
// one side with 2 and 4 of the other, the two sets taking turns, each set rippling from back to front. She runs in
// dashes with sudden freezes, as spiders do, feels about with her palps when she stops, and sits head down at the hub.
// Asked to, she spins the web again from bare twigs, in the order a spider does, drawing each thread out behind her.

export const alarm = { node: -1, at: 0 };
// For testing in development: send her somewhere from the console.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as any).__spiderAlarm = alarm;

// Segment lengths of one leg, as fractions of its whole: coxa, trochanter-femur, patella, tibia, metatarsus, tarsus.
const SEGMENTS = [0.07, 0.3, 0.08, 0.24, 0.22, 0.09];
// Legs I to IV: how long against leg I, and where each reaches at rest, as an angle from straight ahead.
const LENGTH = [1, 0.92, 0.62, 0.84];
const AIM = [22, 52, 105, 152].map((d) => (d * Math.PI) / 180);
// How far out each foot rests, as a fraction of its leg.
const SPAN = [0.84, 0.8, 0.74, 0.84];

type Kind = { golden: boolean; body: number; leg: number; thick: number };
const kindOf = (look: Look): Kind => (look.spider === "golden" ? { golden: true, body: 0.2, leg: 0.56, thick: 0.6 } : { golden: false, body: 0.13, leg: 0.28, thick: 1 });

type Leg = {
  side: number;
  k: number;
  set: number;
  // The thread point the foot holds, and where it is headed while swinging.
  node: number;
  foot: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  swing: number;
  swingFor: number;
  toNode: number;
  // A small lift, as when feeling the thread, rather than a stride.
  low: boolean;
};

// A sphere pulled into a shape by a function of its unit position.
function shaped(shape: (p: THREE.Vector3) => void, wide = 32, high = 20) {
  const g = new THREE.SphereGeometry(1, wide, high);
  const p = g.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    shape(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function Spider({ web, look, active }: { web: Web; look: Look; active: boolean }) {
  const kind = useMemo(() => kindOf(look), [look]);
  const { golden, body, leg: legLength, thick } = kind;

  const parts = useMemo(() => {
    // Hairy chitin: a soft bright fringe toward the light behind, as the fine hairs catch it.
    const fuzz = (base: any, amount: number) =>
      Fn(() => {
        const V = normalize(cameraPosition.sub(positionWorld)) as any;
        const N = normalize(normalWorld) as any;
        const rim = pow(dot(N, V).abs().oneMinus(), 2.5) as any;
        const back = pow(max(dot(V.negate(), sky.toLight), 0), 2)
          .mul(0.7)
          .add(0.3) as any;
        return base.mul(0.08).add(sky.light.mul(rim.mul(back).mul(sky.power).mul(amount)));
      })();
    const grain = mx_fractal_noise_float(positionLocal.mul(400), 2, 2, 0.5) as any;

    const shell = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
    const shellColour = (golden ? mix(color("#b9b4a0"), color("#efe9d0"), grain.mul(0.5).add(0.5)) : color("#4a3220").mul(grain.mul(0.25).add(1))) as any;
    shell.colorNode = shellColour;
    shell.emissiveNode = fuzz(shellColour, 0.5) as any;

    // A garden spider's back: warm brown, a darker leaf-shaped band down the middle edged in black, and a pale cross of
    // spots in it. The golden silk spider's: long, olive gold, with silver-white spots in rows.
    const belly = new THREE.MeshStandardNodeMaterial({ roughness: 0.35 });
    const x = positionLocal.x.abs() as any;
    const y = positionLocal.y as any;
    const z = positionLocal.z as any;
    let back: any;
    if (golden) {
      const rows = smoothstep(0.3, 0.12, fract(y.mul(4.5)).sub(0.5).abs().add(x.sub(0.45).abs().mul(1.4))) as any;
      back = mix(mix(color("#6f6a2c"), color("#b8a648"), smoothstep(-0.6, 0.8, z)), color("#f3efe0"), rows.mul(smoothstep(0, 0.5, z)));
    } else {
      const edge = x.sub(float(0.42).add(y.mul(6).sin().mul(0.06))) as any;
      const band = smoothstep(0.03, -0.03, edge) as any;
      const rim = smoothstep(0.08, 0, edge.abs()) as any;
      const cross = smoothstep(0.1, 0.05, x)
        .mul(smoothstep(0.75, 0.55, y.abs()))
        .max(smoothstep(0.06, 0.02, y.sub(0.28).abs()).mul(smoothstep(0.42, 0.3, x))) as any;
      const dots = smoothstep(
        0.45,
        0.2,
        fract(y.mul(9))
          .sub(0.5)
          .abs()
          .mul(2)
          .add(fract(x.mul(9)).sub(0.5).abs().mul(2))
      ) as any;
      const top = smoothstep(-0.1, 0.5, z) as any;
      back = mix(color("#9b6a3c"), color("#5a3a20"), band);
      back = mix(back, color("#1e130b"), rim.mul(0.8));
      back = mix(back, color("#f2e8d2"), cross.mul(dots.mul(0.5).add(0.5)).mul(top));
      back = mix(color("#3a2616"), back, top.mul(0.8).add(0.2));
    }
    back = back.mul(grain.mul(0.15).add(1));
    belly.colorNode = back;
    belly.emissiveNode = fuzz(back, 0.45) as any;

    // Legs banded segment by segment: pale along the middle of each, dark at the joints (golden: black and gold).
    const band = positionLocal.y.sub(0.5).abs().mul(2).oneMinus() as any;
    const limbColour = (golden ? mix(color("#191714"), color("#d6ad34"), smoothstep(0.42, 0.5, band)) : mix(color("#2a1a0f"), color("#8a5c34"), smoothstep(0.35, 0.55, band))).mul(
      grain.mul(0.2).add(1)
    ) as any;
    const limb = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
    limb.colorNode = limbColour;
    limb.emissiveNode = fuzz(limbColour, 0.7) as any;
    const eye = new THREE.MeshStandardNodeMaterial({
      roughness: 0.05,
      metalness: 0.2,
      color: "#050505"
    });

    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, at: [number, number, number], scale: [number, number, number], tilt = 0) => {
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...at);
      mesh.scale.set(...scale);
      mesh.rotation.x = tilt;
      group.add(mesh);
      return mesh;
    };
    // Body frame: +y forward, +z the back (toward the eye), +x right.
    const b = body;
    // The cephalothorax: a shield, wider behind, with the head rising at the front.
    add(
      shaped((p) => {
        const front = Math.max(0, p.y);
        p.x *= 1 - front * 0.35;
        p.z *= 0.75 + front * 0.25 - Math.max(0, -p.z) * 0.3;
      }),
      shell,
      [0, b * 0.18, b * 0.06],
      [b * 0.21, b * 0.27, b * 0.15]
    );
    // Eight eyes in two rows on the head, the middle four bigger.
    const eyeBall = new THREE.SphereGeometry(1, 10, 8);
    geometries.push(eyeBall);
    for (const [ex, ey, ez, r] of [
      [0.03, 0.43, 0.15, 0.022],
      [-0.03, 0.43, 0.15, 0.022],
      [0.035, 0.39, 0.17, 0.02],
      [-0.035, 0.39, 0.17, 0.02],
      [0.08, 0.41, 0.12, 0.014],
      [-0.08, 0.41, 0.12, 0.014],
      [0.085, 0.38, 0.13, 0.013],
      [-0.085, 0.38, 0.13, 0.013]
    ]) {
      const m = new THREE.Mesh(eyeBall, eye);
      m.position.set(ex * b, ey * b, ez * b);
      m.scale.setScalar(r * b);
      group.add(m);
    }
    // Chelicerae, the fangs' bases, hanging forward under the head.
    for (const s of [-1, 1])
      add(
        shaped((p) => (p.y *= 1 + Math.max(0, p.y) * 0.2)),
        shell,
        [s * b * 0.05, b * 0.45, b * 0.03],
        [b * 0.05, b * 0.08, b * 0.045],
        -0.5
      );
    // The fangs, curved back under the chelicerae.
    for (const s of [-1, 1]) add(new THREE.ConeGeometry(1, 3, 8), eye, [s * b * 0.05, b * 0.5, -b * 0.015], [b * 0.012, b * 0.016, b * 0.012], Math.PI * 0.75);
    // The abdomen: a garden spider's round and swollen at the front, the golden one's long and narrow.
    const abdomen = add(
      shaped(
        (p) => {
          const front = Math.max(0, p.y);
          p.z *= 1 + front * 0.15;
          p.x *= 1 + front * 0.1 - Math.max(0, -p.y) * 0.25;
          // A garden spider's two shoulder humps, either side at the front of the back.
          if (!golden && p.z > 0) p.z += 0.22 * Math.exp(-((Math.abs(p.x) - 0.45) ** 2 + (p.y - 0.45) ** 2) * 14);
        },
        48,
        32
      ),
      belly,
      golden ? [0, -b * 0.42, b * 0.1] : [0, -b * 0.3, b * 0.12],
      golden ? [b * 0.16, b * 0.5, b * 0.15] : [b * 0.32, b * 0.38, b * 0.3]
    );
    // Spinnerets at the tip.
    add(new THREE.ConeGeometry(1, 2, 10), shell, golden ? [0, -b * 0.93, b * 0.08] : [0, -b * 0.68, b * 0.06], [b * 0.03, b * 0.025, b * 0.03], Math.PI);

    // Legs and palps as one instanced tapered cylinder per segment, and one instanced ball per joint.
    const legCount = 8 * SEGMENTS.length + 2 * 3;
    const tube = new THREE.CylinderGeometry(0.8, 1, 1, 10, 1).translate(0, 0.5, 0);
    const segments = new THREE.InstancedMesh(tube, limb, legCount);
    segments.frustumCulled = false;
    const knob = new THREE.SphereGeometry(1, 10, 8);
    const joints = new THREE.InstancedMesh(knob, limb, legCount);
    joints.frustumCulled = false;
    // Spines along the femur, tibia and metatarsus, three to each, and a claw at every foot.
    const spike = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
    const spines = new THREE.InstancedMesh(spike, limb, 8 * 10);
    spines.frustumCulled = false;
    geometries.push(tube, knob, spike);
    return {
      group,
      abdomen,
      segments,
      joints,
      spines,
      materials: [shell, belly, limb, eye],
      geometries
    };
  }, [golden, body]);
  useDispose(...parts.materials, ...parts.geometries);

  const state = useMemo(
    () => ({
      route: [] as number[],
      leg: 0,
      u: 0,
      speed: 0,
      // Stop-go: how long the current dash or freeze lasts.
      dash: 0,
      frozen: 0,
      wait: 0,
      dip: 0,
      // When she last felt the web with a foreleg.
      tug: 2,
      home: true,
      // Spinning: which spinning of the web she is at work on, and what she is doing: walking to where the next line
      // begins, laying one as she walks it, carrying one round by the silk already up, or standing while one is let
      // out on the breeze. Of a line let out, how many threads have gone and how far into the next it is.
      job: null as object | null,
      phase: "walk" as "walk" | "lay" | "carry" | "float" | "sink",
      // Mending: the torn thread she is laying again, or on her way to.
      mend: null as Run | null,
      // How far she is lifted toward the eye to ride over a limb, where the thread she is on runs through the wood.
      rise: 0,
      out: 0,
      paid: 0,
      seen: 0,
      at: new THREE.Vector3(),
      heading: new THREE.Vector3(0, -1, 0),
      // Which way she faces, as an angle in the web, turned by the shorter way round.
      yaw: -Math.PI / 2,
      started: false,
      legs: Array.from({ length: 8 }, (_, i): Leg => {
        const side = i < 4 ? -1 : 1;
        const k = i % 4;
        return {
          side,
          k,
          set: (k + (side > 0 ? 1 : 0)) % 2,
          node: -1,
          foot: new THREE.Vector3(),
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          swing: -1,
          swingFor: 0.1,
          toNode: -1,
          low: false
        };
      }),
      time: 0
    }),
    // Starts over on a new web.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [web, kind]
  );

  const s3 = useMemo(
    () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      d: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      want: new THREE.Vector3(),
      hip: new THREE.Vector3(),
      across: new THREE.Vector3(),
      joints: Array.from({ length: 7 }, () => new THREE.Vector3()),
      basis: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      m: new THREE.Matrix4(),
      s: new THREE.Vector3(),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1)
    }),
    []
  );

  const node = (i: number, out: THREE.Vector3) => out.set(web.position[i * 3], web.position[i * 3 + 1], web.position[i * 3 + 2]);
  // The thread point nearest a place, within a reach, for a foot to take hold of.
  // Never one another's: each foot takes a point no other foot holds or is reaching for.
  const grip = (at: THREE.Vector3, reach: number, avoid = -1) => {
    let best = -1;
    let bestD = reach * reach;
    const p = web.position;
    const held = state.legs.map((l) => (l.swing >= 0 ? l.toNode : l.node));
    for (let i = 0; i < web.count; i++) {
      if (i === avoid || web.pinned[i] || !web.hung[i] || held.includes(i)) continue;
      const d = (p[i * 3] - at.x) ** 2 + (p[i * 3 + 1] - at.y) ** 2 + (p[i * 3 + 2] - at.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const top = golden ? 0.55 : 0.75;
  useFrame((_, rawDelta) => {
    // Hidden, she keeps still, and does not answer what was plucked meanwhile on another web.
    if (!active) {
      state.seen = alarm.at;
      return;
    }
    const delta = Math.min(rawDelta, 1 / 30);
    // Spinning a web is an hour's work, shown in about a minute: her own time runs several times over in each frame,
    // so it is her same gait, only quicker.
    const lapse = web.building ? Math.min(8, Math.max(1, (web.silk * 1.25) / (top * 70))) : 1;
    const times = Math.ceil(lapse);
    for (let k = 0; k < times; k++) tick((delta * lapse) / times);
    parts.segments.instanceMatrix.needsUpdate = true;
    parts.joints.instanceMatrix.needsUpdate = true;
    parts.spines.instanceMatrix.needsUpdate = true;
  });

  const tick = (delta: number) => {
    const s = state;
    s.time += delta;
    const { a, b, d, right, up, want, hip, across, joints, basis, q, m } = s3;
    const turn = (toward: number, rate: number) => {
      const by = Math.atan2(Math.sin(toward - s.yaw), Math.cos(toward - s.yaw));
      s.yaw += by * (1 - Math.exp(-delta * rate));
      s.heading.set(Math.cos(s.yaw), Math.sin(s.yaw), 0);
    };

    // The old web is to come down: she leaves it for the point on the frame she will start the new one from, by the
    // silk, and from there hauls it in. If there is no way there she is not waited for.
    const job = web.building;
    if (web.leaving) {
      s.seen = alarm.at;
      if (s.job !== web.leaving) {
        s.job = web.leaving;
        s.phase = "walk";
        s.mend = null;
        s.home = false;
        const from = s.route.length > 1 ? s.route[Math.min(s.leg + 1, s.route.length - 1)] : (s.route[0] ?? web.hub);
        const way = web.way(from, web.perch);
        s.route = way.length > 1 ? way : [from];
        s.leg = 0;
        s.u = 0;
      } else if (!(s.route.length > 1 && s.leg < s.route.length - 1)) {
        web.eat();
        // Her feet let go of what is coming in.
        for (const leg of s.legs) {
          if (leg.node >= 0 && !web.hung[leg.node]) leg.node = -1;
          if (leg.toNode >= 0 && !web.hung[leg.toNode]) leg.toNode = -1;
        }
      }
    } else if (web.eating >= 0) {
      // She stays where she is and hauls it in.
      s.seen = alarm.at;
      s.wait = 0;
    } else if (job) {
      s.seen = alarm.at;
      if (s.job !== job) {
        // Bare twigs: she starts at the first of them.
        s.job = job;
        s.phase = "walk";
        s.started = false;
        s.route = [web.runs[job.run].nodes[0]];
        s.leg = 0;
        s.u = 0;
        s.speed = 0;
        s.home = false;
        node(s.route[0], s.at);
        for (const leg of s.legs) {
          leg.node = -1;
          leg.toNode = -1;
          leg.swing = -1;
        }
      }
      // A line let out on the breeze, while she stands and waits for it to catch.
      const floating = web.runs[job.run];
      if (s.phase === "float" && floating) {
        s.paid += delta * 0.45;
        while (s.out < floating.segs.length && s.paid >= web.segments[floating.segs[s.out]].rest) {
          s.paid -= web.segments[floating.segs[s.out]].rest;
          web.spin(floating.segs[s.out]);
          web.hung[floating.nodes[++s.out]] = 1;
        }
      }
      const waiting = s.phase === "float" && floating && s.out < floating.segs.length;
      if (!waiting && !(s.route.length > 1 && s.leg < s.route.length - 1)) {
        const here = s.route[0];
        const slung = web.runs[job.run];
        if (s.phase === "carry" && slung && slung.mode === "sling") {
          // The first line across is fast at both ends and hangs loose. Out along it to its middle, and down it goes.
          slung.segs.forEach((seg, k) => {
            web.spin(seg);
            web.hung[slung.nodes[k + 1]] = 1;
          });
          web.slacken(slung.nodes);
          s.phase = "sink";
          s.route = slung.nodes.slice(slung.nodes.indexOf(web.hub)).reverse();
          s.leg = 0;
          s.u = 0;
        } else if (s.phase !== "walk") {
          // Made fast at its far end: the line is let go to hang, and rings a little as it takes the strain. One she
          // carried round is only now pulled straight between its two ends.
          const made = web.runs[job.run];
          web.sink(1);
          made.segs.forEach((seg, k) => {
            web.spin(seg);
            web.hung[made.nodes[k + 1]] = 1;
          });
          web.hang(made.free);
          if (made.kind === Thread.Frame || made.kind === Thread.Spoke) sound.play("pluck", { gain: 0.05, pitch: 1.4 + Math.random() * 0.5, size: 0.1, pan: s.at.x * 0.4 });
          s.phase = "walk";
          job.run++;
        }
        const next = s.phase === "sink" ? undefined : web.runs[job.run];
        if (s.phase === "sink") {
          // Already on her way out along the sling.
        } else if (!next) {
          web.finish();
          s.job = null;
          s.wait = 1;
        } else {
          // If there is no way there along the silk, as when what she stood on has been snapped, she starts regardless.
          const way = here === next.nodes[0] ? [] : web.way(here, next.nodes[0]);
          if (way.length > 1) s.route = way;
          else if (next.mode === "float") {
            s.phase = "float";
            s.out = 0;
            s.paid = 0;
            s.route = [next.nodes[0]];
          } else {
            // Carried round by the silk already up, if there is a way round; if not, laid as she goes.
            const round = next.mode === "carry" || next.mode === "sling" ? web.way(next.nodes[0], next.nodes[next.nodes.length - 1]) : [];
            s.phase = round.length > 1 ? "carry" : "lay";
            s.route = round.length > 1 ? round : next.nodes;
          }
          s.leg = 0;
          s.u = 0;
        }
      }
    } else if (s.mend || (web.torn.length > 0 && web.grabbed < 0 && web.time - web.tornAt > 3 && !(s.route.length > 1 && s.leg < s.route.length - 1))) {
      // Mending: when the web has been still a while after threads were snapped, she goes out to the nearest of them
      // along the silk and lays it again from one end to the other, then the next, and home when there are no more
      // she can reach. Nothing plucked draws her off it.
      s.seen = alarm.at;
      if (!(s.route.length > 1 && s.leg < s.route.length - 1)) {
        const here = s.route[0] ?? web.hub;
        if (s.phase === "lay" && s.mend) {
          sound.play("pluck", { gain: 0.05, pitch: 1.5 + Math.random() * 0.5, size: 0.1, pan: s.at.x * 0.4 });
          s.phase = "walk";
          s.mend = null;
        }
        web.torn = web.torn.filter((seg) => !web.segments[seg].alive);
        if (s.mend && here === s.mend.nodes[0]) {
          s.phase = "lay";
          s.route = s.mend.nodes;
        } else {
          // The nearest torn thread with an end she can get to.
          const far = web.reach(here);
          let best = -1;
          let from = -1;
          for (const index of web.torn) {
            const seg = web.segments[index];
            const end = far[seg.a] <= far[seg.b] ? seg.a : seg.b;
            if (far[end] < (from < 0 ? Infinity : far[from])) {
              best = index;
              from = end;
            }
          }
          if (best < 0) {
            // None, or none she can reach: home, and she looks again in a while.
            s.mend = null;
            s.phase = "walk";
            web.tornAt = web.time;
            s.wait = here === web.hub ? 0 : 0.3;
            s.home = false;
            s.route = [here];
          } else {
            const seg = web.segments[best];
            s.mend = { mode: "lay", nodes: [from, from === seg.a ? seg.b : seg.a], segs: [best], free: [], pace: 0.6, kind: seg.kind };
            const way = here === from ? [] : web.way(here, from);
            s.phase = way.length > 1 ? "walk" : "lay";
            s.route = way.length > 1 ? way : s.mend.nodes;
          }
        }
        s.leg = 0;
        s.u = 0;
      }
    } else if (alarm.at !== s.seen && alarm.node >= 0) {
      s.seen = alarm.at;
      const from = s.route.length > 1 ? s.route[Math.min(s.leg + 1, s.route.length - 1)] : (s.route[0] ?? web.hub);
      const route = web.path(from, alarm.node);
      if (route.length > 1) {
        s.route = route;
        s.leg = 0;
        s.u = 0;
        s.home = false;
        s.dash = 0.3 + Math.random() * 0.3;
        s.frozen = 0;
      }
    }

    // How fast: dashing, freezing, slowing on the last stretch, unhurried going home.
    let wanted = 0;
    const moving = s.route.length > 1 && s.leg < s.route.length - 1;
    const making = web.building ? web.runs[web.building.run] : (s.mend ?? undefined);
    const run = s.phase === "lay" ? making : undefined;
    if (moving && (web.building || web.leaving)) wanted = top * (s.phase === "sink" ? 0.22 : run ? run.pace : 1);
    else if (moving && s.mend) wanted = top * (run ? run.pace : 0.8);
    else if (moving) {
      if (s.frozen > 0) s.frozen -= delta;
      else {
        s.dash -= delta;
        if (s.dash <= 0 && !s.home) {
          s.frozen = 0.08 + Math.random() * 0.22;
          s.dash = 0.25 + Math.random() * 0.45;
        }
        wanted = s.home ? top * 0.3 : top;
        const left = s.route.length - 1 - s.leg - s.u;
        if (left < 3) wanted *= 0.35 + left * 0.2;
      }
    }
    s.speed += (wanted - s.speed) * (1 - Math.exp(-delta * (wanted > s.speed ? 14 : 22)));

    if (moving) {
      node(s.route[s.leg], a);
      node(s.route[s.leg + 1], b);
      s.u += (s.speed * delta) / Math.max(1e-4, a.distanceTo(b));
      while (s.u >= 1 && s.leg < s.route.length - 1) {
        s.u -= 1;
        s.leg++;
        // Spinning, each point she passes has silk to it now.
        if (run) {
          web.spin(run.segs[s.leg - 1]);
          web.hung[s.route[s.leg]] = 1;
        }
      }
      if (s.leg >= s.route.length - 1) {
        const end = s.route[s.route.length - 1];
        s.wait = s.home ? 0 : 2 + Math.random() * 2.5;
        s.route = [end];
        s.leg = 0;
        s.u = 0;
      } else {
        node(s.route[s.leg], a);
        node(s.route[s.leg + 1], b);
        // The body follows the route smoothly rather than turning hard at every crossing of threads, and faces the
        // way it is actually going.
        s3.want.copy(a).lerp(b, s.u);
        d.copy(s.at);
        s.at.lerp(s3.want, 1 - Math.exp(-delta * 16));
        d.subVectors(s.at, d).setZ(0);
        if (d.lengthSq() > 1e-12) turn(Math.atan2(d.y, d.x), 7);
      }
    } else {
      const rest = s.route[0] ?? web.hub;
      node(rest, a);
      if (!s.started) s.at.copy(a);
      s.at.lerp(a, 1 - Math.exp(-delta * 10));
      if (s.wait > 0) {
        s.wait -= delta;
        if (s.wait <= 0) {
          const route = web.path(rest, web.hub);
          if (route.length > 1) {
            s.route = route;
            s.leg = 0;
            s.u = 0;
            s.home = true;
          }
        }
      } else if (!job && (rest === web.hub || s.home)) {
        turn(-Math.PI / 2, 2);
        // Now and then she feels the web: a foreleg lifts and pulls on its thread, and the web shivers with it.
        s.tug -= delta;
        if (s.tug <= 0) {
          s.tug = 2.5 + Math.random() * 5;
          const leg = s.legs.find((l) => l.k === (Math.random() < 0.6 ? 0 : 1) && l.side === (Math.random() < 0.5 ? -1 : 1));
          if (leg && leg.swing < 0 && leg.node >= 0) {
            leg.from.copy(leg.foot);
            leg.toNode = leg.node;
            leg.swing = 0;
            leg.swingFor = 0.18;
            leg.low = true;
            web.previous[leg.node * 3 + 2] -= 0.004;
            web.previous[leg.node * 3 + 1] += 0.002;
          }
        }
      }
    }

    // The sling sinks as she nears its middle, slowly at first.
    if (web.building && s.phase === "sink" && s.route.length > 1) {
      const f = Math.min(1, (s.leg + s.u) / (s.route.length - 1));
      web.sink(Math.min(0.999, f * f * (3 - 2 * f)));
    }

    // The thread being drawn out: from the last point it was made fast at to where she is, or, let out on the breeze,
    // to as far as it has got.
    const going = s.route.length > 1 && s.leg < s.route.length - 1;
    web.laying.seg = -1;
    if (run && going) {
      web.laying.seg = run.segs[s.leg];
      web.laying.from = s.route[s.leg];
      web.laying.x = s.at.x;
      web.laying.y = s.at.y;
      web.laying.z = s.at.z;
    } else if (making && s.phase === "carry" && going) {
      web.laying.seg = making.segs[0];
      web.laying.from = making.nodes[0];
      web.laying.x = s.at.x;
      web.laying.y = s.at.y;
      web.laying.z = s.at.z;
    } else if (making && s.phase === "float" && s.out < making.segs.length) {
      const f = s.paid / web.segments[making.segs[s.out]].rest;
      node(making.nodes[s.out], a);
      node(making.nodes[s.out + 1], b);
      a.lerp(b, f);
      web.laying.seg = making.segs[s.out];
      web.laying.from = making.nodes[s.out];
      web.laying.x = a.x;
      web.laying.y = a.y;
      web.laying.z = a.z;
    }

    // The body's frame on the web: back toward the eye, riding a little above the threads, lower as it runs.
    up.copy(s3.z);
    right.crossVectors(s.heading, up).normalize();
    // Lower as it runs, and dipping a touch each time a set of legs is in the air.
    const lifted = s.legs.filter((leg) => leg.swing >= 0).length;
    s.dip += (lifted / 4 - s.dip) * (1 - Math.exp(-delta * 25));
    const lift = body * (0.32 - Math.min(1, s.speed / top) * 0.08 - s.dip * 0.035);
    // Over the bark, where a limb lies under her.
    // Up at once, so she is never in the wood, and down again gently.
    const over = Math.max(0, barkFront(s.at.x, s.at.y) + body * 0.1 - s.at.z);
    s.rise = over > s.rise ? over : s.rise + (over - s.rise) * (1 - Math.exp(-delta * 14));
    basis.makeBasis(right, s.heading, up);
    basis.setPosition(s.at.x, s.at.y, s.at.z + s.rise + lift);
    parts.group.matrixAutoUpdate = false;
    parts.group.matrix.copy(basis);
    parts.group.matrixWorldNeedsUpdate = true;
    // Breathing: a slow rise and fall of the abdomen.
    parts.abdomen.rotation.x = Math.sin(s.time * 1.3) * 0.03;

    // The legs.
    const swinging = [0, 0];
    s.legs.forEach((leg) => leg.swing >= 0 && swinging[leg.set]++);
    let slot = 0;
    const bone = (from: THREE.Vector3, to: THREE.Vector3, r: number, joint: boolean) => {
      d.subVectors(to, from);
      const length = d.length();
      q.setFromUnitVectors(s3.y, d.divideScalar(Math.max(length, 1e-9)));
      parts.segments.setMatrixAt(slot, m.compose(from, q, s3.s.set(r, length, r)));
      parts.joints.setMatrixAt(slot, m.compose(from, q, s3.s.setScalar(joint ? r * 1.25 : 0)));
      slot++;
    };
    s.legs.forEach((leg) => {
      const length = legLength * LENGTH[leg.k];
      // At rest the legs shift a hair now and then.
      const angle = AIM[leg.k] + (s.speed > 0.05 ? 0 : Math.sin(s.time * 0.7 + leg.k) * 0.03);
      // The hip: round the edge of the cephalothorax.
      hip.set(Math.sin(AIM[leg.k] * 0.8) * body * 0.17 * leg.side, body * (0.24 - leg.k * 0.05), body * 0.06).applyMatrix4(basis);
      // Where the foot would rest, a little ahead of where the body is going.
      const reach = length * SPAN[leg.k];
      want
        .copy(s.at)
        .addScaledVector(s.heading, Math.cos(angle) * reach)
        .addScaledVector(right, Math.sin(angle) * reach * leg.side);

      if (!s.started) {
        leg.node = grip(want, length * 0.6);
        if (leg.node >= 0) node(leg.node, leg.foot);
        else leg.foot.copy(want);
      }
      if (leg.swing >= 0) {
        // Swinging: lifted up and over to the next thread.
        leg.swing += delta / leg.swingFor;
        const t = Math.min(1, leg.swing);
        if (leg.toNode >= 0) node(leg.toNode, b);
        else b.copy(leg.to);
        leg.foot.lerpVectors(leg.from, b, t * t * (3 - 2 * t)).addScaledVector(up, Math.sin(t * Math.PI) * length * (leg.low ? 0.07 : 0.16));
        if (t >= 1) {
          leg.swing = -1;
          leg.node = leg.toNode;
          leg.low = false;
        }
      } else {
        // Planted: on its thread, riding it, or where it was set down if it found none.
        if (leg.node >= 0) node(leg.node, leg.foot);
        const far = leg.foot.distanceTo(want);
        const strained = leg.foot.distanceTo(hip) > length * 0.9;
        // A step is due when the foot has fallen far enough behind, or is about to be pulled past its reach. The other
        // set must be down first, and the leg in front on the same side well into its swing, so steps ripple back to
        // front; a strained leg goes anyway rather than stretch.
        const ahead = s.legs.find((o) => o.side === leg.side && o.k === leg.k - 1);
        const due = far > length * (s.speed > 0.05 ? 0.26 : 0.2) || strained;
        if (due && (strained || (swinging[1 - leg.set] === 0 && !(ahead && ahead.swing >= 0 && ahead.swing < 0.5)))) {
          // Aimed ahead by as far as the body goes while the leg is in the air, so it lands under the body, not out
          // in front of it. The nearest free thread point there, or failing one in reach, wherever it was aimed.
          const swingFor = s.speed > 0.05 ? Math.max(0.05, 0.12 - s.speed * 0.08) : 0.15;
          d.copy(want).addScaledVector(s.heading, s.speed * swingFor);
          let target = grip(d, length * 0.35, leg.node);
          if (target < 0) target = grip(d, length * 0.7, leg.node);
          // Spinning, with no thread there to take: a foot goes to the line behind her, the one she hangs by, never
          // out onto nothing.
          if (target < 0 && web.building) {
            across.subVectors(d, s.at);
            const off = across.dot(right);
            const along = across.dot(s.heading);
            d.copy(s.at)
              .addScaledVector(s.heading, -Math.abs(along) * 0.7 - length * 0.1)
              .addScaledVector(right, off * 0.1);
          }
          leg.toNode = target;
          leg.to.copy(d);
          leg.from.copy(leg.foot);
          leg.swing = 0;
          leg.swingFor = swingFor;
          leg.low = false;
          swinging[leg.set]++;
        }
      }

      // A foot on a limb stands on the bark, not in the wood.
      const bark = barkFront(leg.foot.x, leg.foot.y);
      if (bark > leg.foot.z) leg.foot.z = bark;

      // The joints, solved in the plane through hip, foot and the body's up: the coxa out, the femur up to a high
      // knee, the patella and tibia down, the metatarsus and tarsus steeply to the foot. Lengths never change: a foot
      // out of reach straightens the leg toward it rather than stretching it.
      const L = SEGMENTS.map((f) => f * length);
      across.subVectors(leg.foot, hip);
      const rise = across.dot(up);
      across.addScaledVector(up, -rise);
      const out = Math.max(1e-6, across.length());
      across.divideScalar(out);
      const at2 = (x: number, y: number, v: THREE.Vector3) => v.copy(hip).addScaledVector(across, x).addScaledVector(up, y);
      const cx = L[0] * 0.9;
      const cy = L[0] * 0.4;
      const lower = L[4] + L[5];
      const slant = 1.15;
      let ax = out - Math.cos(slant) * lower;
      let ay = rise + Math.sin(slant) * lower;
      const upper = L[1];
      const middle = L[2] + L[3];
      let dx = ax - cx;
      let dy = ay - cy;
      let span = Math.hypot(dx, dy);
      const most = (upper + middle) * 0.995;
      const least = Math.abs(upper - middle) * 1.05;
      if (span > most || span < least) {
        const to = span > most ? most : least;
        ax = cx + (dx / Math.max(span, 1e-9)) * to;
        ay = cy + (dy / Math.max(span, 1e-9)) * to;
        dx = ax - cx;
        dy = ay - cy;
        span = to;
      }
      const along = (span * span + upper * upper - middle * middle) / (2 * span);
      const h = Math.sqrt(Math.max(0, upper * upper - along * along));
      const kx = cx + (dx * along) / span - (dy * h) / span;
      const ky = cy + (dy * along) / span + (dx * h) / span;
      const pk = L[2] / middle;
      const tx = kx + (ax - kx) * pk;
      const ty = ky + (ay - ky) * pk + L[2] * 0.25;
      const fx = ax + Math.cos(slant) * lower;
      const fy = ay - Math.sin(slant) * lower;
      const mt = L[4] / lower;
      at2(0, 0, joints[0]);
      at2(cx, cy, joints[1]);
      at2(kx, ky, joints[2]);
      at2(tx, ty, joints[3]);
      at2(ax, ay, joints[4]);
      at2(ax + (fx - ax) * mt, ay + (fy - ay) * mt + L[5] * 0.15, joints[5]);
      at2(fx, fy, joints[6]);
      const r = body * 0.055 * thick;
      const taper = [1.15, 1, 0.85, 0.8, 0.55, 0.38];
      // The golden silk spider's tibiae carry tufts of dark hair.
      for (let n = 0; n < 6; n++) bone(joints[n], joints[n + 1], r * taper[n] * (golden && n === 3 ? 1.7 : 1), n > 0);
      // Spines stand out from the leg, up and to either side, raked toward the foot; the claw curls under at the tip.
      let spine = s.legs.indexOf(leg) * 10;
      const spike = (base: THREE.Vector3, dir: THREE.Vector3, length: number, width: number) => {
        q.setFromUnitVectors(s3.y, dir.normalize());
        parts.spines.setMatrixAt(spine++, m.compose(base, q, s3.s.set(width, length, width)));
      };
      for (const n of [1, 3, 4]) {
        d.subVectors(joints[n + 1], joints[n]).normalize();
        for (let k = 0; k < 3; k++) {
          const at = (k + 1) / 4;
          s3.b.lerpVectors(joints[n], joints[n + 1], at);
          s3.a.copy(d).multiplyScalar(0.6).addScaledVector(up, 0.55).addScaledVector(across, (k % 2 ? 0.45 : -0.45));
          spike(s3.b, s3.a, r * taper[n] * (golden ? 2.6 : 3.4), r * taper[n] * 0.16);
        }
      }
      d.subVectors(joints[6], joints[5]).normalize();
      spike(joints[6], s3.a.copy(d).addScaledVector(up, -0.9), r * 0.9, r * 0.22);
    });

    // The palps: short leg-like feelers either side of the fangs, tapping as she feels about, tucked when she runs.
    const feel = s.speed < 0.05 ? 1 : 0.2;
    for (const side of [-1, 1]) {
      const tap = Math.max(0, Math.sin(s.time * 7 + side * 1.4)) * feel;
      joints[0].set(side * body * 0.08, body * 0.4, body * 0.08).applyMatrix4(basis);
      joints[1].set(side * body * 0.13, body * 0.55, body * (0.16 - tap * 0.03)).applyMatrix4(basis);
      joints[2].set(side * body * 0.12, body * (0.68 + tap * 0.02), body * (0.02 - tap * 0.1)).applyMatrix4(basis);
      joints[3].set(side * body * 0.1, body * 0.74, body * (-0.04 - tap * 0.08)).applyMatrix4(basis);
      const r = body * 0.045;
      bone(joints[0], joints[1], r, false);
      bone(joints[1], joints[2], r * 0.9, true);
      bone(joints[2], joints[3], r * 1.1, true);
    }
    s.started = true;
  };

  return (
    <>
      <primitive object={parts.group} />
      <primitive object={parts.segments} />
      <primitive object={parts.joints} />
      <primitive object={parts.spines} />
    </>
  );
}
