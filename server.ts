// Local server for the coloring aquarium. Serves the coloring station, the tank display and the admin page,
// keeps the drawings currently in the tank on disk, and pushes every change to open tank displays over a WebSocket.
import { mkdir, rename, unlink } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import adminPage from "./src/admin/index.html";
import tankPage from "./src/display/index.html";
import stationPage from "./src/station/index.html";
import { SPECIES } from "./src/species.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? join(import.meta.dir, "data");
/** Drawings kept in the tank. When a new one arrives past this, the oldest swims away and is deleted. */
const TANK_SIZE = Number(process.env.TANK_SIZE ?? 30);
/** Seconds a station must wait between sends. */
const SEND_COOLDOWN = Number(process.env.SEND_COOLDOWN ?? 3);
const MAX_UPLOAD = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const FISH_DIR = join(DATA_DIR, "fish");
const TANK_FILE = join(DATA_DIR, "tank.json");
const speciesIds = new Set(SPECIES.map((s) => s.id));

interface Fish {
  id: string;
  species: string;
  createdAt: number;
  url: string;
}

const imagePath = (id: string) => join(FISH_DIR, `${id}.png`);

await mkdir(FISH_DIR, { recursive: true });
let tank = await loadTank();
const lastSend = new Map<string, number>();

async function loadTank(): Promise<Fish[]> {
  const file = Bun.file(TANK_FILE);
  if (!(await file.exists())) return [];
  try {
    const saved = (await file.json()) as Fish[];
    const kept: Fish[] = [];
    for (const f of saved) {
      if (speciesIds.has(f.species) && (await Bun.file(imagePath(f.id)).exists())) kept.push(f);
    }
    return kept.slice(-TANK_SIZE);
  } catch (err) {
    console.warn(`Starting with an empty tank: could not read ${TANK_FILE}: ${err}`);
    return [];
  }
}

async function saveTank() {
  const tmp = `${TANK_FILE}.tmp`;
  await Bun.write(tmp, JSON.stringify(tank, null, 2));
  await rename(tmp, TANK_FILE);
}

function publish(message: object) {
  server.publish("tank", JSON.stringify(message));
}

async function forget(gone: Fish[]) {
  for (const f of gone) {
    publish({ type: "remove", id: f.id });
    await unlink(imagePath(f.id)).catch(() => {});
  }
}

async function addFish(req: Request, sender: string): Promise<Response> {
  const species = new URL(req.url).searchParams.get("species") ?? "";
  if (!speciesIds.has(species)) return new Response("Unknown animal", { status: 400 });
  const now = Date.now();
  if (now - (lastSend.get(sender) ?? 0) < SEND_COOLDOWN * 1000) {
    return new Response("Sending too fast; try again in a moment", { status: 429 });
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_UPLOAD || body.length < 64 || PNG_SIGNATURE.some((b, i) => body[i] !== b)) {
    return new Response("Expected a PNG image", { status: 400 });
  }
  lastSend.set(sender, now);

  const id = `${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await Bun.write(imagePath(id), body);
  const fish: Fish = { id, species, createdAt: now, url: `/fish/${id}.png` };
  tank.push(fish);
  const evicted = tank.splice(0, Math.max(0, tank.length - TANK_SIZE));
  await saveTank();
  publish({ type: "add", fish });
  await forget(evicted);
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
console.log(`Coloring aquarium is running (${tank.length} drawings in the tank).
  Coloring station (iPads):  ${lanStation}
  Tank (big screen):         ${lanStation}tank
  Remove drawings:           ${lanStation}admin`);
