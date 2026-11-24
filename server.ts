// Local server for the coloring aquarium. Serves the coloring station, the tank display and the admin page,
// keeps the tank's animals (children's drawings and pre-colored starters) on disk, and pushes every change
// to open tank displays over a WebSocket.
import { mkdir, rename, unlink } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import adminPage from "./src/admin/index.html";
import tankPage from "./src/display/index.html";
import stationPage from "./src/station/index.html";
import { speciesById } from "./src/species.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dir, "data");
/** Drawings kept in the tank. When a new one arrives past this, the oldest swims away and is deleted. */
const TANK_SIZE = Number(process.env.TANK_SIZE ?? 30);
/** Pre-colored starter animals put in an empty tank. Each new drawing replaces the oldest one. */
const STARTERS = Number(process.env.STARTERS ?? 8);
/** Seconds a station must wait between sends. */
const SEND_COOLDOWN = Number(process.env.SEND_COOLDOWN ?? 3);
const MAX_UPLOAD = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const STARTER_PLAN = ["parrotfish", "jellyfish", "school", "angelfish", "turtle", "parrotfish", "shark", "jellyfish"];

const FISH_DIR = join(DATA_DIR, "fish");
const TANK_FILE = join(DATA_DIR, "tank.json");

/** One animal in the tank: a child's drawing (`url`), or a starter the tank draws from a preset coloring. */
interface Fish {
  id: string;
  species: string;
  createdAt: number;
  url?: string;
  preset?: number;
}

const imagePath = (id: string) => join(FISH_DIR, `${id}.png`);
const newId = () => `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const isStarter = (f: Fish) => f.preset !== undefined;

await mkdir(FISH_DIR, { recursive: true });
const saved = await loadTank();
let tank = saved.fish;
// A new tank gets its starters, one fewer for each drawing already in it. After that the tank keeps whatever
// the admin page leaves in it, across restarts.
if (saved.isNew) {
  addStarters(STARTERS - tank.length);
  await saveTank();
}
const lastSend = new Map<string, number>();

/**
 * The saved animals. `isNew` is true when nothing was saved yet, or when the save predates starters living
 * on the server (a bare list of drawings).
 */
async function loadTank(): Promise<{ fish: Fish[]; isNew: boolean }> {
  const file = Bun.file(TANK_FILE);
  if (!(await file.exists())) return { fish: [], isNew: true };
  try {
    const content = (await file.json()) as Fish[] | { fish: Fish[] };
    const kept: Fish[] = [];
    for (const f of Array.isArray(content) ? content : content.fish) {
      const species = speciesById(f.species);
      if (!species) continue;
      if (isStarter(f) ? f.preset! < species.presets.length : await Bun.file(imagePath(f.id)).exists()) kept.push(f);
    }
    const drawings = kept.filter((f) => !isStarter(f));
    const dropped = new Set(drawings.slice(0, Math.max(0, drawings.length - TANK_SIZE)));
    for (const f of dropped) await unlink(imagePath(f.id)).catch(() => {});
    return { fish: kept.filter((f) => !dropped.has(f)), isNew: Array.isArray(content) };
  } catch (err) {
    console.warn(`Starting with an empty tank: could not read ${TANK_FILE}: ${err}`);
    return { fish: [], isNew: true };
  }
}

async function saveTank() {
  const tmp = `${TANK_FILE}.tmp`;
  await Bun.write(tmp, JSON.stringify({ fish: tank }, null, 2));
  await rename(tmp, TANK_FILE);
}

/** Adds starters until there are `target` of them, cycling through the plan and each species' preset colorings. */
function addStarters(target: number): Fish[] {
  const added: Fish[] = [];
  for (let k = tank.filter(isStarter).length; k < target; k++) {
    const species = STARTER_PLAN[k % STARTER_PLAN.length];
    const sameSpecies = tank.filter((f) => isStarter(f) && f.species === species).length;
    const starter: Fish = { id: newId(), species, createdAt: Date.now(), preset: sameSpecies % speciesById(species)!.presets.length };
    tank.push(starter);
    added.push(starter);
  }
  return added;
}

function publish(message: object) {
  server.publish("tank", JSON.stringify(message));
}

async function forget(gone: Fish[]) {
  for (const f of gone) {
    publish({ type: "remove", id: f.id });
    if (!isStarter(f)) await unlink(imagePath(f.id)).catch(() => {});
  }
}

async function addFish(req: Request, sender: string): Promise<Response> {
  const species = new URL(req.url).searchParams.get("species") ?? "";
  if (!speciesById(species)) return new Response("Unknown animal", { status: 400 });
  const now = Date.now();
  if (now - (lastSend.get(sender) ?? 0) < SEND_COOLDOWN * 1000) {
    return new Response("Sending too fast; try again in a moment", { status: 429 });
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_UPLOAD || body.length < 64 || PNG_SIGNATURE.some((b, i) => body[i] !== b)) {
    return new Response("Expected a PNG image", { status: 400 });
  }
  lastSend.set(sender, now);

  const id = newId();
  await Bun.write(imagePath(id), body);
  const fish: Fish = { id, species, createdAt: now, url: `/fish/${id}.png` };
  tank.push(fish);
  // The drawing replaces the oldest starter while any are left; past TANK_SIZE the oldest drawing goes too.
  const drawings = tank.filter((f) => !isStarter(f));
  const gone = [tank.find(isStarter), ...drawings.slice(0, Math.max(0, drawings.length - TANK_SIZE))].filter(
    (f): f is Fish => f !== undefined,
  );
  tank = tank.filter((f) => !gone.includes(f));
  await saveTank();
  publish({ type: "add", fish });
  await forget(gone);
  console.log(`New ${species} from ${sender} (${Math.round(body.length / 1024)} KB); ${tank.length} in the tank`);
  return Response.json({ id }, { status: 201 });
}

async function removeFish(id: string): Promise<Response> {
  const gone = tank.filter((f) => f.id === id);
  if (!gone.length) return new Response("Not found", { status: 404 });
  tank = tank.filter((f) => f.id !== id);
  await saveTank();
  await forget(gone);
  return new Response(null, { status: 204 });
}

async function clearTank(): Promise<Response> {
  const gone = tank;
  tank = [];
  await saveTank();
  await forget(gone);
  return new Response(null, { status: 204 });
}

async function restoreStarters(): Promise<Response> {
  const added = addStarters(STARTERS);
  await saveTank();
  for (const fish of added) publish({ type: "add", fish });
  return Response.json(added, { status: 201 });
}

async function serveImage(file: string): Promise<Response> {
  if (!/^[a-z0-9-]+\.png$/.test(file)) return new Response("Not found", { status: 404 });
  const image = Bun.file(join(FISH_DIR, file));
  if (!(await image.exists())) return new Response("Not found", { status: 404 });
  return new Response(image, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}

/** Addresses other devices on the network can use, plus localhost. */
function addresses(path: string): string[] {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a!.address}:${server.port}${path}`);
  return [...lan, `http://localhost:${server.port}${path}`];
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  development: process.env.NODE_ENV === "production" ? false : { hmr: true, console: true },
  maxRequestBodySize: MAX_UPLOAD,
  routes: {
    "/": stationPage,
    "/tank": tankPage,
    "/admin": adminPage,
    "/api/fish": {
      GET: () => Response.json(tank),
      POST: (req, srv) => addFish(req, srv.requestIP(req)?.address ?? "unknown"),
      DELETE: () => clearTank(),
    },
    "/api/fish/:id": { DELETE: (req) => removeFish(req.params.id) },
    "/api/starters": { POST: () => restoreStarters() },
    "/api/info": () => Response.json({ station: addresses("/"), tank: addresses("/tank") }),
    "/fish/:file": (req) => serveImage(req.params.file),
  },
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws" && srv.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("tank");
      ws.send(JSON.stringify({ type: "snapshot", fish: tank }));
    },
    message() {},
  },
});

const [lanStation] = addresses("/");
console.log(`Coloring aquarium is running (${tank.length} animals in the tank).
  Coloring station (iPads):  ${lanStation}
  Tank (big screen):         ${lanStation}tank
  Manage the animals:        ${lanStation}admin`);
