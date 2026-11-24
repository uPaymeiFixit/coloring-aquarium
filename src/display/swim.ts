// How the tank's animals move in 3D: each one keeps choosing to cross the tank, linger around a spot (by a side,
// down on the sand, or back by the reef), or dart off, at its own pace. Schools follow an invisible pilot and
// jellyfish drift. Tank coordinates: x across, y down from the surface, z back from the front glass.
// Nothing here draws, so the motion can be simulated outside the browser.
import type { Species } from "../species.ts";

export interface World {
  /** Width of the view at the front glass; it widens further back. */
  width: number;
  /** The surface is at y = 0 and the sand at y = height. */
  height: number;
  /** The front glass is at z = 0 and the back wall at z = depth. */
  depth: number;
  /** How far in front of the glass the camera sits, which sets how fast the view widens with depth. */
  camera: number;
  /** Seconds since the tank started. */
  clock: number;
}

export type Mode = "arrive" | "swim" | "leave";

/** What a swimming animal is doing: crossing the tank, hanging around one spot, or a quick burst. */
export type Plan = "cruise" | "linger" | "dart";

/** Speed for each plan, as a multiple of the animal's own speed. */
const GAIT: Record<Plan, number> = { cruise: 1, linger: 0.35, dart: 2.2 };
/** Closest an animal's center comes to the front glass, and to the back wall. */
const NEAR = 60;
const BACK_GAP = 140;
/** A flat drawing seen edge-on disappears, so outside of turning around it stays within this angle of side-on. */
const MAX_YAW = 0.95;
/** How fast an animal turns, in radians a second. */
const TURN = 2.8;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * A random point between a and b, more often near the ends. Moving back and forth between plain random points
 * spends most of the time in the middle; this cancels that out.
 */
const spread = (a: number, b: number) => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * Math.random()));

/** An animal, or the invisible point a school follows. */
export class Swimmer {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  tx = 0;
  ty = 0;
  tz = 0;
  /** Which way it is heading across the tank, with some slack so slow movement doesn't flip it back and forth. */
  side = 1;
  mode: Mode = "swim";
  plan: Plan = "cruise";
  planUntil = 0;
  /** When a lingering animal makes its next small move, or a schoolmate changes its place in the school. */
  hopAt = 0;
  /** The spot a lingering animal hangs around. */
  spot = { x: 0, y: 0, z: 0 };
  /** Its place around a school's pilot. */
  slot = { x: 0, y: 0, z: 0 };
  /** Its own speed, as a multiple of its species' speed. */
  pace = rand(0.6, 1.45);
  /** How likely it is to cross the tank rather than linger. */
  restless = rand(0.25, 0.85);
  wobble = Math.random() * 100;
  /** Heading around the vertical axis: 0 faces right, π/2 faces into the tank, π faces left. */
  yaw = 0;
  yawGoal = 0;
  /** Nose-up tilt; for a jellyfish, its lean. */
  pitch = 0;
  anim = Math.random() * 100;
}

/** How close to the front glass and the back wall an animal's center may go. */
export function depthRange(world: World) {
  return { near: NEAR, far: world.depth - BACK_GAP };
}

/** Where an animal's center may go at depth z: across the view there, which is wider further back, and within its depth band. */
export function bounds(s: Species, world: World, z: number) {
  const half = ((world.width / 2) * (world.camera + z)) / world.camera;
  const inset = Math.min(s.length * 0.3, half * 0.5);
  return {
    left: world.width / 2 - half + inset,
    right: world.width / 2 + half - inset,
    top: s.band[0] * world.height,
    bottom: s.band[1] * world.height,
  };
}

/** Chooses what a swimming animal does next. */
export function nextPlan(m: Swimmer, s: Species, world: World) {
  const { near, far } = depthRange(world);
  const roll = Math.random();
  if (roll < 0.12) {
    m.plan = "dart";
    m.tz = clamp(m.z + rand(-220, 220), near, far);
    const b = bounds(s, world, m.tz);
    m.tx = clamp(m.x + (Math.random() < 0.75 ? m.side : -m.side) * rand(150, 320), b.left, b.right);
    m.ty = clamp(m.y + rand(-90, 90), b.top, b.bottom);
    m.planUntil = world.clock + rand(1, 1.8);
  } else if (roll < 0.12 + 0.88 * m.restless) {
    // Cross to the other side, often right up to the edge of the view, at a new depth.
    m.plan = "cruise";
    m.tz = spread(near, far);
    const b = bounds(s, world, m.tz);
    const span = b.right - b.left;
    m.tx = m.x < world.width / 2 ? rand(b.left + span * 0.72, b.right) : rand(b.left, b.left + span * 0.28);
    m.ty = spread(b.top, b.bottom);
    m.planUntil = world.clock + 60;
  } else {
    // Hang around a spot: by the nearer side, down on the sand, back by the reef, or right where it is.
    m.plan = "linger";
    const where = Math.random();
    const z = where >= 0.55 && where < 0.75 ? rand(far - 220, far) : m.z;
    const b = bounds(s, world, z);
    const span = b.right - b.left;
    let x = m.x, y = m.y;
    if (where < 0.3) x = m.x < world.width / 2 ? rand(b.left, b.left + span * 0.12) : rand(b.right - span * 0.12, b.right);
    else if (where < 0.55) y = rand(b.bottom - 0.15 * world.height, b.bottom);
    else if (where < 0.75) y = rand((b.top + b.bottom) / 2, b.bottom);
    m.spot = { x: clamp(x, b.left, b.right), y: clamp(y, b.top, b.bottom), z };
    m.planUntil = world.clock + rand(8, 25);
    hop(m, s, world);
  }
}

/** A lingering animal's next small, slow move around its spot, usually the way it already heads. */
function hop(m: Swimmer, s: Species, world: World) {
  const { near, far } = depthRange(world);
  m.tz = clamp(m.spot.z + rand(-60, 60), near, far);
  const b = bounds(s, world, m.tz);
  m.tx = clamp(m.spot.x + m.side * rand(-50, 110), b.left, b.right);
  m.ty = clamp(m.spot.y + rand(-40, 40), b.top, b.bottom);
  m.hopAt = world.clock + rand(2, 5);
}

/** Fish, sharks, turtles and school pilots: follow the current plan and stay inside the water. */
export function steer(m: Swimmer, s: Species, world: World, dt: number) {
  if (m.mode === "arrive" && m.y >= m.ty - 25) {
    m.mode = "swim";
    nextPlan(m, s, world);
  }
  if (m.mode === "swim") {
    const near = Math.hypot(m.tx - m.x, m.ty - m.y, m.tz - m.z) < (m.plan === "linger" ? 20 : 60);
    if (world.clock > m.planUntil || (near && m.plan !== "linger")) nextPlan(m, s, world);
    else if (m.plan === "linger" && (near || world.clock > m.hopAt)) hop(m, s, world);
  }
  const gait = m.mode === "leave" ? 1.7 : m.mode === "arrive" ? 1.6 : GAIT[m.plan];
  const speed = s.speed * m.pace * gait * (0.85 + 0.15 * Math.sin(world.clock * 0.4 + m.wobble));
  const dx = m.tx - m.x, dy = m.ty - m.y, dz = m.tz - m.z, d = Math.hypot(dx, dy, dz) || 1;
  const want = Math.min(speed, d * 1.5 + 8);
  const agility = m.mode === "swim" && m.plan === "dart" ? 3 : s.rig.kind === "paddle" ? 0.9 : 1.5;
  const k = 1 - Math.exp(-dt * agility);
  // Crossing fish keep mostly level; lingering and darting ones move up and down freely.
  const level = m.mode === "swim" && m.plan === "cruise" ? 0.55 : 1;
  m.vx += ((dx / d) * want - m.vx) * k;
  m.vy += ((dy / d) * want * level - m.vy) * k;
  m.vz += ((dz / d) * want - m.vz) * k;
  if (m.mode === "swim") {
    const top = s.band[0] * world.height, bottom = s.band[1] * world.height;
    if (m.y < top) m.vy += (top - m.y) * 2 * dt;
    if (m.y > bottom) m.vy -= (m.y - bottom) * 2 * dt;
    const { near, far } = depthRange(world);
    if (m.z < near) m.vz += (near - m.z) * 2 * dt;
    if (m.z > far) m.vz -= (m.z - far) * 2 * dt;
  }
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
  if (m.vx > 8) m.side = 1;
  else if (m.vx < -8) m.side = -1;
  m.anim += dt * s.rig.beat * (0.45 + 0.75 * Math.min(1.6, Math.hypot(m.vx, m.vy, m.vz) / s.speed));
}

/** A fish in a school: keep its place around the school's pilot without bumping its neighbors. */
export function follow(m: Swimmer, pilot: Swimmer, mates: readonly Swimmer[], s: Species, world: World, dt: number) {
  let wx = pilot.vx + (pilot.x + m.slot.x * pilot.side - m.x) * 1.4;
  let wy = pilot.vy + (pilot.y + m.slot.y - m.y) * 1.4;
  let wz = pilot.vz + (pilot.z + m.slot.z - m.z) * 1.4;
  for (const o of mates) {
    if (o === m) continue;
    const dx = m.x - o.x, dy = m.y - o.y, dz = m.z - o.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 0.01 && d2 < 1600) {
      const d = Math.sqrt(d2);
      wx += (dx / d) * (40 - d) * 1.5;
      wy += (dy / d) * (40 - d) * 1.5;
      wz += (dz / d) * (40 - d) * 1.5;
    }
  }
  const max = s.speed * 3, v = Math.hypot(wx, wy, wz);
  if (v > max) {
    wx *= max / v;
    wy *= max / v;
    wz *= max / v;
  }
  const k = 1 - Math.exp(-dt * 2.5);
  m.vx += (wx - m.vx) * k;
  m.vy += (wy - m.vy) * k;
  m.vz += (wz - m.vz) * k;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
  if (m.vx > 8) m.side = 1;
  else if (m.vx < -8) m.side = -1;
  m.anim += dt * s.rig.beat * (0.5 + 0.6 * Math.min(1.8, Math.hypot(m.vx, m.vy, m.vz) / s.speed));
  if (world.clock > m.hopAt) {
    m.slot = { x: rand(-1, 1) * 95, y: rand(-1, 1) * 55, z: rand(-1, 1) * 70 };
    m.hopAt = world.clock + rand(5, 12);
  }
}

/**
 * Jellyfish: each squeeze of the bell pushes up, and between squeezes it sinks and drifts. It pushes harder when
 * below the depth it is heading for and softer when above it.
 */
export function drift(m: Swimmer, s: Species, world: World, dt: number) {
  m.anim += dt * s.rig.beat * m.pace;
  const push = Math.max(0, Math.cos(m.anim)) * (0.5 + 0.5 * Math.sin(m.anim));
  let thrust = 95 * push;
  if (m.mode === "arrive") {
    thrust = 0;
    if (m.y >= m.ty) {
      m.mode = "swim";
      wander(m, s, world);
    }
  } else if (m.y < s.band[0] * world.height) thrust *= 0.1;
  else if (m.y > s.band[1] * world.height) thrust *= 1.8;
  else if (m.mode === "swim") thrust *= clamp(1 + (m.y - m.ty) / 150, 0.3, 1.7);
  m.vy += (16 - thrust) * dt;
  m.vy *= Math.exp(-dt * (m.mode === "arrive" ? 0.5 : 1.1));
  if (m.mode === "swim" && world.clock > m.planUntil) wander(m, s, world);
  const reach = m.mode === "leave" ? s.speed * 2.4 : s.speed * 0.5 * m.pace;
  const ease = 1 - Math.exp(-dt * 0.6);
  m.vx += (clamp((m.tx - m.x) * 0.15, -reach, reach) - m.vx) * ease;
  m.vz += (clamp((m.tz - m.z) * 0.15, -reach, reach) - m.vz) * ease;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
}

/** A jellyfish's next point to drift toward. */
function wander(m: Swimmer, s: Species, world: World) {
  const { near, far } = depthRange(world);
  m.tz = spread(near, far);
  const b = bounds(s, world, m.tz);
  m.tx = spread(b.left, b.right);
  m.ty = spread(b.top, b.bottom);
  m.planUntil = world.clock + rand(8, 20);
}

/**
 * Turn toward the way it swims (through edge-on, as a flat drawing must) and tilt with its climb. Jellyfish
 * always face the viewer and lean with their drift.
 */
export function orient(m: Swimmer, s: Species, dt: number) {
  if (s.rig.kind === "pulse") {
    m.yaw = 0;
    m.pitch = clamp(-m.vx * 0.005, -0.25, 0.25);
    return;
  }
  if (Math.hypot(m.vx, m.vz) > 6) {
    const facing = m.side > 0 ? 0 : Math.PI;
    m.yawGoal = facing + clamp(wrap(Math.atan2(m.vz, m.vx) - facing), -MAX_YAW, MAX_YAW);
  }
  m.yaw = wrap(m.yaw + clamp(wrap(m.yawGoal - m.yaw), -TURN * dt, TURN * dt));
  const pitch = clamp(Math.atan2(-m.vy, Math.hypot(m.vx, m.vz) + 30), -0.5, 0.5) * (s.rig.kind === "paddle" ? 0.6 : 1);
  m.pitch += (pitch - m.pitch) * (1 - Math.exp(-dt * 4));
}
