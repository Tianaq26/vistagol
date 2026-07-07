// ============================================================
// main.js — VistaGol MVP
// Flujo: vista general (orbit u plano 2D) → elegir sección →
// elegir asiento → cámara vuela al asiento → mirada libre en 1ª persona.
// ============================================================
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildStadium, formatCRC } from "./stadium.js";
import { createMap2D } from "./map2d.js";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const landing = $("landing");
const topbar = $("topbar");
const hint = $("hint");
const btnReset = $("btn-reset");
const panel = $("panel");
const seatmapEl = $("seatmap");
const ticket = $("ticket");
const hud = $("seatview-hud");
const modal = $("modal");
const loader = $("loader");
const viewToggle = $("view-toggle");
const btnView3d = $("btn-view3d");
const btnView2d = $("btn-view2d");
const map2dEl = $("map2d");
const mapTitle = $("map-title");
const mapBack = $("map-back");

// ---------- Estado ----------
const MODE = { OVERVIEW: 0, SEATVIEW: 1, TRANSITION: 2 };
let mode = MODE.OVERVIEW;
let currentSection = null;
let selectedSeat = null;
let is2D = false;

// ---------- Renderer / escena ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.fog = new THREE.Fog(0x0b1220, 240, 460);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
camera.position.set(130, 100, 140);

// ---------- Luces ----------
scene.add(new THREE.HemisphereLight(0x8fa8cc, 0x0e1626, 0.75));
const moon = new THREE.DirectionalLight(0xbfd0ea, 0.7);
moon.position.set(-80, 120, 60);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = moon.shadow.camera.bottom = -150;
moon.shadow.camera.right = moon.shadow.camera.top = 150;
scene.add(moon);

// ---------- Estadio ----------
const { group: stadium, seats, sections } = buildStadium();
scene.add(stadium);

const seatById = new Map(seats.map((s) => [s.id, s]));
const sectionById = new Map(sections.map((s) => [s.id, s]));

// marcador del asiento seleccionado en 3D
const marker = new THREE.Mesh(
  new THREE.ConeGeometry(0.55, 1.3, 4),
  new THREE.MeshBasicMaterial({ color: 0xf2c14e })
);
marker.rotation.x = Math.PI;
marker.visible = false;
scene.add(marker);

// ---------- Plano 2D ----------
const map2d = createMap2D({
  svg: $("map-svg"),
  sections,
  seatById,
  onSectionPick: (sec) => {
    setCurrentSection(sec);
    map2d.focusSection(sec);
    mapBack.classList.remove("hidden");
    mapTitle.textContent = `${sec.standLabel} · Sección ${sec.id} · ${formatCRC(sec.price)}`;
    hint.textContent = "Tocá un asiento libre para seleccionarlo";
  },
  onSeatPick: (seat) => selectSeat(seat),
});

mapBack.addEventListener("click", () => {
  map2d.showAll();
  mapBack.classList.add("hidden");
  mapTitle.textContent = "Elegí una sección del estadio";
  hint.textContent = "";
});

// ---------- Controles (vista general) ----------
const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 4, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.06;
orbit.maxPolarAngle = Math.PI / 2.15;
orbit.minDistance = 40;
orbit.maxDistance = 300;
orbit.autoRotate = false;
orbit.autoRotateSpeed = 0.5;
orbit.addEventListener("start", () => (orbit.autoRotate = false));

// ---------- Mirada en primera persona (asiento) ----------
const look = {
  yaw: 0,
  pitch: 0,
  baseYaw: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  YAW_LIMIT: THREE.MathUtils.degToRad(110),
  PITCH_LIMIT: THREE.MathUtils.degToRad(42),
};

canvas.addEventListener("pointerdown", (e) => {
  if (mode !== MODE.SEATVIEW) return;
  look.dragging = true;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
});
addEventListener("pointerup", () => (look.dragging = false));
addEventListener("pointermove", (e) => {
  if (mode !== MODE.SEATVIEW || !look.dragging) return;
  const dx = e.clientX - look.lastX;
  const dy = e.clientY - look.lastY;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  look.yaw = THREE.MathUtils.clamp(look.yaw - dx * 0.0032, -look.YAW_LIMIT, look.YAW_LIMIT);
  look.pitch = THREE.MathUtils.clamp(look.pitch - dy * 0.0028, -look.PITCH_LIMIT, look.PITCH_LIMIT);
});

function applyLook() {
  const yaw = look.baseYaw + look.yaw;
  const dir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(look.pitch),
    Math.sin(look.pitch),
    Math.cos(yaw) * Math.cos(look.pitch)
  );
  camera.lookAt(camera.position.clone().add(dir));
}

// ---------- Transición de cámara ----------
const flight = { active: false, t: 0, dur: 1.4, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3(), onDone: null };

function flyTo(pos, target, dur, onDone) {
  flight.active = true;
  flight.t = 0;
  flight.dur = dur;
  flight.fromPos.copy(camera.position);
  flight.toPos.copy(pos);
  flight.fromTarget.copy(orbit.target);
  flight.toTarget.copy(target);
  flight.onDone = onDone || null;
  mode = MODE.TRANSITION;
  orbit.enabled = false;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------- Raycast: clic y hover en secciones ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hitboxes = sections.map((s) => s.hitbox);
let downAt = null;

canvas.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener("pointerup", (e) => {
  if (mode !== MODE.OVERVIEW || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) return; // fue un drag, no un clic

  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hitboxes);
  if (hits.length) openSection(hits[0].object.userData.sectionId);
});

// hover: cursor + pista con nombre y precio de la sección
canvas.addEventListener("pointermove", (e) => {
  if (mode !== MODE.OVERVIEW || is2D) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hitboxes);
  if (hits.length) {
    const sec = sectionById.get(hits[0].object.userData.sectionId);
    canvas.style.cursor = "pointer";
    hint.textContent = `Sección ${sec.id} · ${sec.standLabel} · ${formatCRC(sec.price)} — clic para abrir`;
  } else {
    canvas.style.cursor = "";
    if (!currentSection) hint.textContent = "Hacé clic en una sección del estadio para ver los asientos";
  }
});

// ---------- Toggle 3D / 2D ----------
btnView3d.addEventListener("click", () => setView(false));
btnView2d.addEventListener("click", () => setView(true));

function setView(to2D) {
  if (is2D === to2D) return;
  is2D = to2D;
  btnView3d.classList.toggle("active", !to2D);
  btnView2d.classList.toggle("active", to2D);

  if (to2D) {
    map2dEl.classList.remove("hidden");
    panel.classList.add("hidden");
    btnReset.classList.add("hidden");
    hud.classList.add("hidden");
    if (currentSection) {
      map2d.focusSection(currentSection);
      map2d.setSelectedSeat(selectedSeat);
      mapBack.classList.remove("hidden");
      mapTitle.textContent = `${currentSection.standLabel} · Sección ${currentSection.id} · ${formatCRC(currentSection.price)}`;
      hint.textContent = "Tocá un asiento libre para seleccionarlo";
    } else {
      map2d.showAll();
      mapBack.classList.add("hidden");
      mapTitle.textContent = "Elegí una sección del estadio";
      hint.textContent = "";
    }
    if (selectedSeat) ticket.classList.remove("hidden");
  } else {
    map2dEl.classList.add("hidden");
    if (mode === MODE.OVERVIEW && currentSection) {
      panel.classList.remove("hidden");
      if (selectedSeat) {
        ticket.classList.remove("hidden");
        marker.visible = true;
      }
      hint.textContent = "Elegí un asiento en el mapa para verlo en 3D";
    } else if (mode === MODE.OVERVIEW) {
      hint.textContent = "Hacé clic en una sección del estadio para ver los asientos";
    }
  }
}

// ---------- UI: sección actual ----------
function setCurrentSection(sec) {
  currentSection = sec;
  $("panel-stand").textContent = sec.standLabel;
  $("panel-section").textContent = `Sección ${sec.id}`;
  $("panel-price").textContent = formatCRC(sec.price);
  renderSeatmap(sec);
}

function openSection(sectionId) {
  const sec = sectionById.get(sectionId);
  setCurrentSection(sec);

  panel.classList.remove("hidden");
  hint.textContent = "Elegí un asiento en el mapa para verlo en 3D";

  // acercar la cámara: del lado de la cancha, mirando de frente a la sección
  const toPitch = sec.center.clone().setY(0).normalize().negate();
  const camPos = sec.center.clone().add(toPitch.multiplyScalar(42)).setY(sec.center.y + 24);
  const target = sec.center.clone().setY(sec.center.y * 0.5);
  flyTo(camPos, target, 1.1, () => {
    mode = MODE.OVERVIEW;
    orbit.enabled = true;
    orbit.target.copy(target);
  });
}

function renderSeatmap(sec) {
  seatmapEl.innerHTML = "";
  seatmapEl.style.gridTemplateColumns = `28px repeat(${sec.seatsPerRow}, 17px)`;

  // fila 1 = más cerca de la cancha (arriba del mapa)
  for (let r = 1; r <= sec.rows; r++) {
    const label = document.createElement("div");
    label.className = "row-label";
    label.textContent = `F${r}`;
    seatmapEl.appendChild(label);

    for (let n = 1; n <= sec.seatsPerRow; n++) {
      const seat = seatById.get(`${sec.id}-F${r}-${n}`);
      const b = document.createElement("button");
      b.className = "seat-btn" + (seat.taken ? " taken" : "");
      b.dataset.seatId = seat.id;
      b.title = seat.taken ? `${seat.id} · vendido` : seat.id;
      if (!seat.taken) {
        b.addEventListener("click", () => selectSeat(seat));
      } else {
        b.disabled = true;
      }
      seatmapEl.appendChild(b);
    }
  }
}

// ---------- Selección de asiento (compartida 2D / 3D) ----------
function selectSeat(seat) {
  selectedSeat = seat;
  const sec = sectionById.get(seat.sectionId);
  if (currentSection !== sec) setCurrentSection(sec);

  // panel lateral (grid)
  seatmapEl.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
  const btn = seatmapEl.querySelector(`[data-seat-id="${seat.id}"]`);
  if (btn) btn.classList.add("selected");

  // plano 2D
  map2d.setSelectedSeat(seat);

  // marcador 3D
  marker.position.copy(seat.pos).add(new THREE.Vector3(0, 1.9, 0));
  marker.visible = !is2D;

  $("ticket-code").textContent = seat.id;
  $("ticket-meta").textContent = `${sec.standLabel} · Fila ${seat.row} · Asiento ${seat.num}`;
  $("ticket-price").textContent = formatCRC(sec.price);
  ticket.classList.remove("hidden");
}

// ---------- Vista desde el asiento ----------
$("btn-view").addEventListener("click", () => {
  if (!selectedSeat) return;
  const eye = selectedSeat.pos.clone().add(new THREE.Vector3(0, 1.15, 0));
  const target = new THREE.Vector3(0, 1, 0); // centro de la cancha

  if (is2D) setView(false); // volver al 3D para el vuelo
  panel.classList.add("hidden");
  ticket.classList.add("hidden");
  marker.visible = false;

  flyTo(eye, target, 1.5, () => {
    mode = MODE.SEATVIEW;
    look.yaw = 0;
    look.pitch = 0;
    // yaw base: mirando al centro de la cancha
    const d = target.clone().sub(eye);
    look.baseYaw = Math.atan2(d.x, d.z);
    $("hud-code").textContent = selectedSeat.id;
    hud.classList.remove("hidden");
    btnReset.classList.remove("hidden");
    hint.textContent = "";
  });
});

// ---------- Volver a vista general ----------
btnReset.addEventListener("click", resetToOverview);

function resetToOverview() {
  hud.classList.add("hidden");
  btnReset.classList.add("hidden");
  const pos = new THREE.Vector3(130, 100, 140);
  const target = new THREE.Vector3(0, 4, 0);
  flyTo(pos, target, 1.3, () => {
    mode = MODE.OVERVIEW;
    orbit.enabled = true;
    orbit.target.copy(target);
    hint.textContent = "Hacé clic en una sección del estadio para ver los asientos";
    if (currentSection) {
      panel.classList.remove("hidden");
      if (selectedSeat) {
        ticket.classList.remove("hidden");
        marker.visible = true;
      }
    }
  });
}

// ---------- Compra demo ----------
$("btn-buy").addEventListener("click", () => {
  const sec = sectionById.get(selectedSeat.sectionId);
  $("modal-seat").textContent =
    `${selectedSeat.id} · ${sec.standLabel} · ${formatCRC(sec.price)}`;
  modal.classList.remove("hidden");
});
$("btn-close-modal").addEventListener("click", () => modal.classList.add("hidden"));

// ---------- Landing ----------
$("btn-enter").addEventListener("click", () => {
  landing.classList.add("leaving");
  setTimeout(() => landing.classList.add("hidden"), 650);
  topbar.classList.remove("hidden");
  viewToggle.classList.remove("hidden");
  // pequeño vuelo de presentación
  flyTo(new THREE.Vector3(95, 70, 105), new THREE.Vector3(0, 4, 0), 1.6, () => {
    mode = MODE.OVERVIEW;
    orbit.enabled = true;
    orbit.autoRotate = true; // gira suave hasta que el usuario interactúe
  });
});

// ---------- Resize ----------
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (flight.active) {
    flight.t += dt / flight.dur;
    const k = easeInOut(Math.min(flight.t, 1));
    camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
    const target = new THREE.Vector3().lerpVectors(flight.fromTarget, flight.toTarget, k);
    camera.lookAt(target);
    if (flight.t >= 1) {
      flight.active = false;
      flight.onDone && flight.onDone();
    }
  } else if (mode === MODE.SEATVIEW) {
    applyLook();
  } else if (mode === MODE.OVERVIEW) {
    orbit.update();
  }

  if (!is2D) renderer.render(scene, camera);
}

animate();
loader.classList.add("done");
