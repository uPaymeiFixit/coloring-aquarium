// Canvas drawing for the coloring templates: the white base, ink lines, region fills, patterns and finished images.
// Used by the station (while a child colors) and by the tank (for the starter animals).
import { circle, type Eye, type Fill, type PatternKind, type Species } from "./species.ts";

export const INK = "#1f2c3b";

/** Station palette. White is the eraser. */
export const PALETTE = [
  "#e8383d", "#ff7a1a", "#ffc928", "#a5d93a", "#2fae4e", "#14b3a6", "#38b6f2", "#2864d8",
  "#6b46c9", "#c34bd6", "#ff6fae", "#ffb3c9", "#8a5632", "#f3c48b", "#9aa4b0", "#262b33",
];

/** The species' regions in drawing order, then one round region per eye on top. */
export interface Template {
  species: Species;
  paths: Path2D[];
  clips: (Path2D | null)[];
  details: Path2D[][];
}

export interface Paint {
  color: string;
  pattern?: PatternKind;
}

export function compile(species: Species): Template {
  const byId = new Map(species.regions.map((r) => [r.id, new Path2D(r.d)] as const));
  // Eyes are colorable like any region; only the pupil is drawn on top as ink.
  const eyes = species.eyes.map((e) => new Path2D(circle(e.x, e.y, e.r)));
  return {
    species,
    paths: [...species.regions.map((r) => byId.get(r.id)!), ...eyes],
    clips: [...species.regions.map((r) => (r.clipTo ? (byId.get(r.clipTo) ?? null) : null)), ...eyes.map(() => null)],
    details: [...species.regions.map((r) => (r.details ?? []).map((d) => new Path2D(d))), ...eyes.map(() => [])],
  };
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

/** Pixels per template unit that fit the longest side of the art into `side` pixels. */
export const scaleFor = (s: Species, side: number) => side / Math.max(s.width, s.height);

/** The silhouette in white: every region's visible area. Paint later lands only on these pixels. */
export function drawBase(g: CanvasRenderingContext2D, t: Template, scale: number) {
  g.save();
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = "#fff";
  t.paths.forEach((p, i) => {
    g.save();
    const clip = t.clips[i];
    if (clip) g.clip(clip);
    g.fill(p);
    g.restore();
  });
  g.restore();
}

/**
 * Outlines, detail lines and eyes, on their own transparent layer. Regions are inked in order and each one
 * first erases the lines underneath it, so only the visible edges remain.
 */
export function drawInk(g: CanvasRenderingContext2D, t: Template, scale: number) {
  const w = t.species.ink;
  g.save();
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.lineJoin = g.lineCap = "round";
  g.strokeStyle = INK;
  g.fillStyle = "#000";
  t.paths.forEach((p, i) => {
    const clip = t.clips[i];
    g.save();
    g.globalCompositeOperation = "destination-out";
    if (clip) g.clip(clip);
    g.fill(p);
    g.restore();

    g.save();
    if (clip) g.clip(clip);
    g.lineWidth = w;
    g.stroke(p);
    g.restore();

    // A clipped region covers part of its parent's outline; draw that outline back on top.
    if (clip) {
      g.save();
      g.clip(p);
      g.lineWidth = w;
      g.stroke(clip);
      g.restore();
    }

    if (t.details[i].length) {
      g.save();
      if (clip) g.clip(clip);
      g.clip(p);
      g.lineWidth = w * 0.6;
      for (const d of t.details[i]) g.stroke(d);
      g.restore();
    }
  });
  for (const eye of t.species.eyes) drawPupil(g, eye);
  g.restore();
}

/** The pupil and its highlight; the eye's outline and color come from its region. */
function drawPupil(g: CanvasRenderingContext2D, e: Eye) {
  const dot = (x: number, y: number, r: number, color: string) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  };
  dot(e.x + e.r * 0.14, e.y + e.r * 0.02, e.r * 0.58, INK);
  dot(e.x + e.r * 0.32, e.y - e.r * 0.26, e.r * 0.2, "#fff");
}

let hitContext: CanvasRenderingContext2D | null = null;

/** Index of the topmost region under a template point, or -1. */
export function regionAt(t: Template, x: number, y: number): number {
  hitContext ??= makeCanvas(1, 1).getContext("2d")!;
  for (let i = t.paths.length - 1; i >= 0; i--) {
    const clip = t.clips[i];
    if (hitContext.isPointInPath(t.paths[i], x, y) && (!clip || hitContext.isPointInPath(clip, x, y))) return i;
  }
  return -1;
}

let scratch: HTMLCanvasElement | null = null;

/** Paints the visible part of one region (minus whatever later regions cover) with a color or a pattern. */
export function fillRegion(g: CanvasRenderingContext2D, t: Template, index: number, paint: Paint, scale: number) {
  const { width, height } = g.canvas;
  scratch ??= makeCanvas(width, height);
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  const s = scratch.getContext("2d")!;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = "source-over";
  s.clearRect(0, 0, width, height);

  s.save();
  s.setTransform(scale, 0, 0, scale, 0, 0);
  const clip = t.clips[index];
  if (clip) s.clip(clip);
  s.clip(t.paths[index]);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.fillStyle = paint.pattern
    ? s.createPattern(patternTile(paint.pattern, paint.color, t.species.width * 0.075 * scale), "repeat")!
    : paint.color;
  s.fillRect(0, 0, width, height);
  s.restore();

  s.save();
  s.setTransform(scale, 0, 0, scale, 0, 0);
  s.globalCompositeOperation = "destination-out";
  s.fillStyle = "#000";
  for (let j = index + 1; j < t.paths.length; j++) {
    s.save();
    const above = t.clips[j];
    if (above) s.clip(above);
    s.fill(t.paths[j]);
    s.restore();
  }
  s.restore();

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.drawImage(scratch, 0, 0);
  g.restore();
}

/** One seamless tile of a pattern in a single color on transparent, `size` pixels square. */
export function patternTile(kind: PatternKind, color: string, size: number): HTMLCanvasElement {
  const w = Math.max(6, Math.round(size));
  const c = makeCanvas(w, w);
  const g = c.getContext("2d")!;
  g.fillStyle = g.strokeStyle = color;
  g.lineJoin = g.lineCap = "round";
  // Draw each element at its wrapped positions too, so the tile repeats without seams.
  const wrapped = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-w, 0, w]) for (const dy of [-w, 0, w]) draw(dx, dy);
  };
  switch (kind) {
    case "dots":
      wrapped((dx, dy) => {
        for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]] as const) {
          g.beginPath();
          g.arc(x * w + dx, y * w + dy, 0.14 * w, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case "stripes":
      g.fillRect(0, 0, w * 0.42, w);
      break;
    case "zigzag":
      g.lineWidth = 0.13 * w;
      wrapped((dx, dy) => {
        g.beginPath();
        g.moveTo(dx, 0.68 * w + dy);
        g.lineTo(0.5 * w + dx, 0.32 * w + dy);
        g.lineTo(w + dx, 0.68 * w + dy);
        g.stroke();
      });
      break;
    case "scales":
      g.lineWidth = 0.08 * w;
      wrapped((dx, dy) => {
        for (const [x, y] of [[0, 0], [0.5, 0.5]] as const) {
          g.beginPath();
          g.arc(x * w + dx, y * w + dy, 0.5 * w, 0, Math.PI);
          g.stroke();
        }
      });
      break;
    case "hearts":
      wrapped((dx, dy) => {
        heart(g, 0.27 * w + dx, 0.3 * w + dy, 0.2 * w);
        heart(g, 0.77 * w + dx, 0.8 * w + dy, 0.2 * w);
      });
      break;
  }
  return c;
}

function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.beginPath();
  g.moveTo(x, y + 0.55 * s);
  g.bezierCurveTo(x - 1.1 * s, y - 0.1 * s, x - 0.55 * s, y - 0.95 * s, x, y - 0.35 * s);
  g.bezierCurveTo(x + 0.55 * s, y - 0.95 * s, x + 1.1 * s, y - 0.1 * s, x, y + 0.55 * s);
  g.fill();
}

/** The finished animal (paint plus ink), `side` pixels on its longest side, transparent around it. */
export function finish(paint: HTMLCanvasElement, t: Template, side: number): HTMLCanvasElement {
  const scale = scaleFor(t.species, side);
  const out = makeCanvas(t.species.width * scale, t.species.height * scale);
  const g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(paint, 0, 0, out.width, out.height);
  const ink = makeCanvas(out.width, out.height);
  drawInk(ink.getContext("2d")!, t, scale);
  g.drawImage(ink, 0, 0);
  return out;
}

/** The animal colored with a preset, for the tank's starter animals. */
export function presetImage(t: Template, fills: Record<string, Fill>, side: number): HTMLCanvasElement {
  const scale = scaleFor(t.species, side);
  const paint = makeCanvas(t.species.width * scale, t.species.height * scale);
  const g = paint.getContext("2d")!;
  drawBase(g, t, scale);
  t.species.regions.forEach((r, i) => {
    const fill = fills[r.id];
    if (!fill) return;
    if (typeof fill === "string") {
      fillRegion(g, t, i, { color: fill }, scale);
    } else {
      fillRegion(g, t, i, { color: fill.color }, scale);
      fillRegion(g, t, i, { color: fill.patternColor, pattern: fill.pattern }, scale);
    }
  });
  return finish(paint, t, side);
}

/** The uncolored animal, for the picker. */
export function outlineImage(t: Template, side: number): HTMLCanvasElement {
  const scale = scaleFor(t.species, side);
  const paint = makeCanvas(t.species.width * scale, t.species.height * scale);
  drawBase(paint.getContext("2d")!, t, scale);
  return finish(paint, t, side);
}
