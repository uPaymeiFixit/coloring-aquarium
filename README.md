# coloring-aquarium

Kids color a sea animal on an iPad and send it to a big screen, where it swims in a virtual reef tank
with everyone else's drawings. One small server on the local network connects the iPads and the screen.

## Run it

Needs [Bun](https://bun.sh) 1.3 or newer. Nothing else is installed to run it.

```bash
bun start
```

The server prints the addresses to open:

| Page | Open it on | Address |
|---|---|---|
| Coloring station | each iPad | `http://<server-ip>:8080/` |
| Tank | the TV or projector | `http://<server-ip>:8080/tank` |
| Remove drawings | a staff phone or laptop | `http://<server-ip>:8080/admin` |

Every device must be on the same network as the server. macOS asks once whether Bun may accept incoming
connections; allow it, or the iPads can't reach the server.

`bun run dev` runs the same server with hot reload while you change the code.

## Setting up the devices

- **iPads:** open the station address in Safari, then Share > Add to Home Screen, so it runs full screen
  without browser bars. Turn on Guided Access (Settings > Accessibility) to lock the iPad to it.
- **Big screen:** open the tank address in Chrome or Safari and click once for full screen. It needs WebGL 2.
  The cursor hides after three seconds without movement.

## What happens

1. A child picks one of six animals: parrotfish, fish school, reef shark, angelfish, sea turtle or jellyfish.
2. They color it with the **Brush** (four sizes; it starts on the second-smallest), **Fill** (tap a part),
   **Patterns** (dots, stripes, zigzag, scales, hearts) and **Eraser**. Paint stays inside the animal; Undo and
   Start over are there.
3. **Send to the tank** uploads the drawing as a PNG, and the drawing swims off the iPad screen (a jellyfish
   floats up; a fish school splits into its seven fish). The station then shows "Look at the big tank!" and
   returns to the picker after nine seconds. An abandoned drawing is dropped after two minutes without a touch.
4. On the tank, the drawing drops in from the surface with bubbles and glows for 14 seconds so its owner can
   find it. Fish bend as they swim, the turtle paddles, the jellyfish pulses, and one fish-school drawing
   becomes seven fish.
5. The tank keeps the newest 30 drawings. When the 31st arrives, the oldest swims away and its file is deleted.
   Until eight drawings have arrived, starter animals fill the tank and leave one by one as drawings come in.

Drawings live in `data/` (the PNGs and `data/tank.json`), so the tank survives a server restart.

## Settings

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Server port |
| `TANK_SIZE` | `30` | Drawings kept in the tank |
| `SEND_COOLDOWN` | `3` | Seconds one device must wait between sends |
| `DATA_DIR` | `./data` | Where drawings are stored |

| Page option | Meaning |
|---|---|
| `/?idle=120` | Seconds before an untouched drawing is dropped |
| `/tank?starters=8` | Starter animals shown until that many drawings arrive (`0` for none) |
| `/tank?label=0` | Hide the "Color a sea animal at …" address in the corner |

## Code

| File | What it does |
|---|---|
| `server.ts` | Bun server: the three pages, the upload and admin API, the PNG files, and a WebSocket that pushes tank changes to every open tank |
| `src/species.ts` | The six animals: outline art cut into colorable regions, eyes, and how each one moves |
| `src/coloring.ts` | Canvas drawing shared by the station and the tank: white base, ink lines, region fills, patterns |
| `src/station/` | The iPad coloring page |
| `src/display/` | The tank: WebGL renderer (`main.ts`, `shaders.ts`, `gl.ts`) and the painted reef backdrop (`reef.ts`) |
| `src/admin/` | The page that removes drawings |

Each animal in `src/species.ts` is a list of regions in drawing order; a later region covers earlier ones, and
`clipTo` limits a region to the inside of another (a belly band inside the body, say). The tank bends the
finished PNG on a mesh: `swim` sends a wave down a fish's body, `paddle` rocks limbs about pivot points, and
`pulse` squeezes a jellyfish bell. `bun run check` type-checks everything (run `bun install` first).

## Not done yet

- No sign-in: anyone on the network can send drawings or open the admin page.
- Tested in desktop Chrome at iPad sizes, not on a real iPad, TV or projector.
- Drawings are deleted when they leave the tank; nothing is archived.
