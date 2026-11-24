// Admin page: lists every animal in the tank (children's drawings and the pre-colored starters), removes any of
// them, and puts the starters back.
import { compile, presetImage } from "../coloring.ts";
import { speciesById } from "../species.ts";

interface Fish {
  id: string;
  species: string;
  createdAt: number;
  url?: string;
  preset?: number;
}

const list = document.getElementById("list")!;
const count = document.getElementById("count")!;

/** The drawing as sent, or for a starter, its preset coloring drawn here. */
function picture(f: Fish): HTMLElement {
  const species = speciesById(f.species);
  if (f.preset !== undefined && species) {
    const art = presetImage(compile(species), species.presets[f.preset % species.presets.length], 400);
    art.className = "art";
    return art;
  }
  const img = document.createElement("img");
  img.className = "art";
  img.src = f.url ?? "";
  img.alt = f.species;
  return img;
}

async function render() {
  const fish = ((await (await fetch("/api/fish")).json()) as Fish[]).reverse();
  const starters = fish.filter((f) => f.preset !== undefined).length;
  count.textContent = `${fish.length - starters} drawn by children, ${starters} starters; newest first`;
  list.replaceChildren(
    ...fish.map((f) => {
      const card = document.createElement("div");
      card.className = "fish";
      const name = speciesById(f.species)?.name ?? f.species;
      const info = document.createElement("small");
      info.textContent = f.preset === undefined ? `${name} · ${new Date(f.createdAt).toLocaleTimeString()}` : `${name} · starter`;
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await fetch(`/api/fish/${f.id}`, { method: "DELETE" });
        render();
      });
      card.append(picture(f), info, remove);
      return card;
    }),
  );
}

document.getElementById("starters")!.addEventListener("click", async () => {
  await fetch("/api/starters", { method: "POST" });
  render();
});

document.getElementById("clear")!.addEventListener("click", async () => {
  if (!confirm("Remove every animal from the tank, starters included?")) return;
  await fetch("/api/fish", { method: "DELETE" });
  render();
});

// Refresh when animals arrive or leave; a burst of changes refreshes once.
let refreshTimer = 0;
function listen() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onmessage = () => {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(render, 150);
  };
  ws.onclose = () => setTimeout(listen, 2000);
}

render();
listen();
