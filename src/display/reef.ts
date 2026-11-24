// Paints the tank's scenery for the 3D view: the distant reef on the back wall, the sand floor seen from above,
// rock-and-coral clusters that stand on the sand, and where seagrass grows and bubbles rise. Positions are tank
// coordinates: x across (0..width at the front glass, wider further back) and z back from the glass.
import { makeCanvas } from "../coloring.ts";

export interface Cluster {
  canvas: HTMLCanvasElement;
  x: number;
  z: number;
  width: number;
  height: number;
  /** How far the cluster's foot sits below the sand, hiding its bottom edge. */
  sink: number;
}

export interface Blade {
  x: number;
  z: number;
  height: number;
  width: number;
  color: readonly [number, number, number];
  phase: number;
}

export interface Scenery {
  /** The back wall's painting and its size; its bottom edge meets the sand. */
  wall: { canvas: HTMLCanvasElement; width: number; height: number };
  /** The sand seen from above: canvas top is the back of the tank. */
  floor: { canvas: HTMLCanvasElement; left: number; right: number; front: number; back: number };
  clusters: Cluster[];
  blades: Blade[];
  vents: { x: number; z: number }[];
}

export interface TankShape {
  width: number;
  height: number;
  depth: number;
  camera: number;
}

type Random = () => number;

const CORALS = ["#f08a7e", "#f4a06b", "#9c6fd0", "#d06aa8", "#e9c45a", "#5fb49a", "#f39a4a", "#b79be6", "#ef7d9a"];
const GRASS = [[0.25, 0.6, 0.31], [0.36, 0.72, 0.36], [0.18, 0.49, 0.31], [0.45, 0.66, 0.25]] as const;
/** Canvas pixels per world unit for the coral clusters. */
const CLUSTER_PIXELS = 2;

/** Small seeded random generator (mulberry32), so the reef looks the same on every load. */
function seeded(seed: number): Random {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hex color mixed toward white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

/** Drawing helpers for reef things, all in world units on `g`. */
function brushes(g: CanvasRenderingContext2D, random: Random) {
  const R = (a: number, b: number) => a + (b - a) * random();
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];

  const roundedTop = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x, y + h);
    g.lineTo(x, y + r);
    g.arcTo(x, y, x + r, y, r);
    g.lineTo(x + w - r, y);
    g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h);
    g.closePath();
  };

  const branching = (x: number, y: number, size: number, color: string) => {
    const tip = shade(color, 0.35);
    const grow = (x0: number, y0: number, angle: number, len: number, width: number, depth: number) => {
      angle = Math.max(-Math.PI + 0.35, Math.min(-0.35, angle));
      const x1 = x0 + Math.cos(angle) * len, y1 = y0 + Math.sin(angle) * len;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(x0 + Math.cos(angle) * len * 0.5 + R(-0.15, 0.15) * len, y0 + Math.sin(angle) * len * 0.5, x1, y1);
      g.stroke();
      if (depth === 0) {
        g.fillStyle = tip;
        g.beginPath();
        g.arc(x1, y1, width * 0.6, 0, Math.PI * 2);
        g.fill();
        return;
      }
      const n = random() < 0.35 ? 3 : 2;
      for (let k = 0; k < n; k++) grow(x1, y1, angle + (k - (n - 1) / 2) * R(0.35, 0.6), len * R(0.62, 0.78), width * 0.75, depth - 1);
    };
    for (let k = 0; k < 3; k++) grow(x + R(-0.15, 0.15) * size, y, -Math.PI / 2 + R(-0.5, 0.5), size * 0.3, size * 0.09, 3);
  };

  const brain = (x: number, y: number, r: number, color: string) => {
    const ry = r * 0.75;
    const fill = g.createRadialGradient(x - r * 0.3, y - ry * 0.8, r * 0.1, x, y - ry * 0.4, r * 1.2);
    fill.addColorStop(0, shade(color, 0.3));
    fill.addColorStop(1, shade(color, -0.3));
    g.save();
    g.beginPath();
    g.ellipse(x, y, r, ry, 0, Math.PI, 0);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.clip();
    g.strokeStyle = shade(color, -0.4);
    g.globalAlpha = 0.55;
    g.lineWidth = Math.max(1.5, r * 0.06);
    for (let k = 0; k < 10; k++) {
      let px = x + R(-r, r), py = y - R(0, ry), a = R(0, Math.PI * 2);
      g.beginPath();
      g.moveTo(px, py);
      for (let s = 0; s < 16; s++) {
        a += R(-0.8, 0.8);
        px += Math.cos(a) * r * 0.1;
        py += Math.sin(a) * r * 0.1;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  };

  const fan = (x: number, y: number, size: number, color: string) => {
    g.save();
    g.globalAlpha = 0.9;
    g.strokeStyle = color;
    const grow = (x0: number, y0: number, angle: number, len: number, width: number, depth: number) => {
      const x1 = x0 + Math.cos(angle) * len, y1 = y0 + Math.sin(angle) * len;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      if (depth === 0) return;
      grow(x1, y1, angle - R(0.2, 0.45), len * 0.82, width * 0.78, depth - 1);
      grow(x1, y1, angle + R(0.2, 0.45), len * 0.82, width * 0.78, depth - 1);
    };
    grow(x, y, -Math.PI / 2 + R(-0.1, 0.1), size * 0.2, size * 0.045, 6);
    g.restore();
  };

  const tubes = (x: number, y: number, size: number, color: string) => {
    const n = 3 + Math.floor(random() * 3);
    for (let k = 0; k < n; k++) {
      const w = size * R(0.16, 0.24), h = size * R(0.5, 1.05);
      g.save();
      g.translate(x + (k - (n - 1) / 2) * w * 0.95 + R(-3, 3), y);
      g.rotate(R(-0.15, 0.15));
      const body = g.createLinearGradient(-w / 2, 0, w / 2, 0);
      body.addColorStop(0, shade(color, -0.35));
      body.addColorStop(0.45, shade(color, 0.15));
      body.addColorStop(1, shade(color, -0.3));
      g.fillStyle = body;
      roundedTop(-w / 2, -h, w, h + 4, w * 0.45);
      g.fill();
      g.fillStyle = shade(color, -0.55);
      g.beginPath();
      g.ellipse(0, -h + w * 0.12, w * 0.38, w * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };

  const anemone = (x: number, y: number, size: number, color: string) => {
    const tip = shade(color, 0.4);
    g.fillStyle = shade(color, -0.35);
    g.beginPath();
    g.ellipse(x, y - size * 0.08, size * 0.22, size * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    const n = 24;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1) - 0.5;
      const a = -Math.PI / 2 + t * 2.6 + R(-0.12, 0.12);
      const len = size * R(0.42, 0.62) * (1 - Math.abs(t) * 0.35);
      const sx = x + t * size * 0.32, sy = y - size * 0.16;
      const bend = R(-0.4, 0.4);
      const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
      g.strokeStyle = color;
      g.lineWidth = size * 0.055;
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + Math.cos(a + bend) * len * 0.6, sy + Math.sin(a + bend) * len * 0.6, ex, ey);
      g.stroke();
      g.fillStyle = tip;
      g.beginPath();
      g.arc(ex, ey, size * 0.035, 0, Math.PI * 2);
      g.fill();
    }
  };

  const plate = (x: number, y: number, size: number, color: string) => {
    g.fillStyle = shade(color, -0.3);
    g.fillRect(x - size * 0.06, y - size * 0.45, size * 0.12, size * 0.45);
    for (let k = 0; k < 3; k++) {
      const py = y - size * (0.42 + k * 0.17), w = size * (0.55 - k * 0.12);
      const top = g.createLinearGradient(0, py - size * 0.06, 0, py + size * 0.06);
      top.addColorStop(0, shade(color, 0.25));
      top.addColorStop(1, shade(color, -0.25));
      g.fillStyle = top;
      g.beginPath();
      g.ellipse(x + R(-6, 6), py, w, size * 0.07, 0, 0, Math.PI * 2);
      g.fill();
    }
  };

  /** Any coral, sitting on (x, y). */
  const coral = (x: number, y: number, size: number) => {
    const color = pick(CORALS);
    const kind = pick(["branching", "brain", "fan", "tubes", "anemone", "plate"] as const);
    if (kind === "branching") branching(x, y, size, color);
    else if (kind === "brain") brain(x, y, size * 0.45, color);
    else if (kind === "fan") fan(x, y, size * 1.2, color);
    else if (kind === "tubes") tubes(x, y, size * 0.8, color);
    else if (kind === "anemone") anemone(x, y, size * 0.8, color);
    else plate(x, y, size, color);
  };

  /** A rounded rock with its foot at `base`; returns the height of its top at x. */
  const rock = (cx: number, base: number, width: number, height: number) => {
    const x0 = cx - width / 2;
    const seed = R(0, 10);
    const lift = (x: number) => {
      const t = (x - x0) / width;
      if (t <= 0 || t >= 1) return 0;
      return height * Math.pow(Math.sin(Math.PI * t), 0.7) * (1 + 0.1 * Math.sin(t * 11 + seed) + 0.06 * Math.sin(t * 23 + seed * 2));
    };
    const top = (x: number) => base - lift(x);
    g.beginPath();
    g.moveTo(x0, base + 10);
    for (let x = x0; x <= x0 + width; x += 6) g.lineTo(x, top(x));
    g.lineTo(x0 + width, base + 10);
    g.closePath();
    const fill = g.createLinearGradient(0, base - height, 0, base);
    fill.addColorStop(0, "#8f8aae");
    fill.addColorStop(1, "#56527a");
    g.fillStyle = fill;
    g.fill();
    g.save();
    g.clip();
    for (let k = 0; k < width / 6; k++) {
      g.fillStyle = random() < 0.5 ? "rgba(60, 56, 92, 0.25)" : "rgba(170, 166, 200, 0.2)";
      g.beginPath();
      g.ellipse(R(x0, x0 + width), R(base - height, base), R(3, 10), R(2, 7), R(0, 3), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.strokeStyle = "rgba(190, 186, 220, 0.55)";
    g.lineWidth = 3;
    g.beginPath();
    for (let x = x0 + 8; x <= x0 + width - 8; x += 6) {
      if (x === x0 + 8) g.moveTo(x, top(x) + 2);
      else g.lineTo(x, top(x) + 2);
    }
    g.stroke();
    return top;
  };

  /** Seen from above, lying on the sand. */
  const starfish = (x: number, y: number, r: number, color: string) => {
    const turn = R(0, Math.PI * 2);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = turn + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r;
      if (k) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = shade(color, -0.25);
    g.lineWidth = 1.5;
    g.stroke();
  };

  /** Seen from above, lying on the sand. */
  const shell = (x: number, y: number, s: number, color: string) => {
    const turn = R(0, Math.PI * 2);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, s, turn + Math.PI * 1.05, turn + Math.PI * 1.95);
    g.closePath();
    g.fill();
    g.strokeStyle = shade(color, -0.3);
    g.lineWidth = 1.2;
    for (let k = 1; k < 5; k++) {
      const a = turn + Math.PI * (1.05 + (k * 0.9) / 5);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      g.stroke();
    }
  };

  return { R, pick, coral, rock, starfish, shell };
}

/** One rock with corals on it, painted on its own transparent canvas. */
function cluster(random: Random, x: number, z: number, width: number, rockHeight: number): Cluster {
  const height = rockHeight + width * 0.45;
  const scale = Math.min(CLUSTER_PIXELS, 1024 / width);
  const canvas = makeCanvas(width * scale, height * scale);
  const g = canvas.getContext("2d")!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.lineCap = g.lineJoin = "round";
  const b = brushes(g, random);
  const base = height - 4;
  const top = b.rock(width / 2, base, width * 0.92, rockHeight);
  const n = width > 300 ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const cx = width / 2 + (i / (n - 1) - 0.5) * width * 0.62 + b.R(-12, 12);
    b.coral(cx, top(cx) + 6, b.R(50, 100) * (width / 400));
  }
  return { canvas, x, z, width, height, sink: 8 };
}

export function paintScenery(tank: TankShape, seed = 11): Scenery {
  const random = seeded(seed);
  const R = (a: number, b: number) => a + (b - a) * random();
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const mid = tank.width / 2;
  /** Half the width of the view at depth z. */
  const half = (z: number) => ((tank.width / 2) * (tank.camera + z)) / tank.camera;

  // Clusters: a row along the back wall, a big one at each side, and a small one in the middle distance.
  const clusters: Cluster[] = [];
  const backZ = tank.depth - 70;
  const backCount = Math.max(3, Math.round((2 * half(backZ)) / 480));
  for (let k = 0; k < backCount; k++) {
    const x = mid - half(backZ) + ((k + 0.5) / backCount) * 2 * half(backZ) + R(-60, 60);
    clusters.push(cluster(random, x, backZ + R(-40, 30), R(300, 440), R(80, 150)));
  }
  for (const side of [-1, 1]) {
    const z = R(260, 480);
    clusters.push(cluster(random, mid + side * (half(z) - R(20, 80)), z, R(380, 500), R(140, 220)));
  }
  const midZ = R(520, 700);
  clusters.push(cluster(random, mid + R(-0.25, 0.25) * half(midZ), midZ, R(170, 230), R(50, 80)));

  // The back wall: two hazy ridges of distant reef rising from the sand, clear water above.
  const wallWidth = 2 * half(tank.depth) * 1.2;
  const wallHeight = tank.height;
  const wall = makeCanvas(2048, (2048 * wallHeight) / wallWidth);
  const w = wall.getContext("2d")!;
  w.setTransform(wall.width / wallWidth, 0, 0, wall.height / wallHeight, 0, 0);
  w.lineCap = w.lineJoin = "round";
  const ridge = (base: number, amp: number, color: string, phase: number) => {
    w.beginPath();
    w.moveTo(0, wallHeight);
    for (let x = 0; x <= wallWidth + 20; x += 20) {
      const wave = 0.55 * Math.sin(x * 0.0041 + phase) + 0.3 * Math.sin(x * 0.011 + phase * 2.1) + 0.15 * Math.sin(x * 0.027 + phase * 3.7);
      w.lineTo(x, base - amp * wave);
    }
    w.lineTo(wallWidth, wallHeight);
    w.closePath();
    w.fillStyle = color;
    w.fill();
  };
  ridge(wallHeight * 0.6, 60, "rgba(40, 112, 160, 0.5)", 1.3);
  for (let x = R(0, 60); x < wallWidth; x += R(70, 160)) {
    const y = wallHeight * 0.6 + R(-10, 30), s = R(40, 90);
    w.fillStyle = w.strokeStyle = `rgba(${Math.round(R(55, 85))}, ${Math.round(R(118, 142))}, ${Math.round(R(165, 188))}, 0.5)`;
    if (random() < 0.5) {
      w.beginPath();
      w.ellipse(x, y, s, s * 0.7, 0, Math.PI, 0);
      w.fill();
    } else {
      w.lineWidth = s * 0.18;
      for (let k = 0; k < 4; k++) {
        const spread = (k - 1.5) * s;
        w.beginPath();
        w.moveTo(x + spread * 0.25, y);
        w.quadraticCurveTo(x + spread * 0.5, y - s * 0.6, x + spread * 0.4 + R(-8, 8), y - s * R(0.8, 1.3));
        w.stroke();
      }
    }
  }
  ridge(wallHeight * 0.74, 40, "rgba(30, 90, 132, 0.85)", 4.1);
  ridge(wallHeight * 0.88, 18, "rgba(24, 76, 116, 1)", 2.2);

  // The sand, seen from above: canvas x runs across, canvas top is the back of the tank.
  const floorHalf = half(tank.depth + 120) * 1.15;
  const floor = { left: mid - floorHalf, right: mid + floorHalf, front: -200, back: tank.depth + 40 };
  const floorCanvas = makeCanvas(2048, Math.max(512, (2048 * (floor.back - floor.front)) / (floor.right - floor.left)));
  const f = floorCanvas.getContext("2d")!;
  const sx = floorCanvas.width / (floor.right - floor.left), sz = floorCanvas.height / (floor.back - floor.front);
  // Draw in world units with x as given and y = z measured from the back.
  f.setTransform(sx, 0, 0, sz, -floor.left * sx, 0);
  const toY = (z: number) => floor.back - z;
  const sand = f.createLinearGradient(0, 0, 0, floor.back - floor.front);
  sand.addColorStop(0, "#d9c391");
  sand.addColorStop(1, "#ead9a8");
  f.fillStyle = sand;
  f.fillRect(floor.left, 0, floor.right - floor.left, floor.back - floor.front);
  f.lineCap = f.lineJoin = "round";
  f.strokeStyle = "rgba(160, 128, 80, 0.3)";
  f.lineWidth = 3;
  for (let z = floor.front + 30; z < floor.back; z += 36) {
    f.beginPath();
    for (let x = floor.left; x <= floor.right; x += 18) {
      const y = toY(z) + 7 * Math.sin(x * 0.02 + z * 0.13) + 4 * Math.sin(x * 0.051 + z);
      if (x === floor.left) f.moveTo(x, y);
      else f.lineTo(x, y);
    }
    f.stroke();
  }
  // Soft shadows under the clusters.
  for (const c of clusters) {
    const shadow = f.createRadialGradient(c.x, toY(c.z), 0, c.x, toY(c.z), c.width * 0.6);
    shadow.addColorStop(0, "rgba(70, 60, 40, 0.35)");
    shadow.addColorStop(1, "rgba(70, 60, 40, 0)");
    f.fillStyle = shadow;
    f.beginPath();
    f.ellipse(c.x, toY(c.z), c.width * 0.6, 90, 0, 0, Math.PI * 2);
    f.fill();
  }
  const fb = brushes(f, random);
  for (let k = 0; k < (floor.right - floor.left) / 6; k++) {
    f.fillStyle = pick(["#cdb07a", "#b49565", "#e8d9ad", "#a98d62"]);
    f.beginPath();
    f.ellipse(R(floor.left, floor.right), R(0, floor.back - floor.front), R(2, 5), R(2, 5), 0, 0, Math.PI * 2);
    f.fill();
  }
  for (let k = 0; k < 14; k++) {
    const x = R(floor.left, floor.right), y = toY(R(40, tank.depth - 100));
    if (random() < 0.5) fb.starfish(x, y, R(12, 20), pick(["#ff8a50", "#e8383d", "#ffb347", "#c34bd6"]));
    else fb.shell(x, y, R(8, 13), pick(["#f6e7d0", "#f2c9b8", "#e6d5f2"]));
  }

  // Seagrass in tufts across the sand, plus taller tufts in the front corners.
  const blades: Blade[] = [];
  const tuft = (x: number, z: number, count: number, tall: number) => {
    for (let i = 0; i < count; i++) {
      blades.push({ x: x + R(-18, 18), z: z + R(-14, 14), height: tall * R(0.55, 1), width: R(7, 12), color: pick(GRASS), phase: R(0, Math.PI * 2) });
    }
  };
  const tufts = Math.round(tank.width / 180);
  for (let k = 0; k < tufts; k++) {
    const z = R(120, tank.depth - 80);
    tuft(mid + R(-0.95, 0.95) * half(z), z, Math.round(R(5, 9)), R(90, 170));
  }
  for (const side of [-1, 1]) tuft(mid + side * half(40) * R(0.8, 0.92), 40, 9, 210);

  const vents = Array.from({ length: Math.max(3, Math.round(tank.width / 500)) }, () => {
    const z = R(150, tank.depth - 150);
    return { x: mid + R(-0.85, 0.85) * half(z), z };
  });

  return { wall: { canvas: wall, width: wallWidth, height: wallHeight }, floor: { canvas: floorCanvas, ...floor }, clusters, blades, vents };
}
