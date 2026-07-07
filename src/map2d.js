// ============================================================
// map2d.js — Plano cenital interactivo del estadio (SVG)
// Dibuja la cancha y las secciones a partir de los mismos datos
// del mundo 3D (coordenadas reales: x → x, z → y del plano).
// Clic en sección → zoom y asientos individuales clicables.
// ============================================================
import { PITCH_L, PITCH_W } from "./stadium.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function hex(color) {
  return "#" + color.toString(16).padStart(6, "0");
}

// aclara un color hexadecimal (para hover / asientos libres)
function lighten(color, f) {
  const r = Math.min(255, ((color >> 16) & 255) + f);
  const g = Math.min(255, ((color >> 8) & 255) + f);
  const b = Math.min(255, (color & 255) + f);
  return `rgb(${r},${g},${b})`;
}

export function createMap2D({ svg, sections, seatById, onSectionPick, onSeatPick }) {
  // --- límites del mundo (planta) ---
  let minX = -PITCH_L / 2, maxX = PITCH_L / 2, minZ = -PITCH_W / 2, maxZ = PITCH_W / 2;
  for (const s of sections) {
    minX = Math.min(minX, s.bbox.minX);
    maxX = Math.max(maxX, s.bbox.maxX);
    minZ = Math.min(minZ, s.bbox.minZ);
    maxZ = Math.max(maxZ, s.bbox.maxZ);
  }
  const PAD = 6;
  const fullVB = [minX - PAD, minZ - PAD, maxX - minX + PAD * 2, maxZ - minZ + PAD * 2];

  svg.setAttribute("viewBox", fullVB.join(" "));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // --- capas ---
  const gPitch = el("g", { class: "m2-pitch" }, svg);
  const gSections = el("g", { class: "m2-sections" }, svg);
  const gSeats = el("g", { class: "m2-seats" }, svg);

  drawPitch(gPitch);

  // --- secciones ---
  const sectionEls = new Map();
  for (const sec of sections) {
    const b = sec.bbox;
    const m = 0.6; // margen alrededor de los asientos
    const rect = el("rect", {
      x: b.minX - m, y: b.minZ - m,
      width: b.maxX - b.minX + m * 2, height: b.maxZ - b.minZ + m * 2,
      rx: 1.2,
      fill: hex(sec.color),
      class: "m2-section",
      "data-id": sec.id,
    }, gSections);

    const label = el("text", {
      x: (b.minX + b.maxX) / 2,
      y: (b.minZ + b.maxZ) / 2,
      class: "m2-label",
      "text-anchor": "middle",
      "dominant-baseline": "central",
    }, gSections);
    label.textContent = sec.id;

    const title = el("title", {}, rect);
    title.textContent = `${sec.standLabel} · Sección ${sec.id}`;

    rect.addEventListener("click", () => onSectionPick(sec));
    label.style.pointerEvents = "none";
    sectionEls.set(sec.id, { rect, label });
  }

  // --- estado ---
  let focused = null;      // sección con asientos desplegados
  let selectedSeatEl = null;
  const seatEls = new Map();

  // --- animación de viewBox ---
  let anim = null;
  function animateViewBox(target, dur = 550) {
    const from = svg.getAttribute("viewBox").split(" ").map(Number);
    const t0 = performance.now();
    cancelAnimationFrame(anim);
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now) => {
      const k = ease(Math.min((now - t0) / dur, 1));
      const vb = from.map((v, i) => v + (target[i] - v) * k);
      svg.setAttribute("viewBox", vb.join(" "));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // --- desplegar asientos de una sección ---
  function focusSection(sec) {
    focused = sec;
    gSeats.innerHTML = "";
    seatEls.clear();
    selectedSeatEl = null;

    for (const [id, entry] of sectionEls) {
      entry.rect.classList.toggle("dimmed", id !== sec.id);
      entry.rect.classList.toggle("focused", id === sec.id);
      entry.label.classList.toggle("hiddenlabel", id === sec.id);
    }

    const free = lighten(sec.color, 45);
    for (let r = 1; r <= sec.rows; r++) {
      for (let n = 1; n <= sec.seatsPerRow; n++) {
        const seat = seatById.get(`${sec.id}-F${r}-${n}`);
        if (!seat) continue;
        const c = el("circle", {
          cx: seat.pos.x, cy: seat.pos.z, r: 0.21,
          fill: seat.taken ? "#141c2d" : free,
          class: "m2-seat" + (seat.taken ? " taken" : ""),
        }, gSeats);
        if (!seat.taken) {
          c.addEventListener("click", (e) => {
            e.stopPropagation();
            onSeatPick(seat);
          });
          const title = el("title", {}, c);
          title.textContent = `${seat.id} · Fila ${seat.row}, Asiento ${seat.num}`;
        }
        seatEls.set(seat.id, c);
      }
    }

    const b = sec.bbox;
    const p = 3;
    animateViewBox([b.minX - p, b.minZ - p, b.maxX - b.minX + p * 2, b.maxZ - b.minZ + p * 2]);
  }

  function setSelectedSeat(seat) {
    if (selectedSeatEl) selectedSeatEl.classList.remove("selected");
    selectedSeatEl = seat ? seatEls.get(seat.id) || null : null;
    if (selectedSeatEl) selectedSeatEl.classList.add("selected");
  }

  function showAll() {
    focused = null;
    gSeats.innerHTML = "";
    seatEls.clear();
    selectedSeatEl = null;
    for (const entry of sectionEls.values()) {
      entry.rect.classList.remove("dimmed", "focused");
      entry.label.classList.remove("hiddenlabel");
    }
    animateViewBox(fullVB);
  }

  return { focusSection, setSelectedSeat, showAll, get focused() { return focused; } };
}

// ------------------------------------------------------------
// Cancha en 2D: césped, franjas y demarcación
// ------------------------------------------------------------
function drawPitch(g) {
  const L = PITCH_L, W = PITCH_W;

  // pista perimetral
  el("rect", {
    x: -L / 2 - 6, y: -W / 2 - 6, width: L + 12, height: W + 12,
    rx: 2, fill: "#232f45",
  }, g);

  // césped con franjas
  const stripes = 12;
  const sw = L / stripes;
  for (let i = 0; i < stripes; i++) {
    el("rect", {
      x: -L / 2 + i * sw, y: -W / 2, width: sw + 0.05, height: W,
      fill: i % 2 === 0 ? "#2f8f56" : "#28804b",
    }, g);
  }

  // demarcación
  const white = { stroke: "#eef2f8", "stroke-width": 0.35, fill: "none" };
  el("rect", { x: -L / 2, y: -W / 2, width: L, height: W, ...white }, g);
  el("line", { x1: 0, y1: -W / 2, x2: 0, y2: W / 2, ...white }, g);
  el("circle", { cx: 0, cy: 0, r: 9.15, ...white }, g);
  el("circle", { cx: 0, cy: 0, r: 0.4, fill: "#eef2f8" }, g);

  for (const s of [-1, 1]) {
    const gx = s * L / 2;
    // área grande
    el("rect", { x: s < 0 ? gx : gx - 16.5, y: -20.15, width: 16.5, height: 40.3, ...white }, g);
    // área chica
    el("rect", { x: s < 0 ? gx : gx - 5.5, y: -9.16, width: 5.5, height: 18.32, ...white }, g);
    // punto penal
    el("circle", { cx: s * (L / 2 - 11), cy: 0, r: 0.4, fill: "#eef2f8" }, g);
    // semicírculo del área: arco de radio 9.15 centrado en el punto penal
    const px = s * (L / 2 - 11);
    const edge = s * (L / 2 - 16.5);
    const dy = Math.sqrt(Math.max(0, 9.15 ** 2 - (edge - px) ** 2));
    el("path", {
      d: `M ${edge} ${-dy} A 9.15 9.15 0 0 ${s < 0 ? 1 : 0} ${edge} ${dy}`,
      ...white,
    }, g);
    // portería
    el("rect", {
      x: s < 0 ? gx - 1.8 : gx, y: -3.66, width: 1.8, height: 7.32,
      fill: "none", stroke: "#eef2f8", "stroke-width": 0.3,
    }, g);
  }
}
