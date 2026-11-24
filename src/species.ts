// Sea-animal coloring templates, shared by the coloring station, the tank display and the server.
// Each template is outline art cut into colorable regions, plus how the animal moves in the tank.
// Template coordinates: x to the right, y down. Every animal faces right.

/** A point; a third element of 1 keeps it a sharp corner instead of smoothing through it. */
export type Pt = readonly [number, number] | readonly [number, number, 1];

export type PatternKind = "dots" | "stripes" | "zigzag" | "scales" | "hearts";
export const PATTERNS: readonly PatternKind[] = ["dots", "stripes", "zigzag", "scales", "hearts"];

export interface Region {
  id: string;
  /** SVG path data. Later regions cover earlier ones. */
  d: string;
  /** Only the part of this region inside that other region shows. */
  clipTo?: string;
  /** Thinner lines drawn inside the region, such as fin rays. */
  details?: string[];
}

export interface Eye {
  x: number;
  y: number;
  r: number;
}

/** Fish: a wave runs down the body. The head end, from `rigid` (a fraction of the width), stays straight. */
export interface SwimRig {
  kind: "swim";
  beat: number;
  amplitude: number;
  waves: number;
  sweep: number;
  rigid: number;
}

/** A limb that rocks about a pivot, such as a flipper. Points and halfWidth are template units. */
export interface Joint {
  pivot: readonly [number, number];
  tip: readonly [number, number];
  halfWidth: number;
  amplitude: number;
  phase: number;
  rate: number;
}

export interface PaddleRig {
  kind: "paddle";
  beat: number;
  joints: Joint[];
}

/** Jellyfish: the bell squeezes and the arms trail. `bellEnd` is where the bell stops, as a fraction of the height. */
export interface PulseRig {
  kind: "pulse";
  beat: number;
  bellEnd: number;
  squeeze: number;
  sway: number;
}

export type Rig = SwimRig | PaddleRig | PulseRig;

export type Fill = string | { color: string; pattern: PatternKind; patternColor: string };

export interface Species {
  id: string;
  name: string;
  /** Shown under the name on the picker. */
  note?: string;
  width: number;
  height: number;
  /** Outline width in template units. */
  ink: number;
  regions: Region[];
  eyes: Eye[];
  /** Width of the art in the tank, which is 1000 units tall. */
  length: number;
  /** Cruising speed in tank units per second. */
  speed: number;
  /** How many copies of one drawing swim together. */
  school: number;
  /** Preferred water depth: 0 is the surface, 1 the sand. */
  band: readonly [number, number];
  rig: Rig;
  /** Colorings for the animals the tank starts with. */
  presets: Record<string, Fill>[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Cubic Bézier path through the points (Catmull-Rom tangents; corner points get none). */
function through(points: readonly Pt[], closed: boolean): string {
  const n = points.length;
  const at = (i: number): Pt => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const tangent = (i: number): [number, number] => {
    if (at(i).length > 2) return [0, 0];
    const a = at(i - 1), b = at(i + 1);
    return [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
  };
  let d = `M${r1(at(0)[0])} ${r1(at(0)[1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p1 = at(i), p2 = at(i + 1), t1 = tangent(i), t2 = tangent(i + 1);
    d += `C${r1(p1[0] + t1[0])} ${r1(p1[1] + t1[1])} ${r1(p2[0] - t2[0])} ${r1(p2[1] - t2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Smooth closed outline through the points. */
export const shape = (...points: Pt[]) => through(points, true);

/** Smooth open line through the points. */
export const line = (...points: Pt[]) => through(points, false);

/** Straight strokes, each [x1, y1, x2, y2]. */
const strokes = (...segments: [number, number, number, number][]) =>
  segments.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`);

export function circle(x: number, y: number, r: number): string {
  const k = r * 0.5523;
  return (
    `M${x + r} ${y}C${x + r} ${y + k} ${x + k} ${y + r} ${x} ${y + r}` +
    `C${x - k} ${y + r} ${x - r} ${y + k} ${x - r} ${y}C${x - r} ${y - k} ${x - k} ${y - r} ${x} ${y - r}` +
    `C${x + k} ${y - r} ${x + r} ${y - k} ${x + r} ${y}Z`
  );
}

/** Rows of scale edges, each row [y, fromX, toX]; alternate rows shift by half a step. */
function scales(rows: [number, number, number][], step: number, r: number): string[] {
  const out: string[] = [];
  rows.forEach(([y, x0, x1], row) => {
    for (let x = x0 + (row % 2) * step * 0.5; x <= x1; x += step) {
      out.push(`M${r1(x)} ${r1(y - r)}Q${r1(x - r * 0.8)} ${r1(y)} ${r1(x)} ${r1(y + r)}`);
    }
  });
  return out;
}

/** Points along a Catmull-Rom curve through the control points. */
function sample(points: readonly Pt[], steps: number): [number, number][] {
  const n = points.length;
  const at = (i: number) => points[Math.max(0, Math.min(n - 1, i))];
  const out: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (k: 0 | 1) =>
        0.5 *
        (2 * p1[k] +
          (p2[k] - p0[k]) * t +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
          (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  const last = points[n - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** Outline of a strip along a smooth center line. `width(t, side)` is its width at t (0..1) on each side. */
function ribbon(center: readonly Pt[], width: (t: number, side: 1 | -1) => number, steps = 6): string {
  const pts = sample(center, steps);
  const left: Pt[] = [];
  const right: Pt[] = [];
  pts.forEach(([x, y], i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)];
    const [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    const t = i / (pts.length - 1);
    const wl = width(t, 1) / 2, wr = width(t, -1) / 2;
    left.push([x + nx * wl, y + ny * wl]);
    right.push([x - nx * wr, y - ny * wr]);
  });
  return shape(...left, ...right.reverse());
}

const parrotfish: Species = {
  id: "parrotfish",
  name: "Parrotfish",
  width: 1000,
  height: 600,
  ink: 7,
  regions: [
    {
      id: "tail",
      d: shape([255, 272, 1], [190, 230], [120, 165], [62, 112, 1], [105, 200], [128, 300], [105, 400], [62, 488, 1], [120, 435], [190, 370], [255, 328, 1]),
      details: [line([236, 288], [158, 234], [98, 182]), line([236, 300], [168, 300], [124, 300]), line([236, 312], [158, 366], [98, 418])],
    },
    {
      id: "dorsal",
      d: shape([330, 240, 1], [332, 205], [350, 170], [395, 138], [470, 118], [560, 108], [650, 108], [730, 122], [785, 150], [800, 195, 1], [760, 215, 1]),
      details: strokes([385, 192, 378, 150], [455, 170, 448, 128], [530, 160, 522, 118], [605, 156, 598, 116], [680, 160, 674, 120], [748, 176, 745, 142]),
    },
    {
      id: "anal",
      d: shape([340, 375, 1], [345, 405], [370, 440], [420, 468], [480, 478], [525, 468], [545, 445, 1], [540, 420, 1]),
      details: strokes([382, 412, 388, 444], [432, 428, 438, 462], [482, 438, 486, 470]),
    },
    { id: "pelvic", d: shape([700, 430, 1], [680, 465], [650, 495], [622, 512, 1], [648, 480], [660, 445, 1]) },
    {
      id: "body",
      d: shape([225, 262, 1], [300, 222], [400, 180], [520, 155], [640, 150], [750, 165], [840, 205], [900, 255], [930, 310], [915, 360], [870, 398], [780, 438], [660, 455], [540, 452], [420, 430], [310, 385], [225, 340, 1]),
      details: scales([[218, 360, 560], [262, 310, 640], [308, 300, 650], [354, 310, 640]], 58, 24),
    },
    {
      id: "belly",
      clipTo: "body",
      d: shape([150, 330, 1], [300, 365], [480, 385], [680, 378], [860, 350], [990, 320, 1], [990, 560, 1], [150, 560, 1]),
      details: scales([[402, 360, 610]], 58, 24),
    },
    { id: "head", clipTo: "body", d: shape([700, 110, 1], [678, 200], [668, 300], [678, 400], [705, 490, 1], [980, 490, 1], [980, 110, 1]) },
    {
      id: "beak",
      d: shape([892, 318], [925, 305], [950, 325], [948, 358], [922, 378], [893, 370], [880, 345]),
      details: [line([884, 346], [915, 352], [947, 343])],
    },
    {
      id: "pectoral",
      d: shape([708, 322, 1], [670, 305], [625, 305], [588, 325], [578, 352], [598, 380], [640, 388], [685, 372], [708, 350, 1]),
      details: strokes([700, 334, 600, 326], [700, 338, 590, 352], [700, 342, 604, 376], [700, 346, 645, 384]),
    },
  ],
  eyes: [{ x: 805, y: 262, r: 28 }],
  length: 230,
  speed: 75,
  school: 1,
  band: [0.15, 0.75],
  rig: { kind: "swim", beat: 7, amplitude: 0.06, waves: 0.9, sweep: 0.25, rigid: 0.62 },
  presets: [
    { tail: "#ff6fae", dorsal: "#14b3a6", anal: "#14b3a6", pelvic: "#ff6fae", body: "#2fae4e", belly: "#a5d93a", head: "#38b6f2", beak: "#f4ecd2", pectoral: "#ff7a1a" },
    { tail: "#ffc928", dorsal: "#e8383d", anal: "#e8383d", pelvic: "#ffc928", body: "#ff7a1a", belly: "#ffc928", head: "#e8383d", beak: "#f4ecd2", pectoral: "#ffc928" },
    {
      tail: "#6b46c9", dorsal: "#38b6f2", anal: "#38b6f2", pelvic: "#6b46c9",
      body: { color: "#2864d8", pattern: "scales", patternColor: "#38b6f2" },
      belly: "#38b6f2", head: "#14b3a6", beak: "#f4ecd2", pectoral: "#ff6fae",
    },
  ],
};

const school: Species = {
  id: "school",
  name: "Fish School",
  note: "One drawing makes 7 fish",
  width: 900,
  height: 500,
  ink: 10,
  regions: [
    {
      id: "tail",
      d: shape([255, 230, 1], [200, 200], [120, 140], [30, 72, 1], [95, 160], [135, 250], [95, 340], [30, 428, 1], [120, 360], [200, 300], [255, 270, 1]),
      details: [line([238, 240], [140, 172], [62, 110]), line([238, 260], [140, 328], [62, 390])],
    },
    {
      id: "dorsal",
      d: shape([310, 215, 1], [305, 180], [330, 140], [390, 100], [470, 78], [560, 72], [640, 84], [700, 110], [735, 145, 1], [700, 160, 1]),
      details: strokes([362, 162, 356, 120], [432, 138, 426, 94], [502, 122, 499, 80], [572, 116, 572, 78], [642, 124, 644, 90]),
    },
    {
      id: "anal",
      d: shape([385, 340, 1], [390, 378], [430, 415], [490, 435], [545, 432], [580, 410, 1], [570, 385, 1]),
      details: strokes([432, 380, 440, 410], [490, 390, 494, 428], [545, 388, 548, 424]),
    },
    { id: "pelvic", d: shape([650, 375, 1], [630, 410], [600, 438], [572, 452, 1], [595, 415], [610, 380, 1]) },
    {
      id: "body",
      d: shape([225, 222, 1], [300, 180], [400, 135], [520, 112], [640, 115], [740, 150], [805, 200], [835, 248], [820, 290], [770, 335], [670, 378], [560, 392], [440, 375], [320, 325], [225, 280, 1]),
    },
    {
      id: "front",
      clipTo: "body",
      d: shape([520, 0, 1], [545, 130], [585, 260], [640, 380], [680, 500, 1], [900, 500, 1], [900, 0, 1]),
      details: [line([836, 256], [818, 266], [804, 268])],
    },
    {
      id: "pectoral",
      d: shape([690, 255, 1], [655, 240], [615, 242], [588, 262], [600, 285], [640, 296], [690, 282, 1]),
      details: strokes([684, 264, 612, 252], [684, 270, 596, 270], [684, 276, 616, 290]),
    },
  ],
  eyes: [{ x: 735, y: 205, r: 30 }],
  length: 100,
  speed: 95,
  school: 7,
  band: [0.2, 0.7],
  rig: { kind: "swim", beat: 11, amplitude: 0.07, waves: 0.8, sweep: 0.3, rigid: 0.6 },
  presets: [
    { tail: "#ffc928", dorsal: "#ffc928", anal: "#ffc928", pelvic: "#6b46c9", body: "#ffc928", front: "#6b46c9", pectoral: "#ffc928" },
    { tail: "#ff6fae", dorsal: "#ff7a1a", anal: "#ff7a1a", pelvic: "#ff6fae", body: "#ff7a1a", front: "#ff6fae", pectoral: "#ffc928" },
  ],
};

const shark: Species = {
  id: "shark",
  name: "Reef Shark",
  width: 1400,
  height: 520,
  ink: 8,
  regions: [
    { id: "tail", d: shape([330, 272, 1], [270, 240], [190, 170], [110, 95], [70, 58, 1], [105, 120], [150, 195], [205, 262], [175, 310], [140, 370], [115, 422, 1], [180, 385], [255, 340], [330, 310, 1]) },
    { id: "tailTip", clipTo: "tail", d: shape([40, 322, 1], [130, 368], [232, 442, 1], [0, 442, 1], [0, 322, 1]) },
    { id: "dorsal2", d: shape([505, 240, 1], [488, 212], [465, 192], [442, 186, 1], [448, 205], [432, 248, 1]) },
    { id: "anal", d: shape([470, 330, 1], [465, 360], [448, 385], [425, 398, 1], [430, 375], [415, 330, 1]) },
    { id: "pelvic", d: shape([690, 370, 1], [675, 398], [650, 415], [625, 420, 1], [632, 400], [622, 360, 1]) },
    { id: "dorsal", d: shape([1010, 215, 1], [985, 160], [945, 100], [895, 55], [862, 42, 1], [872, 95], [860, 150], [828, 205, 1], [870, 225, 1]) },
    { id: "dorsalTip", clipTo: "dorsal", d: shape([780, 112, 1], [890, 98], [1000, 72, 1], [1000, 0, 1], [780, 0, 1]) },
    {
      id: "body",
      d: shape([300, 262, 1], [420, 240], [560, 220], [720, 203], [880, 196], [1030, 200], [1160, 220], [1270, 255], [1350, 286], [1382, 305], [1350, 322], [1240, 352], [1100, 378], [940, 392], [780, 388], [620, 368], [460, 340], [300, 316, 1]),
      details: [0, 1, 2, 3, 4].map((i) => line([1118 + i * 17, 258], [1111 + i * 17, 288], [1115 + i * 17, 322])),
    },
    {
      id: "belly",
      clipTo: "body",
      d: shape([260, 300, 1], [450, 318], [700, 342], [950, 350], [1200, 330], [1400, 300, 1], [1400, 470, 1], [260, 470, 1]),
      details: [line([1336, 328], [1296, 340], [1250, 344])],
    },
    { id: "pectoral", d: shape([1135, 350, 1], [1100, 395], [1040, 440], [980, 470], [930, 485, 1], [985, 440], [1025, 400], [1050, 365, 1]) },
    { id: "pectoralTip", clipTo: "pectoral", d: shape([880, 420, 1], [960, 440], [1040, 500, 1], [1040, 560, 1], [880, 560, 1]) },
  ],
  eyes: [{ x: 1262, y: 268, r: 19 }],
  length: 430,
  speed: 60,
  school: 1,
  band: [0.35, 0.78],
  rig: { kind: "swim", beat: 4, amplitude: 0.05, waves: 0.7, sweep: 0.2, rigid: 0.66 },
  presets: [
    {
      tail: "#9aa4b0", tailTip: "#262b33", dorsal2: "#9aa4b0", anal: "#9aa4b0", pelvic: "#9aa4b0", dorsal: "#9aa4b0",
      dorsalTip: "#262b33", body: "#9aa4b0", belly: "#f4f1ea", pectoral: "#9aa4b0", pectoralTip: "#262b33",
    },
    {
      tail: "#38b6f2", tailTip: "#2864d8", dorsal2: "#38b6f2", anal: "#38b6f2", pelvic: "#38b6f2", dorsal: "#38b6f2",
      dorsalTip: "#2864d8", body: "#38b6f2", belly: "#f4f1ea", pectoral: "#38b6f2", pectoralTip: "#2864d8",
    },
  ],
};

const angelfish: Species = {
  id: "angelfish",
  name: "Angelfish",
  width: 800,
  height: 900,
  ink: 7,
  regions: [
    {
      id: "tail",
      d: shape([245, 420, 1], [185, 385], [120, 350], [68, 335, 1], [40, 400], [35, 450], [40, 500], [68, 565, 1], [120, 550], [185, 515], [245, 480, 1]),
      details: [line([228, 438], [140, 398], [70, 372]), line([228, 450], [140, 450], [48, 450]), line([228, 462], [140, 502], [70, 528])],
    },
    {
      id: "dorsal",
      d: shape([565, 268, 1], [540, 205], [480, 150], [400, 105], [310, 70], [220, 45], [130, 30, 1], [200, 85], [260, 150], [300, 215], [335, 285, 1]),
      details: [line([520, 236], [430, 160], [310, 96], [200, 52]), line([440, 250], [372, 190], [282, 128])],
    },
    {
      id: "anal",
      d: shape([565, 632, 1], [540, 695], [480, 750], [400, 795], [310, 830], [220, 855], [130, 870, 1], [200, 815], [260, 750], [300, 685], [335, 615, 1]),
      details: [line([520, 664], [430, 740], [310, 804], [200, 848]), line([440, 650], [372, 710], [282, 772])],
    },
    {
      id: "body",
      d: shape([215, 415, 1], [260, 330], [330, 265], [420, 228], [510, 225], [590, 262], [650, 330], [685, 410], [700, 455], [688, 500], [655, 585], [595, 650], [510, 690], [420, 690], [330, 650], [260, 580], [215, 488, 1]),
    },
    {
      id: "stripes",
      clipTo: "body",
      d:
        shape([300, 150, 1], [322, 450], [300, 750, 1], [355, 750, 1], [377, 450], [355, 150, 1]) +
        shape([450, 150, 1], [470, 450], [450, 750, 1], [505, 750, 1], [525, 450], [505, 150, 1]),
    },
    {
      id: "face",
      clipTo: "body",
      d: shape([590, 150, 1], [572, 300], [565, 450], [572, 600], [590, 760, 1], [800, 760, 1], [800, 150, 1]),
      details: [line([666, 478], [684, 484], [698, 470])],
    },
    {
      id: "pectoral",
      d: shape([575, 470, 1], [545, 452], [505, 458], [488, 480], [505, 502], [545, 508], [575, 492, 1]),
      details: strokes([570, 476, 505, 466], [570, 481, 492, 481], [570, 486, 505, 497]),
    },
  ],
  eyes: [{ x: 628, y: 398, r: 30 }],
  length: 165,
  speed: 45,
  school: 1,
  band: [0.2, 0.7],
  rig: { kind: "swim", beat: 5, amplitude: 0.03, waves: 0.6, sweep: 0.18, rigid: 0.55 },
  presets: [
    { tail: "#ffc928", dorsal: "#2864d8", anal: "#2864d8", body: "#ffc928", stripes: "#2864d8", face: "#38b6f2", pectoral: "#ffc928" },
    { tail: "#ffc928", dorsal: "#262b33", anal: "#262b33", body: "#f4f1ea", stripes: "#262b33", face: "#ffc928", pectoral: "#ffc928" },
  ],
};

const turtle: Species = {
  id: "turtle",
  name: "Sea Turtle",
  width: 1100,
  height: 720,
  ink: 7.5,
  regions: [
    { id: "rearFlipper", d: shape([330, 395, 1], [300, 430], [255, 460], [205, 475, 1], [245, 440], [275, 405, 1]) },
    {
      id: "head",
      d: shape([800, 300, 1], [870, 285], [940, 262], [1010, 262], [1060, 290], [1080, 325], [1062, 360], [1015, 378], [950, 385], [880, 400], [820, 410, 1]),
      details: [line([1076, 336], [1046, 346], [1008, 346])],
    },
    { id: "plastron", d: shape([300, 385, 1], [420, 395], [560, 393], [700, 385], [830, 365, 1], [800, 415], [700, 440], [560, 448], [420, 442], [320, 420]) },
    {
      id: "shell",
      d: shape([240, 392, 1], [270, 330], [340, 240], [450, 170], [570, 145], [690, 160], [790, 215], [860, 290], [885, 350, 1], [820, 375], [700, 392], [560, 400], [420, 402], [300, 400]),
    },
    {
      id: "rim",
      clipTo: "shell",
      d: shape([200, 345, 1], [400, 365], [600, 368], [800, 345], [920, 315, 1], [920, 450, 1], [200, 450, 1]),
      details: [310, 390, 470, 550, 630, 710, 790].map((x) => line([x, 350], [x - 4, 412])),
    },
    {
      id: "plates",
      clipTo: "shell",
      d:
        shape([350, 325], [378, 268], [450, 240], [498, 278], [485, 335], [415, 350]) +
        shape([525, 278], [535, 208], [610, 188], [675, 218], [665, 285], [592, 312]) +
        shape([700, 300], [715, 240], [778, 250], [825, 302], [800, 335], [738, 340]),
    },
    {
      id: "frontFlipper",
      d: shape([860, 385, 1], [835, 440], [780, 510], [700, 575], [610, 630], [520, 665, 1], [600, 600], [680, 535], [740, 470], [775, 410, 1]),
      details: [line([800, 474], [752, 452]), line([728, 548], [690, 515]), line([640, 608], [612, 585])],
    },
  ],
  eyes: [{ x: 1005, y: 302, r: 18 }],
  length: 300,
  speed: 45,
  school: 1,
  band: [0.25, 0.7],
  rig: {
    kind: "paddle",
    beat: 2.2,
    joints: [
      { pivot: [815, 398], tip: [520, 665], halfWidth: 62, amplitude: 0.45, phase: 0, rate: 1 },
      { pivot: [300, 402], tip: [205, 475], halfWidth: 34, amplitude: 0.35, phase: 2.6, rate: 1 },
      { pivot: [858, 345], tip: [1080, 325], halfWidth: 95, amplitude: 0.07, phase: 1.2, rate: 0.5 },
    ],
  },
  presets: [
    { rearFlipper: "#7aa35a", head: "#7aa35a", plastron: "#f3d58c", shell: "#8a5632", rim: "#c8954e", plates: "#a86b3a", frontFlipper: "#7aa35a" },
    { rearFlipper: "#14b3a6", head: "#14b3a6", plastron: "#ffc928", shell: "#2fae4e", rim: "#a5d93a", plates: "#ff7a1a", frontFlipper: "#14b3a6" },
  ],
};

const tentacles = [140, 215, 285, 415, 485, 560]
  .map((x, i) => {
    const s = i % 2 ? 1 : -1;
    return ribbon([[x, 380], [x + 18 * s, 500], [x - 14 * s, 620], [x + 16 * s, 740], [x - 10 * s, 860], [x + 6 * s, 955]], (t) => 16 - 10 * t);
  })
  .join("");

const oralArms = [
  [[310, 380], [296, 480], [320, 560], [298, 640], [318, 720], [302, 800]] as Pt[],
  [[392, 380], [406, 480], [384, 560], [404, 640], [386, 720], [400, 790]] as Pt[],
]
  .map((center, i) => ribbon(center, (t, side) => (64 - 36 * t) * (1 + 0.3 * Math.sin(t * 30 + (side > 0 ? 0 : 1.7) + i)), 10))
  .join("");

const jellyfish: Species = {
  id: "jellyfish",
  name: "Jellyfish",
  width: 700,
  height: 1000,
  ink: 6.5,
  regions: [
    { id: "tentacles", d: tentacles },
    { id: "arms", d: oralArms },
    {
      id: "bell",
      d: shape([95, 385, 1], [105, 270], [160, 160], [250, 85], [350, 62], [450, 85], [540, 160], [595, 270], [605, 385, 1], [560, 402], [515, 392], [470, 410], [420, 398], [375, 414], [330, 400], [285, 414], [235, 398], [190, 410], [140, 395]),
      details: [
        line([350, 80], [350, 240], [350, 400]),
        line([318, 84], [255, 230], [222, 398]),
        line([382, 84], [445, 230], [478, 398]),
        line([290, 96], [182, 236], [150, 392]),
        line([410, 96], [518, 236], [550, 392]),
      ],
    },
    { id: "rim", clipTo: "bell", d: shape([60, 300, 1], [200, 322], [350, 314], [500, 322], [640, 300, 1], [640, 450, 1], [60, 450, 1]) },
    { id: "spots", clipTo: "bell", d: circle(350, 185, 52) + circle(232, 250, 38) + circle(468, 250, 38) },
  ],
  eyes: [],
  length: 150,
  speed: 35,
  school: 1,
  band: [0.12, 0.62],
  rig: { kind: "pulse", beat: 2.6, bellEnd: 0.41, squeeze: 0.16, sway: 0.06 },
  presets: [
    { tentacles: "#ff6fae", arms: "#ffb3c9", bell: "#ffb3c9", rim: "#ff6fae", spots: "#c34bd6" },
    { tentacles: "#38b6f2", arms: "#b9e6fb", bell: "#b9e6fb", rim: "#38b6f2", spots: "#6b46c9" },
    { tentacles: "#e8383d", arms: "#ffc928", bell: "#ff7a1a", rim: "#ffc928", spots: "#e8383d" },
  ],
};

export const SPECIES: Species[] = [parrotfish, school, shark, angelfish, turtle, jellyfish];

export const speciesById = (id: string) => SPECIES.find((s) => s.id === id);
