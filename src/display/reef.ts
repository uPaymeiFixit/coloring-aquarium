// Paints the tank backdrop (distant reef, sand, rocks and corals) and places the seagrass and bubble vents.
// Drawn once per screen size in world units: the tank is 1000 units tall.
import { makeCanvas } from "../coloring.ts";

export interface Blade {
  x: number;
  y: number;
  height: number;
  width: number;
  color: readonly [number, number, number];
  phase: number;
  /** In front of the animals instead of behind them. */
  front: boolean;
}

export interface Reef {
  canvas: HTMLCanvasElement;
  blades: Blade[];
  vents: { x: number; y: number }[];
}

const CORALS = ["#f08a7e", "#f4a06b", "#9c6fd0", "#d06aa8", "#e9c45a", "#5fb49a", "#f39a4a", "#b79be6", "#ef7d9a"];
const GRASS = [[0.25, 0.6, 0.31], [0.36, 0.72, 0.36], [0.18, 0.49, 0.31], [0.45, 0.66, 0.25]] as const;

/** Small seeded random generator (mulberry32), so the reef looks the same on every load. */
function seeded(seed: number) {
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

export function paintReef(pixelWidth: number, pixelHeight: number, W: number, H: number): Reef {
  const canvas = makeCanvas(pixelWidth, pixelHeight);
  const g = canvas.getContext("2d")!;
  const random = seeded(11);
  const R = (a: number, b: number) => a + (b - a) * random();
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  g.setTransform(pixelWidth / W, 0, 0, pixelHeight / H, 0, 0);
  g.lineCap = g.lineJoin = "round";

  const ridge = (base: number, amp: number, color: string, seed: number) => {
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 20) {
      const wave = 0.55 * Math.sin(x * 0.0041 + seed) + 0.3 * Math.sin(x * 0.011 + seed * 2.1) + 0.15 * Math.sin(x * 0.027 + seed * 3.7);
      g.lineTo(x, base - amp * wave);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };

  const distantCoral = (x: number, y: number, s: number) => {
    g.fillStyle = g.strokeStyle = `rgba(${Math.round(R(55, 85))}, ${Math.round(R(118, 142))}, ${Math.round(R(165, 188))}, 0.5)`;
    if (random() < 0.5) {
      g.beginPath();
      g.ellipse(x, y, s, s * 0.7, 0, Math.PI, 0);
      g.fill();
      return;
    }
    g.lineWidth = s * 0.18;
    for (let k = 0; k < 4; k++) {
      const spread = (k - 1.5) * s;
      g.beginPath();
      g.moveTo(x + spread * 0.25, y);
      g.quadraticCurveTo(x + spread * 0.5, y - s * 0.6, x + spread * 0.4 + R(-8, 8), y - s * R(0.8, 1.3));
      g.stroke();
    }
  };

  const sandTop = (x: number) => 0.86 * H + 9 * Math.sin(x * 0.006 + 1.3) + 5 * Math.sin(x * 0.017 + 0.4);

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

  const starfish = (x: number, y: number, r: number, color: string) => {
    const turn = R(0, Math.PI * 2);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = turn + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.55;
      if (k) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = shade(color, -0.25);
    g.lineWidth = 1.5;
    g.stroke();
  };

  const shell = (x: number, y: number, s: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, s, Math.PI * 1.05, Math.PI * 1.95);
    g.closePath();
    g.fill();
    g.strokeStyle = shade(color, -0.3);
    g.lineWidth = 1.2;
    for (let k = 1; k < 5; k++) {
      const a = Math.PI * (1.05 + (k * 0.9) / 5);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      g.stroke();
    }
  };

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

  /** A rounded rock on the sand; returns the height of its top at x. */
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

  // Distant reef, fading into the water.
  ridge(0.74 * H, 34, "rgba(40, 112, 160, 0.45)", 1.3);
  for (let x = R(0, 60); x < W; x += R(70, 160)) distantCoral(x, 0.74 * H + R(-10, 20), R(30, 70));
  ridge(0.8 * H, 24, "rgba(30, 90, 132, 0.75)", 4.1);

  // Sand with ripples and pebbles.
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W + 10; x += 10) g.lineTo(x, sandTop(x));
  g.lineTo(W, H);
  g.closePath();
  const sand = g.createLinearGradient(0, 0.84 * H, 0, H);
  sand.addColorStop(0, "#e9d8a6");
  sand.addColorStop(1, "#c3a36b");
  g.fillStyle = sand;
  g.fill();
  g.strokeStyle = "rgba(160, 128, 80, 0.28)";
  g.lineWidth = 2.2;
  for (let k = 1; k < 9; k++) {
    g.beginPath();
    for (let x = 0; x <= W; x += 15) {
      const y = sandTop(x) + k * 16 + 3 * Math.sin(x * 0.03 + k * 1.7);
      if (x) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }
  for (let k = 0; k < W / 9; k++) {
    const x = R(0, W);
    g.fillStyle = pick(["#cdb07a", "#b49565", "#e8d9ad", "#a98d62"]);
    g.beginPath();
    g.ellipse(x, R(sandTop(x) + 8, H), R(2, 5), R(1.5, 3.5), 0, 0, Math.PI * 2);
    g.fill();
  }

  // Rocks with corals on top; the outer rocks are taller to frame the tank.
  const rocks = Math.max(3, Math.round(W / 430));
  for (let k = 0; k < rocks; k++) {
    const edge = k === 0 || k === rocks - 1;
    const cx = ((k + 0.5) / rocks) * W + R(-0.15, 0.15) * (W / rocks);
    const width = R(170, 280) * (edge ? 1.25 : 1);
    const height = R(60, 120) * (edge ? 1.5 : 1);
    const top = rock(cx, sandTop(cx) + 20, width, height);
    const n = edge ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const x = cx + (i / (n - 1) - 0.5) * width * 0.7 + R(-15, 15);
      coral(x, top(x) + 6, R(50, 100) * (edge ? 1.2 : 1));
    }
  }

  // Smaller things on the open sand.
  for (let x = R(40, 120); x < W; x += R(140, 260)) {
    const y = sandTop(x) + R(14, 40);
    const kind = pick(["anemone", "brain", "starfish", "starfish", "shell"] as const);
    if (kind === "anemone") anemone(x, y, R(40, 60), pick(CORALS));
    else if (kind === "brain") brain(x, y, R(18, 28), pick(CORALS));
    else if (kind === "starfish") starfish(x, y, R(10, 16), pick(["#ff8a50", "#e8383d", "#ffb347", "#c34bd6"]));
    else shell(x, y, R(7, 11), pick(["#f6e7d0", "#f2c9b8", "#e6d5f2"]));
  }

  const blades: Blade[] = [];
  const tuft = (x: number, y: number, count: number, tall: number, front: boolean) => {
    for (let i = 0; i < count; i++) {
      blades.push({ x: x + R(-18, 18), y: y + R(0, 8), height: tall * R(0.55, 1), width: R(7, 12), color: pick(GRASS), phase: R(0, Math.PI * 2), front });
    }
  };
  for (let x = R(60, 160); x < W; x += R(180, 320)) tuft(x, sandTop(x) + R(8, 30), Math.round(R(5, 9)), R(90, 170), false);
  tuft(R(0.02, 0.08) * W, H + 6, 9, 200, true);
  tuft(R(0.92, 0.98) * W, H + 6, 9, 200, true);

  const vents = Array.from({ length: Math.max(2, Math.round(W / 600)) }, () => {
    const x = R(0.1, 0.9) * W;
    return { x, y: sandTop(x) + 4 };
  });

  return { canvas, blades, vents };
}
