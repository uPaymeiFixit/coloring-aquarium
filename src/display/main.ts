// Tank display: draws the reef and every drawing sent from a station as a swimming animal, live from the server.
// World units: the tank is 1000 units tall and as wide as the screen's aspect ratio allows; y runs down.
import { compile, presetImage } from "../coloring.ts";
import { SPECIES, speciesById, type Species } from "../species.ts";
import { createProgram, gridMesh, screenTriangle, uploadTexture, type Mesh } from "./gl.ts";
import { paintReef, type Blade } from "./reef.ts";
import * as glsl from "./shaders.ts";

interface Fish {
  id: string;
  species: string;
  url: string;
  createdAt: number;
}

type Message = { type: "snapshot"; fish: Fish[] } | { type: "add"; fish: Fish } | { type: "remove"; id: string };

const params = new URLSearchParams(location.search);
/** Starter animals keep the tank lively until this many drawings have arrived. */
const STARTERS = Number(params.get("starters") ?? 8);
const STARTER_PLAN = ["parrotfish", "jellyfish", "school", "angelfish", "turtle", "parrotfish", "shark", "jellyfish"];
/** How long a new arrival glows so its owner can spot it. */
const GLOW_SECONDS = 14;
const TEXTURE_SIDE = 800;
const H = 1000;
const MAX_BUBBLES = 400;
const FOG_COLOR = [0.1, 0.45, 0.66];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const canvas = document.getElementById("tank") as HTMLCanvasElement;
const context = canvas.getContext("webgl2", { alpha: false, antialias: true, premultipliedAlpha: true });
if (!context) {
  document.body.textContent = "This browser can't draw the tank: it needs WebGL 2.";
  throw new Error("WebGL 2 is not available");
}
const gl: WebGL2RenderingContext = context;

const water = createProgram(gl, glsl.screenVertex, glsl.waterFragment);
const reefProgram = createProgram(gl, glsl.screenVertex, glsl.reefFragment);
const vignette = createProgram(gl, glsl.screenVertex, glsl.vignetteFragment);
const animalProgram = createProgram(gl, glsl.animalVertex, glsl.animalFragment);
const plantProgram = createProgram(gl, glsl.plantVertex, glsl.plantFragment);
const bubbleProgram = createProgram(gl, glsl.bubbleVertex, glsl.bubbleFragment);
const haloProgram = createProgram(gl, glsl.haloVertex, glsl.haloFragment);
const screen = screenTriangle(gl);

// A unit quad for halos, and the same quad plus per-bubble data for instanced bubbles.
const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const haloVao = gl.createVertexArray()!;
gl.bindVertexArray(haloVao);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const bubbleData = new Float32Array(MAX_BUBBLES * 4);
const bubbleBuffer = gl.createBuffer();
const bubbleVao = gl.createVertexArray()!;
gl.bindVertexArray(bubbleVao);
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, bubbleBuffer);
gl.bufferData(gl.ARRAY_BUFFER, bubbleData.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);

// Per-species motion, packed the way the animal shader reads it.
interface RigUniforms {
  rig: number;
  params: Float32Array;
  jointA: Float32Array;
  jointB: Float32Array;
  mesh: Mesh;
}

const meshes = { swim: gridMesh(gl, 32, 8), paddle: gridMesh(gl, 40, 26), pulse: gridMesh(gl, 14, 36) };

function rigUniforms(s: Species): RigUniforms {
  const jointA = new Float32Array(12);
  const jointB = new Float32Array(12);
  const r = s.rig;
  if (r.kind === "swim") {
    return { rig: 0, params: new Float32Array([r.amplitude, r.waves, r.sweep, r.rigid]), jointA, jointB, mesh: meshes.swim };
  }
  if (r.kind === "pulse") {
    return { rig: 2, params: new Float32Array([r.bellEnd, r.squeeze, r.sway, 0]), jointA, jointB, mesh: meshes.pulse };
  }
  r.joints.slice(0, 3).forEach((j, i) => {
    jointA.set([j.pivot[0] / s.width, j.pivot[1] / s.height, j.tip[0] / s.width, j.tip[1] / s.height], i * 4);
    jointB.set([j.halfWidth / s.width, j.amplitude, j.phase, j.rate], i * 4);
  });
  return { rig: 1, params: new Float32Array(4), jointA, jointB, mesh: meshes.paddle };
}

const rigs = new Map(SPECIES.map((s) => [s.id, rigUniforms(s)]));

// Animals

/** A drawing's texture, shared by every animal made from it (a school has several). */
class Look {
  refs = 0;
  constructor(readonly texture: WebGLTexture) {}
  release() {
    if (--this.refs <= 0) gl.deleteTexture(this.texture);
  }
}

type Mode = "arrive" | "swim" | "leave";

/** Anything that steers toward a target: an animal, or the invisible point a school follows. */
class Mover {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  tx = 0;
  ty = 0;
  retargetAt = 0;
  side = 1;
  mode: Mode = "swim";
}

class Animal extends Mover {
  facing = 1;
  facingGoal = 1;
  angle = 0;
  depth = Math.random();
  depthGoal = this.depth;
  anim = Math.random() * 100;
  pace = 0.85 + Math.random() * 0.3;
  size = 0.9 + Math.random() * 0.2;
  wobble = Math.random() * 100;
  glow = 0;
  trail = 0;
  slot = { x: 0, y: 0 };
  gone = false;

  constructor(
    readonly entry: Entry,
    readonly look: Look,
  ) {
    super();
  }

  get species() {
    return this.entry.species;
  }
}

/** One drawing (or starter) in the tank: one animal, or a whole school. */
interface Entry {
  id: string;
  species: Species;
  starter: boolean;
  created: number;
  animals: Animal[];
  pilot: Mover | null;
  leaving: boolean;
  loaded: boolean;
}

const entries = new Map<string, Entry>();
let animals: Animal[] = [];
let W = H * (innerWidth / innerHeight);
let clock = 0;

function pickTarget(m: Mover, s: Species) {
  const margin = Math.min(W * 0.3, s.length * 0.6 + 30);
  let tx = rand(margin, W - margin);
  if (Math.abs(tx - m.x) < W * 0.3) tx = m.x < W / 2 ? rand(W * 0.62, W - margin) : rand(margin, W * 0.38);
  m.tx = tx;
  m.ty = clamp(m.y + rand(-0.2, 0.2) * H, s.band[0] * H, s.band[1] * H);
  m.retargetAt = clock + rand(7, 16);
}

function spawn(entry: Entry, look: Look, how: "arrive" | "place" | "enter") {
  const s = entry.species;
  const top = s.band[0] * H, bottom = s.band[1] * H;
  let x: number, y: number, vx = 0, vy = 0;
  if (how === "arrive") {
    x = rand(0.2, 0.8) * W;
    y = -(s.length * s.height) / s.width / 2 - 30;
    vy = 170;
  } else if (how === "enter") {
    const fromLeft = Math.random() < 0.5;
    x = fromLeft ? -s.length : W + s.length;
    y = rand(top, bottom);
    vx = (fromLeft ? 1 : -1) * s.speed;
  } else {
    x = rand(0.1, 0.9) * W;
    y = rand(top, bottom);
    vx = (Math.random() < 0.5 ? -1 : 1) * s.speed * 0.6;
  }
  const settle = rand(top, (top + bottom) / 2);

  if (s.school > 1) {
    const pilot = new Mover();
    Object.assign(pilot, { x, y, vx, vy, side: vx < 0 ? -1 : 1 });
    if (how === "arrive") Object.assign(pilot, { mode: "arrive", tx: x, ty: settle });
    else pickTarget(pilot, s);
    entry.pilot = pilot;
  }
  for (let k = 0; k < s.school; k++) {
    const a = new Animal(entry, look);
    look.refs++;
    if (entry.pilot) a.slot = { x: rand(-1, 1) * 95, y: rand(-1, 1) * 55 };
    Object.assign(a, { x: x + a.slot.x, y: y + a.slot.y, vx, vy });
    a.facing = a.facingGoal = vx < 0 ? -1 : 1;
    if (how === "arrive") {
      Object.assign(a, { mode: "arrive", glow: GLOW_SECONDS, depth: 0, depthGoal: rand(0, 0.6), trail: 1.4, tx: x, ty: settle });
      a.y -= k * 14;
    } else {
      pickTarget(a, s);
    }
    entry.animals.push(a);
    animals.push(a);
  }
  if (how === "arrive") burst(x, 4, 30);
}

function leave(entry: Entry) {
  if (entry.leaving) return;
  entry.leaving = true;
  if (!entry.loaded) {
    entries.delete(entry.id);
    return;
  }
  const lead = entry.pilot ?? entry.animals[0];
  const exit = (lead?.x ?? 0) < W / 2 ? -entry.species.length * 2 : W + entry.species.length * 2;
  for (const m of entry.pilot ? [entry.pilot, ...entry.animals] : entry.animals) Object.assign(m, { mode: "leave", tx: exit, ty: m.y });
  for (const a of entry.animals) a.glow = Math.min(a.glow, 1);
}

/** Fish, sharks and turtles: swim toward a target, mostly sideways, and stay in their depth band. */
function steer(m: Mover, s: Species, dt: number) {
  if (m.mode === "arrive" && m.y >= m.ty - 25) {
    m.mode = "swim";
    pickTarget(m, s);
  }
  if (m.mode === "swim" && (clock > m.retargetAt || Math.hypot(m.tx - m.x, m.ty - m.y) < 40)) pickTarget(m, s);
  const pace = m instanceof Animal ? m.pace * (0.85 + 0.15 * Math.sin(clock * 0.4 + m.wobble)) : 1;
  const boost = m.mode === "leave" ? 1.7 : m.mode === "arrive" ? 1.6 : 1;
  const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy) || 1;
  const want = Math.min(s.speed * pace * boost, d * 1.2 + 10);
  const k = 1 - Math.exp(-dt * (s.rig.kind === "paddle" ? 0.9 : 1.5));
  m.vx += ((dx / d) * want - m.vx) * k;
  m.vy += ((dy / d) * want * (m.mode === "swim" ? 0.55 : 1) - m.vy) * k;
  if (m.mode === "swim") {
    if (m.y < s.band[0] * H) m.vy += (s.band[0] * H - m.y) * 2 * dt;
    if (m.y > s.band[1] * H) m.vy -= (m.y - s.band[1] * H) * 2 * dt;
  }
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  if (m.vx > 8) m.side = 1;
  else if (m.vx < -8) m.side = -1;
  if (m instanceof Animal) m.anim += dt * s.rig.beat * (0.45 + 0.75 * Math.min(1.6, Math.hypot(m.vx, m.vy) / s.speed));
}

/** A fish in a school: keep its place around the school's pilot point, without bumping its neighbors. */
function follow(a: Animal, dt: number) {
  const p = a.entry.pilot!;
  const s = a.species;
  let wx = p.vx + (p.x + a.slot.x * p.side - a.x) * 1.4;
  let wy = p.vy + (p.y + a.slot.y - a.y) * 1.4;
  for (const o of a.entry.animals) {
    if (o === a) continue;
    const dx = a.x - o.x, dy = a.y - o.y, d2 = dx * dx + dy * dy;
    if (d2 > 0.01 && d2 < 1600) {
      const d = Math.sqrt(d2);
      wx += (dx / d) * (40 - d) * 1.5;
      wy += (dy / d) * (40 - d) * 1.5;
    }
  }
  const max = s.speed * 2.2, v = Math.hypot(wx, wy);
  if (v > max) {
    wx *= max / v;
    wy *= max / v;
  }
  const k = 1 - Math.exp(-dt * 2.5);
  a.vx += (wx - a.vx) * k;
  a.vy += (wy - a.vy) * k;
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.anim += dt * s.rig.beat * (0.5 + 0.6 * Math.min(1.8, Math.hypot(a.vx, a.vy) / s.speed));
  if (clock > a.retargetAt) {
    a.slot = { x: rand(-1, 1) * 95, y: rand(-1, 1) * 55 };
    a.retargetAt = clock + rand(5, 12);
  }
}

/** Jellyfish: each squeeze of the bell pushes up, and between squeezes it sinks and drifts sideways. */
function drift(a: Animal, dt: number) {
  const s = a.species;
  a.anim += dt * s.rig.beat * a.pace;
  const push = Math.max(0, Math.cos(a.anim)) * (0.5 + 0.5 * Math.sin(a.anim));
  let thrust = 95 * push;
  if (a.mode === "arrive") {
    thrust = 0;
    if (a.y >= a.ty) {
      a.mode = "swim";
      pickTarget(a, s);
    }
  } else if (a.y < s.band[0] * H) thrust *= 0.1;
  else if (a.y > s.band[1] * H) thrust *= 1.8;
  a.vy += (16 - thrust) * dt;
  a.vy *= Math.exp(-dt * (a.mode === "arrive" ? 0.5 : 1.1));
  if (a.mode === "swim" && clock > a.retargetAt) pickTarget(a, s);
  const reach = a.mode === "leave" ? s.speed * 2.4 : s.speed * 0.5;
  a.vx += (clamp((a.tx - a.x) * 0.15, -reach, reach) - a.vx) * (1 - Math.exp(-dt * 0.6));
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.angle = clamp(a.vx * 0.005, -0.25, 0.25);
}

/** Turn to face the way it swims (squeezing through edge-on) and tilt with its climb. */
function face(a: Animal, dt: number) {
  if (a.vx > 6) a.facingGoal = 1;
  else if (a.vx < -6) a.facingGoal = -1;
  const step = dt * 3.4;
  a.facing += clamp(a.facingGoal - a.facing, -step, step);
  const sign = a.facing >= 0 ? 1 : -1;
  const pitch = clamp(Math.atan2(a.vy, Math.abs(a.vx) + 30), -0.5, 0.5) * sign * (a.species.rig.kind === "paddle" ? 0.6 : 1);
  a.angle += (pitch - a.angle) * (1 - Math.exp(-dt * 4));
}

function update(dt: number) {
  for (const e of entries.values()) if (e.pilot) steer(e.pilot, e.species, dt);
  for (const a of animals) {
    const s = a.species;
    if (s.rig.kind === "pulse") drift(a, dt);
    else if (a.entry.pilot) follow(a, dt);
    else steer(a, s, dt);
    if (s.rig.kind !== "pulse") face(a, dt);
    a.glow = Math.max(0, a.glow - dt);
    a.depth += ((a.glow > 0 ? 0 : a.depthGoal) - a.depth) * (1 - Math.exp(-dt * 0.5));
    if (a.trail > 0) {
      a.trail -= dt;
      if (Math.random() < dt * 14) bubble(a.x + rand(-12, 12), a.y - 12, rand(3, 7));
    }
    const margin = s.length * 1.2;
    if (a.mode === "leave" && (a.x < -margin || a.x > W + margin)) a.gone = true;
  }
  if (animals.some((a) => a.gone)) {
    for (const a of animals) if (a.gone) a.look.release();
    animals = animals.filter((a) => !a.gone);
    for (const [id, e] of entries) {
      e.animals = e.animals.filter((a) => !a.gone);
      if (e.leaving && !e.animals.length) entries.delete(id);
    }
  }
  updateBubbles(dt);
}

// Bubbles

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  drift: number;
  phase: number;
  alpha: number;
}

let bubbles: Bubble[] = [];
let vents: { x: number; y: number; next: number }[] = [];

function bubble(x: number, y: number, r: number) {
  if (bubbles.length >= MAX_BUBBLES) return;
  bubbles.push({ x, y, r, vy: -(35 + r * 6) * rand(0.8, 1.2), drift: rand(5, 14), phase: rand(0, 6.28), alpha: rand(0.55, 0.95) });
}

function burst(x: number, y: number, count: number) {
  for (let i = 0; i < count; i++) bubble(x + rand(-40, 40), y + rand(0, 90), rand(3, 10));
}

function updateBubbles(dt: number) {
  for (const v of vents) {
    if (clock < v.next) continue;
    for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) bubble(v.x + rand(-6, 6), v.y - rand(0, 10), rand(2.5, 7));
    v.next = clock + (Math.random() < 0.2 ? rand(2, 5) : rand(0.15, 0.6));
  }
  for (const b of bubbles) {
    b.y += b.vy * dt;
    b.x += Math.sin(clock * 2.2 + b.phase) * b.drift * dt;
  }
  bubbles = bubbles.filter((b) => b.y > -20);
}

// Reef and seagrass

interface Plants {
  vao: WebGLVertexArrayObject;
  count: number;
  buffers: WebGLBuffer[];
}

let reefTexture: WebGLTexture | null = null;
let backPlants: Plants | null = null;
let frontPlants: Plants | null = null;

function plantMesh(blades: Blade[]): Plants {
  const segments = 8;
  const data: number[] = [];
  const index: number[] = [];
  blades.forEach((b, n) => {
    for (let s = 0; s <= segments; s++) {
      for (const side of [-1, 1]) data.push(b.x, b.y, s / segments, side, b.height, b.width, ...b.color, b.phase);
    }
    const first = n * (segments + 1) * 2;
    for (let s = 0; s < segments; s++) {
      const a = first + s * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const vao = gl.createVertexArray()!;
  const vertices = gl.createBuffer()!;
  const indices = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  for (const [location, size, offset] of [[0, 2, 0], [1, 4, 8], [2, 4, 24]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: index.length, buffers: [vertices, indices] };
}

function freePlants(p: Plants | null) {
  if (!p) return;
  gl.deleteVertexArray(p.vao);
  for (const b of p.buffers) gl.deleteBuffer(b);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  W = H * (canvas.clientWidth / canvas.clientHeight);
  const reefWidth = Math.min(canvas.width, 2048);
  const reef = paintReef(reefWidth, Math.round((reefWidth * H) / W), W, H);
  if (reefTexture) gl.deleteTexture(reefTexture);
  reefTexture = uploadTexture(gl, reef.canvas, false);
  freePlants(backPlants);
  freePlants(frontPlants);
  backPlants = plantMesh(reef.blades.filter((b) => !b.front));
  frontPlants = plantMesh(reef.blades.filter((b) => b.front));
  vents = reef.vents.map((v) => ({ ...v, next: 0 }));
  for (const m of [...animals, ...[...entries.values()].flatMap((e) => (e.pilot ? [e.pilot] : []))]) {
    if (m.mode === "swim" && (m.x > W || m.tx > W)) {
      m.x = Math.min(m.x, W - 40);
      m.retargetAt = 0;
    }
  }
}

// Drawing

function drawScreen(program: ReturnType<typeof createProgram>) {
  gl.useProgram(program.program);
  gl.uniform1f(program.uniform("uClock"), clock);
  gl.uniform2f(program.uniform("uWorld"), W, H);
  gl.bindVertexArray(screen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drawPlants(p: Plants | null) {
  if (!p || !p.count) return;
  gl.useProgram(plantProgram.program);
  gl.uniform1f(plantProgram.uniform("uClock"), clock);
  gl.uniform2f(plantProgram.uniform("uWorld"), W, H);
  gl.bindVertexArray(p.vao);
  gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_SHORT, 0);
}

function drawHalos() {
  const u = haloProgram.uniform;
  let ready = false;
  for (const e of entries.values()) {
    const glow = Math.max(0, ...e.animals.map((a) => a.glow));
    if (glow <= 0) continue;
    if (!ready) {
      gl.useProgram(haloProgram.program);
      gl.uniform2f(u("uWorld"), W, H);
      gl.uniform1f(u("uClock"), clock);
      gl.bindVertexArray(haloVao);
      ready = true;
    }
    const center = e.pilot ?? e.animals[0];
    const strength = Math.min(1, glow / 3) * Math.min(1, (GLOW_SECONDS - glow) / 0.6);
    gl.uniform2f(u("uCenter"), center.x, center.y);
    gl.uniform1f(u("uRadius"), e.species.length * (e.species.school > 1 ? 2.2 : 0.95));
    gl.uniform1f(u("uStrength"), strength);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function drawAnimals() {
  const u = animalProgram.uniform;
  gl.useProgram(animalProgram.program);
  gl.uniform2f(u("uWorld"), W, H);
  gl.uniform1f(u("uClock"), clock);
  gl.uniform3fv(u("uFogColor"), FOG_COLOR);
  gl.uniform1i(u("uTex"), 0);
  gl.activeTexture(gl.TEXTURE0);
  for (const a of animals.slice().sort((p, q) => q.depth - p.depth)) {
    const s = a.species;
    const rig = rigs.get(s.id)!;
    gl.bindVertexArray(rig.mesh.vao);
    gl.bindTexture(gl.TEXTURE_2D, a.look.texture);
    gl.uniform2f(u("uPos"), a.x, a.y);
    gl.uniform2f(u("uSize"), s.length, (s.length * s.height) / s.width);
    gl.uniform1f(u("uFacing"), Math.sin((a.facing * Math.PI) / 2));
    gl.uniform1f(u("uAngle"), a.angle);
    gl.uniform1f(u("uScale"), (1 - 0.38 * a.depth) * a.size);
    gl.uniform1f(u("uTime"), a.anim);
    gl.uniform1i(u("uRig"), rig.rig);
    gl.uniform4fv(u("uParams"), rig.params);
    gl.uniform4fv(u("uJointA"), rig.jointA);
    gl.uniform4fv(u("uJointB"), rig.jointB);
    gl.uniform1f(u("uFog"), a.depth * 0.45);
    gl.uniform1f(u("uBright"), (0.8 + 0.2 * Math.abs(a.facing)) * (1 + 0.15 * Math.min(1, a.glow / 2)));
    gl.drawElements(gl.TRIANGLES, rig.mesh.count, gl.UNSIGNED_SHORT, 0);
  }
}

function drawBubbles() {
  const n = Math.min(bubbles.length, MAX_BUBBLES);
  if (!n) return;
  bubbles.slice(0, n).forEach((b, i) => bubbleData.set([b.x, b.y, b.r, b.alpha * clamp(b.y / 60, 0, 1)], i * 4));
  gl.bindBuffer(gl.ARRAY_BUFFER, bubbleBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, bubbleData, 0, n * 4);
  gl.useProgram(bubbleProgram.program);
  gl.uniform2f(bubbleProgram.uniform("uWorld"), W, H);
  gl.bindVertexArray(bubbleVao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
}

function draw() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  drawScreen(water);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (reefTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, reefTexture);
    gl.useProgram(reefProgram.program);
    gl.uniform1i(reefProgram.uniform("uReef"), 0);
    drawScreen(reefProgram);
  }
  drawPlants(backPlants);
  drawHalos();
  drawAnimals();
  drawBubbles();
  drawPlants(frontPlants);
  drawScreen(vignette);
}

let last = performance.now();
function frame(now: number) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  clock += dt;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

// Drawings from the server, and starter animals while there are few

const starterCounts = new Map<string, number>();
let starterSerial = 0;

function addStarter(how: "place" | "enter") {
  const s = speciesById(STARTER_PLAN[starterSerial++ % STARTER_PLAN.length])!;
  const seen = starterCounts.get(s.id) ?? 0;
  starterCounts.set(s.id, seen + 1);
  const image = presetImage(compile(s), s.presets[seen % s.presets.length], TEXTURE_SIDE);
  const entry: Entry = { id: `starter-${starterSerial}`, species: s, starter: true, created: performance.now(), animals: [], pilot: null, leaving: false, loaded: true };
  entries.set(entry.id, entry);
  spawn(entry, new Look(uploadTexture(gl, image, true)), how);
}

/** Starters leave as drawings arrive, oldest first, and come back if the tank empties. */
function balanceStarters(how: "place" | "enter") {
  const present = [...entries.values()].filter((e) => !e.leaving);
  const drawings = present.filter((e) => !e.starter).length;
  const starters = present.filter((e) => e.starter).sort((p, q) => p.created - q.created);
  const want = Math.max(0, STARTERS - drawings);
  starters.slice(0, Math.max(0, starters.length - want)).forEach(leave);
  for (let k = starters.length; k < want; k++) addStarter(how);
}

async function addDrawing(f: Fish, how: "arrive" | "place") {
  const s = speciesById(f.species);
  if (!s || entries.has(f.id)) return;
  const entry: Entry = { id: f.id, species: s, starter: false, created: f.createdAt, animals: [], pilot: null, leaving: false, loaded: false };
  entries.set(f.id, entry);
  try {
    const image = new Image();
    image.src = f.url;
    await image.decode();
    if (entry.leaving) return;
    entry.loaded = true;
    spawn(entry, new Look(uploadTexture(gl, image, true)), how);
  } catch (err) {
    console.warn(`Could not load ${f.url}`, err);
    entries.delete(f.id);
  }
}

let snapshotSeen = false;

function reconcile(list: Fish[]) {
  const ids = new Set(list.map((f) => f.id));
  for (const e of [...entries.values()]) if (!e.starter && !ids.has(e.id)) leave(e);
  // On the first load drawings are already in the tank; after a reconnect, any new ones arrive.
  for (const f of list) addDrawing(f, snapshotSeen ? "arrive" : "place");
  balanceStarters(snapshotSeen ? "enter" : "place");
  snapshotSeen = true;
}

const statusLine = document.getElementById("status")!;
function setStatus(text: string | null) {
  statusLine.hidden = !text;
  statusLine.textContent = text ?? "";
}

function connect() {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.onopen = () => setStatus(null);
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as Message;
    if (message.type === "snapshot") {
      reconcile(message.fish);
    } else if (message.type === "add") {
      addDrawing(message.fish, "arrive");
      balanceStarters("enter");
    } else {
      const e = entries.get(message.id);
      if (e) leave(e);
      balanceStarters("enter");
    }
  };
  socket.onclose = () => {
    setStatus("Lost the server; reconnecting…");
    setTimeout(connect, 2000);
  };
}

// Page behavior: full screen on click, hide the cursor, show where the station is.

const hint = document.getElementById("hint")!;
document.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener("fullscreenchange", () => hint.classList.add("gone"));
setTimeout(() => hint.classList.add("gone"), 6000);

let idleTimer = 0;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add("idle"), 3000);
});

if (params.get("label") !== "0") {
  fetch("/api/info")
    .then((r) => r.json() as Promise<{ station: string[] }>)
    .then((info) => {
      const label = document.getElementById("label")!;
      label.textContent = `Color a sea animal at ${info.station[0]}`;
      label.hidden = false;
    })
    .catch(() => {});
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resize, 200);
});
canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
canvas.addEventListener("webglcontextrestored", () => location.reload());

resize();
connect();
// If the server is slow to answer, don't leave the tank empty.
setTimeout(() => {
  if (!snapshotSeen) balanceStarters("place");
}, 1500);
requestAnimationFrame(frame);
