// Tank display: a 3D aquarium drawn with three.js. Every animal the server lists (children's drawings and the
// pre-colored starters) swims through it as its flat drawing, bending as it swims and turning in three dimensions.
// Tank coordinates (swim.ts, reef.ts): x across, y down from the surface, z back from the front glass.
// three.js coordinates: X across with 0 in the middle, Y up from the sand, Z toward the viewer.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, Mesh, PerspectiveCamera,
  PlaneGeometry, Points, Scene, ShaderMaterial, Texture, Vector2, WebGLRenderer,
} from "three";
import { compile, makeCanvas, presetImage } from "../coloring.ts";
import { enableSound, splash } from "../sounds.ts";
import { SPECIES, speciesById, type Species } from "../species.ts";
import { paintScenery, type Blade } from "./reef.ts";
import * as glsl from "./shaders.ts";
import { Swimmer, bounds, depthRange, drift, follow, nextPlan, orient, steer, type World } from "./swim.ts";

/** One animal in the tank: a child's drawing (`url`), or a starter drawn here from a preset coloring. */
interface Fish {
  id: string;
  species: string;
  createdAt: number;
  url?: string;
  preset?: number;
}

type Message = { type: "snapshot"; fish: Fish[] } | { type: "add"; fish: Fish } | { type: "remove"; id: string };

const params = new URLSearchParams(location.search);
/** How long a new arrival glows so its owner can spot it. */
const GLOW_SECONDS = 14;
/**
 * Longest side of an animal's texture in pixels: plenty for its size on screen, and small enough (about 1 MB of
 * graphics memory each) that hundreds of drawings fit.
 */
const TEXTURE_SIDE = 512;
const MAX_BUBBLES = 400;
/** The water: surface to sand, and front glass to back wall, in world units. */
const H = 1000;
const D = 1000;
const FOV = 40;
/** Camera distance in front of the glass at which the glass exactly fills the screen. */
const CAMERA = H / 2 / Math.tan((FOV * Math.PI) / 360);

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const canvas = document.getElementById("tank") as HTMLCanvasElement;
function createRenderer(): WebGLRenderer {
  try {
    return new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    document.body.textContent = "This browser can't draw the tank: it needs WebGL 2.";
    throw err;
  }
}
const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new Scene();
const camera = new PerspectiveCamera(FOV, 1, 20, CAMERA + D + 4000);

let W = H * (innerWidth / innerHeight);
let clock = 0;
/** The tank's shape and time as the motion code sees them; kept in step with W and clock. */
const world: World = { width: W, height: H, depth: D, camera: CAMERA, clock: 0 };

const toX = (x: number) => x - W / 2;
const toY = (y: number) => H - y;
const toZ = (z: number) => -z;

/** Uniforms every scene material reads, shared by reference so one update reaches all of them. */
const common = {
  uClock: { value: 0 },
  // Water colors at the sand and at the surface, matched to where the back wall sits in the background gradient.
  uFogDeep: { value: [0.07, 0.38, 0.59] },
  uFogTop: { value: [0.29, 0.71, 0.85] },
  uFogRange: { value: [CAMERA - 150, CAMERA + D + 250] },
  uFogMax: { value: 0.6 },
  uTankHeight: { value: H },
};

function texture(source: TexImageSource, anisotropy = 1): Texture {
  const t = new Texture(source);
  t.premultiplyAlpha = true;
  t.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

// Water behind everything and the vignette over everything.

function screenQuad(fragmentShader: string, order: number, transparent: boolean) {
  const material = new ShaderMaterial({
    vertexShader: glsl.screenVertex,
    fragmentShader,
    uniforms: { uClock: common.uClock, uAspect: { value: 1 } },
    depthTest: false,
    depthWrite: false,
    transparent,
    premultipliedAlpha: true,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  scene.add(mesh);
  return material;
}
const water = screenQuad(glsl.waterFragment, -1000, false);
const vignette = screenQuad(glsl.vignetteFragment, 1000, true);

// Scenery: the back wall, the sand, coral clusters and seagrass. Repainted whenever the screen's shape changes.

let scenery: Group | null = null;
let vents: { x: number; z: number; next: number }[] = [];

function sceneryMaterial(map: Texture, light: number) {
  return new ShaderMaterial({
    vertexShader: glsl.sceneryVertex,
    fragmentShader: glsl.sceneryFragment,
    uniforms: { ...common, uMap: { value: map }, uLight: { value: light } },
    transparent: true,
    premultipliedAlpha: true,
  });
}

function plantMesh(blades: Blade[]): Mesh {
  const segments = 8;
  const position: number[] = [], blade: number[] = [], look: number[] = [], index: number[] = [];
  blades.forEach((b, n) => {
    for (let s = 0; s <= segments; s++) {
      for (const side of [-1, 1]) {
        position.push(toX(b.x), 0, toZ(b.z));
        blade.push(s / segments, side, b.height, b.width);
        look.push(...b.color, b.phase);
      }
    }
    const first = n * (segments + 1) * 2;
    for (let s = 0; s < segments; s++) {
      const a = first + s * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute("aBlade", new BufferAttribute(new Float32Array(blade), 4));
  geometry.setAttribute("aLook", new BufferAttribute(new Float32Array(look), 4));
  geometry.setIndex(index);
  const material = new ShaderMaterial({ vertexShader: glsl.plantVertex, fragmentShader: glsl.plantFragment, uniforms: { ...common }, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function disposeScenery() {
  if (!scenery) return;
  scene.remove(scenery);
  scenery.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    const material = o.material as ShaderMaterial;
    (material.uniforms.uMap?.value as Texture | undefined)?.dispose();
    material.dispose();
  });
  scenery = null;
}

function buildScenery() {
  disposeScenery();
  const art = paintScenery({ width: W, height: H, depth: D, camera: CAMERA });
  scenery = new Group();

  const wall = new Mesh(new PlaneGeometry(art.wall.width, art.wall.height), sceneryMaterial(texture(art.wall.canvas), 0.05));
  wall.position.set(0, art.wall.height / 2, toZ(D + 10));
  scenery.add(wall);

  const f = art.floor;
  const floorMaterial = new ShaderMaterial({
    vertexShader: glsl.floorVertex,
    fragmentShader: glsl.floorFragment,
    uniforms: { ...common, uMap: { value: texture(f.canvas, 8) } },
  });
  const floor = new Mesh(new PlaneGeometry(f.right - f.left, f.back - f.front), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(toX((f.left + f.right) / 2), 0, toZ((f.front + f.back) / 2));
  scenery.add(floor);

  for (const c of art.clusters) {
    const mesh = new Mesh(new PlaneGeometry(c.width, c.height), sceneryMaterial(texture(c.canvas, 4), 0.12));
    mesh.position.set(toX(c.x), c.height / 2 - c.sink, toZ(c.z));
    scenery.add(mesh);
  }

  scenery.add(plantMesh(art.blades));
  vents = art.vents.map((v) => ({ ...v, next: 0 }));
  scene.add(scenery);
}

// Animals

/** Per-species motion, packed the way the animal shader reads it. */
interface RigUniforms {
  rig: number;
  params: Float32Array;
  jointA: Float32Array;
  jointB: Float32Array;
  grid: PlaneGeometry;
}

const grids = { swim: new PlaneGeometry(1, 1, 32, 8), paddle: new PlaneGeometry(1, 1, 40, 26), pulse: new PlaneGeometry(1, 1, 14, 36) };

function rigUniforms(s: Species): RigUniforms {
  const jointA = new Float32Array(12);
  const jointB = new Float32Array(12);
  const r = s.rig;
  if (r.kind === "swim") {
    return { rig: 0, params: new Float32Array([r.amplitude, r.waves, r.sweep, r.rigid]), jointA, jointB, grid: grids.swim };
  }
  if (r.kind === "pulse") {
    return { rig: 2, params: new Float32Array([r.bellEnd, r.squeeze, r.sway, 0]), jointA, jointB, grid: grids.pulse };
  }
  r.joints.slice(0, 3).forEach((j, i) => {
    jointA.set([j.pivot[0] / s.width, j.pivot[1] / s.height, j.tip[0] / s.width, j.tip[1] / s.height], i * 4);
    jointB.set([j.halfWidth / s.width, j.amplitude, j.phase, j.rate], i * 4);
  });
  return { rig: 1, params: new Float32Array(4), jointA, jointB, grid: grids.paddle };
}

const rigs = new Map(SPECIES.map((s) => [s.id, rigUniforms(s)]));

/** A drawing's texture, shared by every animal made from it (a school has several). */
class Look {
  refs = 0;
  constructor(readonly texture: Texture) {}
  release() {
    if (--this.refs <= 0) this.texture.dispose();
  }
}

class Animal extends Swimmer {
  size = 0.9 + Math.random() * 0.2;
  glow = 0;
  trail = 0;
  gone = false;
  readonly mesh: Mesh;

  constructor(
    readonly entry: Entry,
    readonly look: Look,
  ) {
    super();
    const s = entry.species;
    const rig = rigs.get(s.id)!;
    look.refs++;
    const material = new ShaderMaterial({
      vertexShader: glsl.animalVertex,
      fragmentShader: glsl.animalFragment,
      uniforms: {
        ...common,
        uMap: { value: look.texture },
        uSize: { value: new Vector2(s.length, (s.length * s.height) / s.width) },
        uTime: { value: 0 },
        uRig: { value: rig.rig },
        uParams: { value: rig.params },
        uJointA: { value: rig.jointA },
        uJointB: { value: rig.jointB },
        uBright: { value: 1 },
      },
      transparent: true,
      premultipliedAlpha: true,
      side: DoubleSide,
    });
    this.mesh = new Mesh(rig.grid, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  get species() {
    return this.entry.species;
  }

  /** Moves the mesh to where the animal is and passes on its swimming time and glow. */
  place() {
    this.mesh.position.set(toX(this.x), toY(this.y), toZ(this.z));
    this.mesh.rotation.set(0, this.yaw, this.pitch);
    this.mesh.scale.setScalar(this.size);
    const u = (this.mesh.material as ShaderMaterial).uniforms;
    u.uTime.value = this.anim;
    u.uBright.value = 1 + 0.15 * Math.min(1, this.glow / 2);
  }

  dispose() {
    scene.remove(this.mesh);
    (this.mesh.material as ShaderMaterial).dispose();
    this.look.release();
  }
}

/** One drawing or starter in the tank: one animal, or a whole school. */
interface Entry {
  id: string;
  species: Species;
  animals: Animal[];
  pilot: Swimmer | null;
  leaving: boolean;
  loaded: boolean;
  halo: Mesh | null;
}

const entries = new Map<string, Entry>();
let animals: Animal[] = [];

function spawn(entry: Entry, look: Look, how: "arrive" | "place" | "enter") {
  const s = entry.species;
  const { near, far } = depthRange(world);
  const top = s.band[0] * H, bottom = s.band[1] * H;
  // New drawings drop in near the front, where they're easy to see.
  const z = how === "arrive" ? rand(near + 20, near + 260) : rand(near, far);
  const b = bounds(s, world, z);
  let x: number, y: number, vx = 0, vy = 0;
  if (how === "arrive") {
    x = rand(b.left + (b.right - b.left) * 0.1, b.right - (b.right - b.left) * 0.1);
    y = -(s.length * s.height) / s.width / 2 - 30;
    vy = 170;
  } else if (how === "enter") {
    const fromLeft = Math.random() < 0.5;
    x = fromLeft ? b.left - s.length : b.right + s.length;
    y = rand(top, bottom);
    vx = (fromLeft ? 1 : -1) * s.speed;
  } else {
    x = rand(b.left, b.right);
    y = rand(top, bottom);
    vx = (Math.random() < 0.5 ? -1 : 1) * s.speed * 0.6;
  }
  const settle = rand(top, (top + bottom) / 2);
  const heading = vx < 0 ? Math.PI : 0;

  if (s.school > 1) {
    const pilot = new Swimmer();
    Object.assign(pilot, { x, y, z, vx, vy, side: vx < 0 ? -1 : 1 });
    if (how === "arrive") Object.assign(pilot, { mode: "arrive", tx: x, ty: settle, tz: z });
    else nextPlan(pilot, s, world);
    entry.pilot = pilot;
  }
  for (let k = 0; k < s.school; k++) {
    const a = new Animal(entry, look);
    if (entry.pilot) a.slot = { x: rand(-1, 1) * 95, y: rand(-1, 1) * 55, z: rand(-1, 1) * 70 };
    Object.assign(a, { x: x + a.slot.x, y: y + a.slot.y, z: z + a.slot.z, vx, vy, side: vx < 0 ? -1 : 1, yaw: heading, yawGoal: heading });
    if (how === "arrive") {
      Object.assign(a, { mode: "arrive", glow: GLOW_SECONDS, trail: 1.4, tx: a.x, ty: settle, tz: a.z });
      a.y -= k * 14;
    } else {
      nextPlan(a, s, world);
    }
    a.place();
    entry.animals.push(a);
    animals.push(a);
  }
  if (how === "arrive") {
    burst(x, z, 30);
    splash();
  }
}

function leave(entry: Entry) {
  if (entry.leaving) return;
  entry.leaving = true;
  if (!entry.loaded) {
    entries.delete(entry.id);
    return;
  }
  const s = entry.species;
  const lead = entry.pilot ?? entry.animals[0];
  for (const m of entry.pilot ? [entry.pilot, ...entry.animals] : entry.animals) {
    const b = bounds(s, world, m.z);
    const exit = (lead?.x ?? 0) < W / 2 ? b.left - s.length * 2 : b.right + s.length * 2;
    Object.assign(m, { mode: "leave", tx: exit, ty: m.y, tz: m.z });
  }
  for (const a of entry.animals) a.glow = Math.min(a.glow, 1);
}

function update(dt: number) {
  for (const e of entries.values()) if (e.pilot) steer(e.pilot, e.species, world, dt);
  for (const a of animals) {
    const s = a.species;
    if (s.rig.kind === "pulse") drift(a, s, world, dt);
    else if (a.entry.pilot) follow(a, a.entry.pilot, a.entry.animals, s, world, dt);
    else steer(a, s, world, dt);
    orient(a, s, dt);
    a.glow = Math.max(0, a.glow - dt);
    if (a.trail > 0) {
      a.trail -= dt;
      if (Math.random() < dt * 14) bubble(a.x + rand(-12, 12), a.y - 12, a.z, rand(3, 7));
    }
    const b = bounds(s, world, a.z);
    if (a.mode === "leave" && (a.x < b.left - s.length * 1.5 || a.x > b.right + s.length * 1.5)) a.gone = true;
    a.place();
  }
  if (animals.some((a) => a.gone)) {
    for (const a of animals) if (a.gone) a.dispose();
    animals = animals.filter((a) => !a.gone);
    for (const [id, e] of entries) {
      e.animals = e.animals.filter((a) => !a.gone);
      if (e.leaving && !e.animals.length) {
        removeHalo(e);
        entries.delete(id);
      }
    }
  }
  for (const e of entries.values()) updateHalo(e);
  updateBubbles(dt);
}

// Glow behind new arrivals

const haloGeometry = new PlaneGeometry(2, 2);

function removeHalo(e: Entry) {
  if (!e.halo) return;
  scene.remove(e.halo);
  (e.halo.material as ShaderMaterial).dispose();
  e.halo = null;
}

function updateHalo(e: Entry) {
  const glow = Math.max(0, ...e.animals.map((a) => a.glow));
  if (glow <= 0) {
    removeHalo(e);
    return;
  }
  if (!e.halo) {
    const material = new ShaderMaterial({
      vertexShader: glsl.haloVertex,
      fragmentShader: glsl.haloFragment,
      uniforms: { uClock: common.uClock, uStrength: { value: 0 } },
      transparent: true,
      premultipliedAlpha: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    e.halo = new Mesh(haloGeometry, material);
    e.halo.frustumCulled = false;
    scene.add(e.halo);
  }
  const center = e.pilot ?? e.animals[0];
  const radius = e.species.length * (e.species.school > 1 ? 2.5 : 1.1);
  // Just behind the animal, always facing the viewer.
  e.halo.position.set(toX(center.x), toY(center.y), toZ(center.z + 40));
  e.halo.quaternion.copy(camera.quaternion);
  e.halo.scale.set(radius, radius, 1);
  (e.halo.material as ShaderMaterial).uniforms.uStrength.value = Math.min(1, glow / 3) * Math.min(1, (GLOW_SECONDS - glow) / 0.6);
}

// Bubbles

interface Bubble {
  x: number;
  y: number;
  z: number;
  r: number;
  vy: number;
  drift: number;
  phase: number;
  alpha: number;
}

let bubbles: Bubble[] = [];
const bubblePositions = new BufferAttribute(new Float32Array(MAX_BUBBLES * 3), 3).setUsage(DynamicDrawUsage);
const bubbleSizes = new BufferAttribute(new Float32Array(MAX_BUBBLES), 1).setUsage(DynamicDrawUsage);
const bubbleAlphas = new BufferAttribute(new Float32Array(MAX_BUBBLES), 1).setUsage(DynamicDrawUsage);
const bubbleGeometry = new BufferGeometry();
bubbleGeometry.setAttribute("position", bubblePositions);
bubbleGeometry.setAttribute("aSize", bubbleSizes);
bubbleGeometry.setAttribute("aAlpha", bubbleAlphas);
const bubbleMaterial = new ShaderMaterial({
  vertexShader: glsl.bubbleVertex,
  fragmentShader: glsl.bubbleFragment,
  uniforms: { uScale: { value: 1 } },
  transparent: true,
  premultipliedAlpha: true,
  depthWrite: false,
});
const bubblePoints = new Points(bubbleGeometry, bubbleMaterial);
bubblePoints.frustumCulled = false;
// After the animals, so the animals' depth hides bubbles behind them.
bubblePoints.renderOrder = 10;
scene.add(bubblePoints);

function bubble(x: number, y: number, z: number, r: number) {
  if (bubbles.length >= MAX_BUBBLES) return;
  bubbles.push({ x, y, z, r, vy: -(35 + r * 6) * rand(0.8, 1.2), drift: rand(5, 14), phase: rand(0, 6.28), alpha: rand(0.55, 0.95) });
}

function burst(x: number, z: number, count: number) {
  for (let i = 0; i < count; i++) bubble(x + rand(-40, 40), rand(4, 94), z + rand(-40, 40), rand(3, 10));
}

function updateBubbles(dt: number) {
  for (const v of vents) {
    if (clock < v.next) continue;
    for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) bubble(v.x + rand(-6, 6), H - rand(0, 10), v.z + rand(-6, 6), rand(2.5, 7));
    v.next = clock + (Math.random() < 0.2 ? rand(2, 5) : rand(0.15, 0.6));
  }
  for (const b of bubbles) {
    b.y += b.vy * dt;
    b.x += Math.sin(clock * 2.2 + b.phase) * b.drift * dt;
  }
  bubbles = bubbles.filter((b) => b.y > -20);
  bubbles.forEach((b, i) => {
    bubblePositions.setXYZ(i, toX(b.x), toY(b.y), toZ(b.z));
    bubbleSizes.setX(i, b.r);
    bubbleAlphas.setX(i, b.alpha * Math.min(1, Math.max(0, b.y / 60)));
  });
  bubbleGeometry.setDrawRange(0, bubbles.length);
  bubblePositions.needsUpdate = bubbleSizes.needsUpdate = bubbleAlphas.needsUpdate = true;
}

// Camera, screen size and the frame loop

function resize() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  W = H * camera.aspect;
  world.width = W;
  water.uniforms.uAspect.value = vignette.uniforms.uAspect.value = camera.aspect;
  bubbleMaterial.uniforms.uScale.value = renderer.getDrawingBufferSize(new Vector2()).y / Math.tan((FOV * Math.PI) / 360);
  buildScenery();
  for (const m of [...animals, ...[...entries.values()].flatMap((e) => (e.pilot ? [e.pilot] : []))]) {
    const b = bounds(SPECIES[0], world, m.z);
    if (m.mode === "swim" && (m.x > b.right || m.tx > b.right)) m.planUntil = 0;
  }
}

/** The camera drifts a little, as if floating in front of the glass, so the depth shows. */
function moveCamera() {
  camera.position.set(Math.sin(clock * 0.05) * W * 0.02, H / 2 + Math.sin(clock * 0.037) * H * 0.008, CAMERA);
  camera.lookAt(0, H / 2, 0);
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;
  world.clock = clock;
  common.uClock.value = clock;
  moveCamera();
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Animals from the server

/** The image scaled down so its longest side is at most `side` pixels. */
function shrink(image: HTMLImageElement, side: number): TexImageSource {
  const scale = side / Math.max(image.naturalWidth, image.naturalHeight);
  if (scale >= 1) return image;
  const out = makeCanvas(image.naturalWidth * scale, image.naturalHeight * scale);
  const g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(image, 0, 0, out.width, out.height);
  return out;
}

/** A child's drawing drops in and glows; a starter swims in from the side. */
const arrival = (f: Fish) => (f.preset === undefined ? "arrive" : "enter");

async function addAnimal(f: Fish, how: "arrive" | "place" | "enter") {
  const s = speciesById(f.species);
  if (!s || entries.has(f.id)) return;
  const entry: Entry = { id: f.id, species: s, animals: [], pilot: null, leaving: false, loaded: false, halo: null };
  entries.set(f.id, entry);
  try {
    let image: TexImageSource;
    if (f.preset === undefined) {
      const drawing = new Image();
      drawing.src = f.url ?? "";
      await drawing.decode();
      image = shrink(drawing, TEXTURE_SIDE);
    } else {
      image = presetImage(compile(s), s.presets[f.preset % s.presets.length], TEXTURE_SIDE);
    }
    if (entry.leaving) return;
    entry.loaded = true;
    spawn(entry, new Look(texture(image, 4)), how);
  } catch (err) {
    console.warn(`Could not load ${f.url ?? f.id}`, err);
    entries.delete(f.id);
  }
}

let snapshotSeen = false;

function reconcile(list: Fish[]) {
  const ids = new Set(list.map((f) => f.id));
  for (const e of [...entries.values()]) if (!ids.has(e.id)) leave(e);
  // On the first load everything is already in the tank; after a reconnect, anything new swims in.
  for (const f of list) addAnimal(f, snapshotSeen ? arrival(f) : "place");
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
      addAnimal(message.fish, arrival(message.fish));
    } else {
      const e = entries.get(message.id);
      if (e) leave(e);
    }
  };
  socket.onclose = () => {
    setStatus("Lost the server; reconnecting…");
    setTimeout(connect, 2000);
  };
}

// Page behavior: full screen and sound on the first click, keep the screen awake, hide the cursor, show where the
// station is.

enableSound();
const hint = document.getElementById("hint")!;
document.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener("fullscreenchange", () => hint.classList.add("gone"));
setTimeout(() => hint.classList.add("gone"), 6000);

// Keep the screen from sleeping. Browsers drop the lock whenever the page is hidden, and Safari only grants it
// after a click, so it is asked for again then. It needs https or localhost; elsewhere `navigator.wakeLock`
// doesn't exist.
let awake = false;
async function keepAwake() {
  if (awake || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
  awake = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => (awake = false));
  } catch (err) {
    awake = false;
    console.warn("Could not keep the screen awake", err);
  }
}
if (!("wakeLock" in navigator)) console.warn("This page can't keep the screen awake here: it needs https or localhost.");
document.addEventListener("visibilitychange", keepAwake);
document.addEventListener("click", keepAwake);
keepAwake();

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
requestAnimationFrame(frame);
