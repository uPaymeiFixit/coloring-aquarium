// Coloring station: a child picks a sea animal, colors it with fills, a brush and patterns, and sends it to the tank.
import {
  PALETTE, compile, drawBase, drawInk, fillRegion, finish, makeCanvas, outlineImage, patternTile, regionAt,
  type Template,
} from "../coloring.ts";
import { enableSound, pop } from "../sounds.ts";
import { PATTERNS, SPECIES, type PatternKind, type Species } from "../species.ts";

type Tool = "fill" | "brush" | "pattern" | "eraser";
type Point = { x: number; y: number };

/** Brush widths as a fraction of the template width. A new drawing starts on the middle one. */
const BRUSH_SIZES = [0.02, 0.045, 0.085];
const DEFAULT_BRUSH = 1;
/** How far a stroke goes between soft pops, as a fraction of the template width. */
const POP_STEP = 0.05;
const UNDO_LIMIT = 12;
/** Seconds without a touch before an unfinished drawing is dropped for the next child. */
const IDLE_SECONDS = Number(new URLSearchParams(location.search).get("idle") ?? 120);
/** Size of the image sent to the tank, in pixels on its longest side. */
const SEND_SIDE = 800;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T;
const paintCanvas = $<HTMLCanvasElement>("#paint");
const inkCanvas = $<HTMLCanvasElement>("#ink");
const paint = paintCanvas.getContext("2d")!;
const frame = $("#frame");
const stage = $("#stage");
const sendButton = $<HTMLButtonElement>("#send");

let template: Template | null = null;
let scale = 1;
let tool: Tool = "brush";
let color = PALETTE[6];
let brush = DEFAULT_BRUSH;
let pattern: PatternKind = "dots";
let undoStack: HTMLCanvasElement[] = [];
let painted = false;
let lastTouch = Date.now();
let sentTimer = 0;

function show(screen: "pick" | "color" | "sent") {
  document.body.dataset.screen = screen;
}

function buildPicker() {
  const list = $("#animals");
  for (const species of SPECIES) {
    const card = document.createElement("button");
    card.className = "animal";
    const name = document.createElement("b");
    name.textContent = species.name;
    card.append(outlineImage(compile(species), 420), name);
    if (species.note) {
      const note = document.createElement("small");
      note.textContent = species.note;
      card.append(note);
    }
    card.addEventListener("click", () => open(species));
    list.append(card);
  }
}

function open(species: Species) {
  template = compile(species);
  $("#title").textContent = `Color your ${species.name.toLowerCase()}`;
  show("color");
  // Size the drawing for this screen once; rotating the iPad later only rescales it.
  const box = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = Math.min((box.width - 32) / species.width, (box.height - 32) / species.height);
  scale = Math.min(fit * dpr, 1600 / species.width);
  for (const c of [paintCanvas, inkCanvas]) {
    c.width = Math.round(species.width * scale);
    c.height = Math.round(species.height * scale);
  }
  drawBase(paint, template, scale);
  const ink = inkCanvas.getContext("2d")!;
  ink.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
  drawInk(ink, template, scale);
  undoStack = [];
  painted = false;
  fitFrame();
  brush = DEFAULT_BRUSH;
  selectTool("brush");
  refresh();
  touched();
}

function fitFrame() {
  if (!template) return;
  const s = template.species;
  const box = stage.getBoundingClientRect();
  const fit = Math.min((box.width - 32) / s.width, (box.height - 32) / s.height);
  frame.style.width = `${Math.floor(s.width * fit)}px`;
  frame.style.height = `${Math.floor(s.height * fit)}px`;
}

function goPick() {
  template = null;
  clearTimeout(sentTimer);
  show("pick");
}

// Tools, colors and options

function selectTool(next: Tool) {
  tool = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    b.classList.toggle("active", b.dataset.tool === tool);
  }
  renderOptions();
}

function selectColor(next: string) {
  color = next;
  document.documentElement.style.setProperty("--current", color);
  for (const b of document.querySelectorAll<HTMLButtonElement>(".palette button")) {
    b.classList.toggle("active", b.dataset.color === color);
  }
  if (tool === "eraser") selectTool("brush");
  else renderOptions();
}

function renderOptions() {
  const bar = $("#options");
  bar.replaceChildren();
  if (tool === "fill") {
    bar.textContent = "Tap a part of the animal to fill it";
    return;
  }
  if (tool === "pattern") {
    for (const kind of PATTERNS) {
      const b = document.createElement("button");
      b.classList.toggle("active", kind === pattern);
      b.setAttribute("aria-label", kind);
      const swatch = makeCanvas(96, 96);
      const g = swatch.getContext("2d")!;
      g.fillStyle = g.createPattern(patternTile(kind, color, 40), "repeat")!;
      g.fillRect(0, 0, 96, 96);
      b.append(swatch);
      b.addEventListener("click", () => {
        pattern = kind;
        renderOptions();
      });
      bar.append(b);
    }
    return;
  }
  BRUSH_SIZES.forEach((_, i) => {
    const b = document.createElement("button");
    b.classList.toggle("active", i === brush);
    b.setAttribute("aria-label", ["Small", "Medium", "Large"][i]);
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.width = dot.style.height = `${12 + i * 14}px`;
    if (tool === "eraser") dot.style.background = "#fff";
    b.append(dot);
    b.addEventListener("click", () => {
      brush = i;
      renderOptions();
    });
    bar.append(b);
  });
}

function buildPalette() {
  const list = $("#palette");
  for (const c of PALETTE) {
    const b = document.createElement("button");
    b.dataset.color = c;
    b.style.background = c;
    b.setAttribute("aria-label", c);
    b.addEventListener("click", () => selectColor(c));
    list.append(b);
  }
}

function refresh() {
  ($<HTMLButtonElement>("#undo")).disabled = undoStack.length === 0;
  sendButton.classList.toggle("ready", painted);
}

// Painting

function pushUndo() {
  const copy = makeCanvas(paintCanvas.width, paintCanvas.height);
  copy.getContext("2d")!.drawImage(paintCanvas, 0, 0);
  undoStack.push(copy);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  refresh();
}

function undo() {
  const last = undoStack.pop();
  if (!last) return;
  paint.save();
  paint.setTransform(1, 0, 0, 1, 0, 0);
  paint.globalCompositeOperation = "copy";
  paint.drawImage(last, 0, 0);
  paint.restore();
  refresh();
}

function restart() {
  if (!template) return;
  pushUndo();
  paint.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  drawBase(paint, template, scale);
}

function toTemplate(e: PointerEvent): Point {
  const r = paintCanvas.getBoundingClientRect();
  const s = template!.species;
  return { x: ((e.clientX - r.left) / r.width) * s.width, y: ((e.clientY - r.top) / r.height) * s.height };
}

let activePointer: number | null = null;
/** The stroke being drawn; `travel` is how far it has gone since the last pop, in template units. */
let stroke: { last: Point; mid: Point; travel: number } | null = null;
let lastStrokePop = 0;

function brushStyle() {
  paint.setTransform(scale, 0, 0, scale, 0, 0);
  // source-atop keeps paint inside the animal: it only lands on pixels that are already there.
  paint.globalCompositeOperation = "source-atop";
  paint.strokeStyle = paint.fillStyle = tool === "eraser" ? "#ffffff" : color;
  paint.lineWidth = BRUSH_SIZES[brush] * template!.species.width;
  paint.lineCap = paint.lineJoin = "round";
}

function strokeStart(p: Point) {
  paint.save();
  brushStyle();
  paint.beginPath();
  paint.arc(p.x, p.y, paint.lineWidth / 2, 0, Math.PI * 2);
  paint.fill();
  paint.restore();
  stroke = { last: p, mid: p, travel: 0 };
  pop(1.1, 0.25);
}

function strokeTo(p: Point) {
  if (!stroke) return;
  const mid = { x: (stroke.last.x + p.x) / 2, y: (stroke.last.y + p.y) / 2 };
  paint.save();
  brushStyle();
  paint.beginPath();
  paint.moveTo(stroke.mid.x, stroke.mid.y);
  paint.quadraticCurveTo(stroke.last.x, stroke.last.y, mid.x, mid.y);
  paint.stroke();
  paint.restore();
  let travel = stroke.travel + Math.hypot(p.x - stroke.last.x, p.y - stroke.last.y);
  // Soft bubble pops at random pitches every short stretch of the stroke, no faster than 11 a second.
  if (travel > POP_STEP * template!.species.width && performance.now() - lastStrokePop > 90) {
    travel = 0;
    lastStrokePop = performance.now();
    pop(0.8 + Math.random() * 0.6, 0.15);
  }
  stroke = { last: p, mid, travel };
}

function strokeEnd() {
  if (stroke) {
    paint.save();
    brushStyle();
    paint.beginPath();
    paint.moveTo(stroke.mid.x, stroke.mid.y);
    paint.lineTo(stroke.last.x, stroke.last.y);
    paint.stroke();
    paint.restore();
  }
  stroke = null;
}

// The whole blue drawing area takes strokes, not just the animal's box, so a stroke that starts beside the
// animal still paints once it reaches it.
stage.addEventListener("pointerdown", (e) => {
  if (!template || activePointer !== null) return;
  e.preventDefault();
  touched();
  const p = toTemplate(e);
  if (tool === "fill" || tool === "pattern") {
    const region = regionAt(template, p.x, p.y);
    if (region < 0) return;
    pushUndo();
    fillRegion(paint, template, region, tool === "pattern" ? { color, pattern } : { color }, scale);
    pop(0.75, 0.4);
  } else {
    activePointer = e.pointerId;
    stage.setPointerCapture(e.pointerId);
    pushUndo();
    strokeStart(p);
  }
  painted = true;
  refresh();
});

stage.addEventListener("pointermove", (e) => {
  if (e.pointerId !== activePointer) return;
  const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) strokeTo(toTemplate(ev));
});

const release = (e: PointerEvent) => {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  strokeEnd();
};
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);

// Sending

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Encodes the drawing and posts it to the server; resolves with the PNG that was sent. */
async function upload(t: Template): Promise<Blob> {
  const image = finish(paintCanvas, t, SEND_SIDE);
  const blob = await new Promise<Blob>((resolve, reject) =>
    image.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the drawing"))), "image/png"),
  );
  const res = await fetch(`/api/fish?species=${encodeURIComponent(t.species.id)}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
    signal: timeoutSignal(10000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return blob;
}

async function send() {
  if (!template) return;
  const species = template.species;
  sendButton.disabled = true;
  try {
    const blob = await upload(template);
    template = null;
    pop(1, 0.35);
    pop(1.5, 0.35, 0.12);
    document.body.classList.add("busy");
    await swimOff(blob, species).catch((err) => console.warn("Swim-off animation failed", err));
    showSent(species);
  } catch (err) {
    console.error("Send failed", err);
    toast("The tank didn't get it. Try again!");
  } finally {
    document.body.classList.remove("busy");
    sendButton.disabled = false;
  }
}

/**
 * The drawing leaves the iPad: it pulls back, then swims off the right edge with its tail wagging (a jellyfish
 * pulses and floats up instead), trailing bubbles. A fish school splits into its fish first.
 */
async function swimOff(blob: Blob, species: Species) {
  const box = frame.getBoundingClientRect();
  const url = URL.createObjectURL(blob);
  const art = new Image();
  art.src = url;
  await art.decode();
  const layer = document.createElement("div");
  layer.className = "swim-layer";
  document.body.append(layer);
  frame.style.visibility = "hidden";

  const floats = species.rig.kind === "pulse";
  const many = species.school > 1;
  const swims: Promise<Animation>[] = [];
  for (let k = 0; k < species.school; k++) {
    const w = box.width * (many ? 0.4 : 1), h = box.height * (many ? 0.4 : 1);
    const x = box.left + (many ? (box.width - w) * Math.random() : 0);
    const y = box.top + (many ? (box.height - h) * Math.random() : 0);
    const swimmer = document.createElement("div");
    swimmer.className = floats ? "swimmer floats" : "swimmer";
    Object.assign(swimmer.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const copy = art.cloneNode() as HTMLImageElement;
    swimmer.append(copy);
    layer.append(swimmer);
    const delay = k * 90;
    const windUp = floats ? "translate(0, 22px)" : "translate(-28px, 0)";
    const away = floats
      ? `translate(0, ${-(y + h + 60)}px) scale(0.75)`
      : `translate(${innerWidth - x + 60}px, ${-h * 0.25}px) scale(0.7)`;
    swims.push(
      swimmer.animate(
        [
          { transform: "none", easing: "ease-out" },
          { transform: windUp, offset: 0.2, easing: "cubic-bezier(0.5, 0, 0.85, 0.35)" },
          { transform: away },
        ],
        { duration: 1700, delay, fill: "forwards" },
      ).finished,
    );
    copy.animate(
      floats
        ? [{ transform: "scale(1, 1)" }, { transform: "scale(0.85, 1.08)" }, { transform: "scale(1, 1)" }]
        : [
            { transform: "none" },
            { transform: "skewY(6deg) rotate(-3deg)" },
            { transform: "none" },
            { transform: "skewY(-6deg) rotate(3deg)" },
            { transform: "none" },
          ],
      { duration: floats ? 560 : 420, delay, iterations: Infinity },
    );
  }

  for (let i = 0; i < 16; i++) {
    const bubble = document.createElement("i");
    bubble.className = "swim-bubble";
    const size = 8 + Math.random() * 18;
    Object.assign(bubble.style, {
      left: `${box.left + box.width * (0.1 + Math.random() * 0.6)}px`,
      top: `${box.top + box.height * (0.25 + Math.random() * 0.6)}px`,
      width: `${size}px`,
      height: `${size}px`,
    });
    layer.append(bubble);
    bubble.animate(
      [
        { transform: "translateY(0) scale(0.5)", opacity: 0 },
        { opacity: 0.9, offset: 0.15 },
        { transform: `translateY(${-(120 + Math.random() * 180)}px) scale(1)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 700, delay: 150 + Math.random() * 1000, easing: "ease-out", fill: "both" },
    );
  }

  await Promise.all(swims);
  layer.remove();
  URL.revokeObjectURL(url);
  frame.style.visibility = "";
}

function showSent(species: Species) {
  $("#sent-text").textContent =
    species.school > 1
      ? `Your fish school is swimming in: ${species.school} fish!`
      : `Your ${species.name.toLowerCase()} is swimming in.`;
  show("sent");
  clearTimeout(sentTimer);
  sentTimer = window.setTimeout(goPick, 9000);
}

let toastTimer = 0;
function toast(message: string) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3500);
}

// Kiosk behavior: drop abandoned drawings and block the zoom and selection gestures.

function touched() {
  lastTouch = Date.now();
}

setInterval(() => {
  if (document.body.dataset.screen === "color" && Date.now() - lastTouch > IDLE_SECONDS * 1000) goPick();
}, 1000);

enableSound();
document.addEventListener(
  "pointerdown",
  (e) => {
    touched();
    if (e.target instanceof Element && e.target.closest("button")) pop();
  },
  { capture: true },
);
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault());
window.addEventListener("resize", fitFrame);

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
  b.addEventListener("click", () => selectTool(b.dataset.tool as Tool));
}
$("#undo").addEventListener("click", undo);
$("#restart").addEventListener("click", restart);
$("#back").addEventListener("click", goPick);
$("#again").addEventListener("click", goPick);
sendButton.addEventListener("click", send);

buildPicker();
buildPalette();
selectColor(color);
