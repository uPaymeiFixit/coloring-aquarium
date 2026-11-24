// Admin page: shows the drawings in the tank and removes any that shouldn't be there.
import { speciesById } from "../species.ts";

interface Fish {
  id: string;
  species: string;
  createdAt: number;
  url: string;
}

const list = document.getElementById("list")!;
const count = document.getElementById("count")!;

async function render() {
  const fish = ((await (await fetch("/api/fish")).json()) as Fish[]).reverse();
  count.textContent = `${fish.length} drawing${fish.length === 1 ? "" : "s"}, newest first`;
  list.replaceChildren(
    ...fish.map((f) => {
      const card = document.createElement("div");
      card.className = "fish";
      const img = document.createElement("img");
      img.src = f.url;
      img.alt = f.species;
      const info = document.createElement("small");
      info.textContent = `${speciesById(f.species)?.name ?? f.species} · ${new Date(f.createdAt).toLocaleTimeString()}`;
      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await fetch(`/api/fish/${f.id}`, { method: "DELETE" });
        render();
      });
      card.append(img, info, remove);
      return card;
    }),
  );
}

document.getElementById("clear")!.addEventListener("click", async () => {
  if (!confirm("Remove every drawing from the tank?")) return;
  await fetch("/api/fish", { method: "DELETE" });
  render();
});

// Refresh whenever a drawing arrives or leaves.
function listen() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onmessage = () => render();
  ws.onclose = () => setTimeout(listen, 2000);
}

render();
listen();
