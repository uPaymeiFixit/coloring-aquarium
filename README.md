# coloring-aquarium

Kids color a sea animal on an iPad and send it to a big screen, where it swims in a 3D reef tank with
everyone else's drawings. One small server on the local network connects the iPads and the screen.

## Run it

Needs [Bun](https://bun.sh) 1.3 or newer. Install the one library the tank uses (three.js) once, then start:

```bash
bun install
```

```bash
bun start
```

The server prints the addresses to open:

| Page | Open it on | Address |
|---|---|---|
| Coloring station | each iPad | `http://<server-ip>:8080/` |
| Tank | the TV or projector | `http://<server-ip>:8080/tank` |
| Manage the animals | a staff phone or laptop | `http://<server-ip>:8080/admin` |

Every device must be on the same network as the server. macOS asks once whether Bun may accept incoming
connections; allow it, or the iPads can't reach the server.

`bun run dev` runs the same server with hot reload while you change the code. Its hot reload sometimes keeps
serving an old page after an edit; restart it if a change doesn't show up.

## Setting up the devices

- **iPads and phones:** open the station address in Safari, then Share > Add to Home Screen, so it runs full
  screen without browser bars. Turn on Guided Access (Settings > Accessibility) to lock the device to it.
  The layout fits iPads and phones in either orientation.
- **Big screen:** open the tank address in Chrome or Safari and click once. That click turns on full screen
  and sound; browsers keep a page silent until someone clicks it. It needs WebGL 2. The cursor hides after
  three seconds without movement.
- **Keeping the big screen awake:** the tank asks the browser to stop the screen from sleeping, but browsers
  only allow that on `https` or `localhost`. Either run the tank on the server's own computer at
  `http://localhost:8080/tank`, or, on another computer's Chrome, add `http://<server-ip>:8080` under
  `chrome://flags` > "Insecure origins treated as secure" and relaunch. Otherwise turn off display sleep in
  that computer's settings.

## What happens

1. A child picks one of six animals: parrotfish, fish school, reef shark, angelfish, sea turtle or jellyfish.
2. They color it with the **Brush** (three sizes), **Fill** (tap a part, eyes included), **Patterns** (dots,
   stripes, zigzag, scales, hearts) and **Eraser**. A stroke can start anywhere on the blue drawing area;
   paint only lands inside the animal. Undo and Start over are there. Buttons, fills and brush strokes make
   little bubble-pop sounds; the page asks for media audio, so an iPhone plays them even in silent mode.
3. **Send to the tank** uploads the drawing as a PNG, and the drawing swims off the iPad screen (a jellyfish
   floats up; a fish school splits into its seven fish). The station then shows "Look at the big tank!" and
   returns to the picker after nine seconds. An abandoned drawing is dropped after two minutes without a touch.
4. On the tank, the drawing drops in from the surface with a splash and bubbles, and glows for 14 seconds so
   its owner can find it. The tank is 3D: a sand floor with moving light, coral clusters and seagrass at different
   depths, and a camera that drifts slightly so the depth shows. Drawings stay flat, like paper cutouts: they bend
   as they swim (a fish's tail sways side to side), turn in depth, and swim toward and away from the viewer as
   well as across. The turtle paddles, the jellyfish pulses, and one fish-school drawing becomes seven fish. Each
   animal swims at its own speed and keeps choosing to cross the tank, hang around by a side, down on the sand or
   back by the reef, or dart off, so they spread over the whole tank.
5. A new tank starts with eight pre-colored starter animals, and each new drawing replaces the oldest starter.
   There's no limit on drawings: every one stays in the tank until it's removed on the admin page.
6. The admin page lists every animal in the tank, starters included, and removes any of them.
   **Add starter animals** tops the starters back up to eight.

The tank's animals live in `data/` (the PNGs and `data/tank.json`), so the tank survives a server restart
exactly as the admin page left it.

## Settings

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Server port |
| `TANK_SIZE` | none | Most drawings in the tank; past it, the oldest swims away and is deleted. Each drawing takes about 1 MB of the big screen's graphics memory |
| `STARTERS` | `8` | Starter animals in a new tank, and what **Add starter animals** tops up to |
| `SEND_COOLDOWN` | `3` | Seconds one device must wait between sends |
| `DATA_DIR` | `./data` | Where the tank's animals are stored |

| Page option | Meaning |
|---|---|
| `/?idle=120` | Seconds before an untouched drawing is dropped |
| `/tank?label=0` | Hide the "Color a sea animal at …" address in the corner |

## Code

| File | What it does |
|---|---|
| `server.ts` | Bun server: the three pages, the upload and admin API, the tank's animals and PNG files, and a WebSocket that pushes tank changes to every open tank |
| `src/species.ts` | The six animals: outline art cut into colorable regions, eyes, and how each one moves |
| `src/coloring.ts` | Canvas drawing shared by the station and the tank: white base, ink lines, region fills, patterns |
| `src/station/` | The iPad coloring page |
| `src/display/` | The tank: the three.js scene and animals (`main.ts`), their shaders (`shaders.ts`), the painted scenery (`reef.ts`), and how the animals move in 3D (`swim.ts`) |
| `src/admin/` | The page that lists and removes the tank's animals and adds the starters back |

Each animal in `src/species.ts` is a list of regions in drawing order; a later region covers earlier ones, and
`clipTo` limits a region to the inside of another (a belly band inside the body, say). The tank bends the
finished PNG on a mesh: `swim` sends a wave down a fish's body, `paddle` rocks limbs about pivot points, and
`pulse` squeezes a jellyfish bell. `bun run check` type-checks everything.

## Not done yet

- No sign-in: anyone on the network can send drawings or open the admin page.
- Tested in desktop Chrome at iPad sizes, not on a real iPad, TV or projector.
- A drawing removed on the admin page (or pushed out by `TANK_SIZE`) is deleted; nothing is archived.
