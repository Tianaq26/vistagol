// ============================================================
// stadium.js — Genera el estadio procedural y los datos de asientos
// Cada asiento tiene una posición real en el mundo 3D, que luego
// se usa para colocar la cámara "sentada" en él.
// ============================================================
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// --- Dimensiones base (metros) ---
export const PITCH_L = 105;
export const PITCH_W = 68;

export const ROW_DEPTH = 0.85;   // profundidad de cada fila
export const ROW_RISE = 0.45;    // subida de cada fila (rake)
export const SEAT_SPACING = 0.55;
const EYE_HEIGHT = 1.15;         // altura de ojos sentado sobre la grada

// --- Configuración de tribunas ---
// gap: distancia de la 1ª fila al borde de la cancha
// depthOff/heightOff: para tribunas de segundo nivel (palco)
const STANDS = [
  { id: "oeste", prefix: "O",  label: "Tribuna Oeste (Platea)", axis: "x", side: -1, gap: 8,  rows: 22, tier: "platea",    price: 15000, color: 0x3f6ea8, roof: false },
  { id: "palco", prefix: "P",  label: "Oeste Alta (Palco)",     axis: "x", side: -1, gap: 8,  rows: 12, tier: "palco",     price: 22000, color: 0x8a5fc9, roof: true,
    depthOff: 22 * ROW_DEPTH + 2.6, heightOff: 22 * ROW_RISE + 3.4, steep: 1.3 },
  { id: "este",  prefix: "E",  label: "Tribuna Este",           axis: "x", side: 1,  gap: 8,  rows: 20, tier: "general",   price: 9000,  color: 0x3d8f6b, roof: true },
  { id: "norte", prefix: "N",  label: "Gradería Norte",         axis: "z", side: -1, gap: 10, rows: 16, tier: "populares", price: 6000,  color: 0xa8743f, roof: false },
  { id: "sur",   prefix: "S",  label: "Gradería Sur",           axis: "z", side: 1,  gap: 10, rows: 16, tier: "populares", price: 6000,  color: 0xa8743f, roof: false },
];

const SECTIONS_PER_STAND = 5;

export function formatCRC(n) {
  return "₡" + n.toLocaleString("es-CR");
}

// ------------------------------------------------------------
// Construye todo. Devuelve { group, seats, sections, seatMesh }
// ------------------------------------------------------------
export function buildStadium() {
  const group = new THREE.Group();
  const seats = [];      // { id, standId, sectionId, row, num, pos, lookYaw, taken }
  const sections = [];   // { id, standId, label, price, center, hitbox, bbox }

  group.add(buildPitch());
  group.add(buildGroundApron());
  group.add(buildAdBoards());

  for (const stand of STANDS) {
    buildStand(stand, group, seats, sections);
  }

  buildCornerStands(group);
  const seatMesh = buildSeatInstances(seats, group);
  addFloodlights(group);
  addScoreboard(group);
  addStars(group);

  return { group, seats, sections, seatMesh };
}

// ------------------------------------------------------------
// Cancha: césped texturizado + demarcación completa
// ------------------------------------------------------------
function makeGrassTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 664;
  const ctx = c.getContext("2d");

  // franjas de corte alternadas a lo largo
  const stripes = 12;
  const w = c.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#2f8f56" : "#28804b";
    ctx.fillRect(i * w, 0, w + 1, c.height);
  }
  // segundo patrón de corte transversal, muy sutil
  const bands = 8;
  const bh = c.height / bands;
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let i = 0; i < bands; i += 2) ctx.fillRect(0, i * bh, c.width, bh);

  // ruido de césped
  for (let i = 0; i < 9000; i++) {
    const a = Math.random() * 0.06;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(190,255,200,${a * 0.7})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1.6, 1.6);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildPitch() {
  const g = new THREE.Group();

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_L, PITCH_W),
    new THREE.MeshLambertMaterial({ map: makeGrassTexture() })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.01;
  grass.receiveShadow = true;
  g.add(grass);

  // líneas blancas
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf0f4f8 });
  const line = (w, h, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    g.add(m);
  };
  const LW = 0.3;
  line(PITCH_L, LW, 0, -PITCH_W / 2);          // banda norte
  line(PITCH_L, LW, 0, PITCH_W / 2);           // banda sur
  line(LW, PITCH_W, -PITCH_L / 2, 0);          // fondo oeste
  line(LW, PITCH_W, PITCH_L / 2, 0);           // fondo este
  line(LW, PITCH_W, 0, 0);                     // media cancha
  // áreas grandes
  line(16.5, LW, -PITCH_L / 2 + 8.25, -20.15);
  line(16.5, LW, -PITCH_L / 2 + 8.25, 20.15);
  line(LW, 40.3, -PITCH_L / 2 + 16.5, 0);
  line(16.5, LW, PITCH_L / 2 - 8.25, -20.15);
  line(16.5, LW, PITCH_L / 2 - 8.25, 20.15);
  line(LW, 40.3, PITCH_L / 2 - 16.5, 0);
  // áreas chicas
  line(5.5, LW, -PITCH_L / 2 + 2.75, -9.16);
  line(5.5, LW, -PITCH_L / 2 + 2.75, 9.16);
  line(LW, 18.32, -PITCH_L / 2 + 5.5, 0);
  line(5.5, LW, PITCH_L / 2 - 2.75, -9.16);
  line(5.5, LW, PITCH_L / 2 - 2.75, 9.16);
  line(LW, 18.32, PITCH_L / 2 - 5.5, 0);

  // círculo central
  const arc = (r0, r1, x, z, thetaStart, thetaLength) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 64, 1, thetaStart, thetaLength), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    g.add(m);
  };
  arc(9.0, 9.3, 0, 0, 0, Math.PI * 2);

  // semicírculos del área (la porción fuera del área grande)
  // cos(θ) = (16.5 - 11) / 9.15 → θ ≈ 53.1°
  const t = Math.acos((16.5 - 11) / 9.15);
  arc(9.0, 9.3, -PITCH_L / 2 + 11, 0, -t, 2 * t);
  arc(9.0, 9.3, PITCH_L / 2 - 11, 0, Math.PI - t, 2 * t);

  // arcos de esquina
  arc(0.85, 1.1, -PITCH_L / 2, -PITCH_W / 2, 0, Math.PI / 2);
  arc(0.85, 1.1, PITCH_L / 2, -PITCH_W / 2, Math.PI / 2, Math.PI / 2);
  arc(0.85, 1.1, PITCH_L / 2, PITCH_W / 2, Math.PI, Math.PI / 2);
  arc(0.85, 1.1, -PITCH_L / 2, PITCH_W / 2, Math.PI * 1.5, Math.PI / 2);

  // puntos: penales y centro
  const spot = (x, z) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    g.add(m);
  };
  spot(0, 0);
  spot(-PITCH_L / 2 + 11, 0);
  spot(PITCH_L / 2 - 11, 0);

  // porterías con red
  for (const side of [-1, 1]) g.add(buildGoal(side));

  return g;
}

function buildGoal(side) {
  const goal = new THREE.Group();
  const goalMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.44, 8);
  const barGeo = new THREE.CylinderGeometry(0.08, 0.08, 7.32, 8);
  const p1 = new THREE.Mesh(postGeo, goalMat);
  p1.position.set(0, 1.22, -3.66);
  const p2 = p1.clone();
  p2.position.z = 3.66;
  const bar = new THREE.Mesh(barGeo, goalMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.y = 2.44;
  goal.add(p1, p2, bar);

  // red (malla semitransparente inclinada hacia atrás)
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xdde6f2, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
  });
  const backGeo = new THREE.PlaneGeometry(7.32, 2.6);
  backGeo.rotateY(Math.PI / 2); // ancho a lo largo de z, normal +x
  const back = new THREE.Mesh(backGeo, netMat);
  back.position.set(1.6, 1.1, 0);

  const topGeo = new THREE.PlaneGeometry(7.32, 1.9);
  topGeo.rotateX(-Math.PI / 2 + 0.3); // casi horizontal, cae hacia atrás
  topGeo.rotateY(Math.PI / 2);        // ancho a lo largo de z
  const top = new THREE.Mesh(topGeo, netMat);
  top.position.set(0.85, 2.2, 0);
  goal.add(back, top);

  goal.position.x = side * PITCH_L / 2;
  goal.rotation.y = side < 0 ? Math.PI : 0;
  return goal;
}

function buildGroundApron() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_L + 90, PITCH_W + 90),
    new THREE.MeshLambertMaterial({ color: 0x18202f })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.02;
  m.receiveShadow = true;
  g.add(m);

  // pista perimetral (tartán oscuro)
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_L + 12, PITCH_W + 12),
    new THREE.MeshLambertMaterial({ color: 0x232f45 })
  );
  track.rotation.x = -Math.PI / 2;
  track.position.y = -0.01;
  g.add(track);
  return g;
}

// ------------------------------------------------------------
// Vallas LED perimetrales con la marca
// ------------------------------------------------------------
function makeAdTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 48;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0d1728";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = "700 26px Archivo, Arial, sans-serif";
  ctx.textBaseline = "middle";
  for (let x = 20; x < c.width; x += 256) {
    ctx.fillStyle = "#f2c14e";
    ctx.fillText("VISTAGOL", x, c.height / 2);
    ctx.fillStyle = "#3da35d";
    ctx.fillText("⚽ VE TU ASIENTO", x + 128, c.height / 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function buildAdBoards() {
  const g = new THREE.Group();
  const tex = makeAdTexture();
  const H = 0.95;
  const makeBoard = (len, x, z, rotY) => {
    const map = tex.clone();
    map.repeat.x = len / 24;
    map.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshBasicMaterial({ map }));
    m.position.set(x, H / 2 + 0.02, z);
    m.rotation.y = rotY;
    m.rotation.x = -0.12; // leve inclinación hacia arriba
    g.add(m);
  };
  const off = 4.5;
  makeBoard(PITCH_L + 4, 0, -PITCH_W / 2 - off, 0);
  makeBoard(PITCH_L + 4, 0, PITCH_W / 2 + off, Math.PI);
  makeBoard(PITCH_W + 4, -PITCH_L / 2 - off, 0, Math.PI / 2);
  makeBoard(PITCH_W + 4, PITCH_L / 2 + off, 0, -Math.PI / 2);
  return g;
}

// ------------------------------------------------------------
// Una tribuna: terrazas de concreto + techo + datos de asientos
// ------------------------------------------------------------
function buildStand(stand, group, seats, sections) {
  const along = stand.axis === "x" ? PITCH_W + 6 : PITCH_L * 0.62; // largo de la tribuna
  const startEdge = stand.axis === "x" ? PITCH_L / 2 : PITCH_W / 2;
  const base = startEdge + stand.gap + (stand.depthOff || 0);
  const h0 = 1.2 + (stand.heightOff || 0);
  const rise = ROW_RISE * (stand.steep || 1);

  const concrete = new THREE.MeshLambertMaterial({ color: 0x2a3448 });
  const concreteDark = new THREE.MeshLambertMaterial({ color: 0x222b3d });

  // --- terrazas (una caja larga por fila) ---
  for (let r = 0; r < stand.rows; r++) {
    const d = base + r * ROW_DEPTH;
    const h = h0 + r * rise;
    const boxH = stand.heightOff ? rise + 0.4 : h; // el palco flota: cajas delgadas
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(
        stand.axis === "x" ? ROW_DEPTH : along,
        boxH,
        stand.axis === "x" ? along : ROW_DEPTH
      ),
      r % 2 ? concrete : concreteDark
    );
    const off = (d + ROW_DEPTH / 2) * stand.side;
    if (stand.axis === "x") step.position.set(off, h - boxH / 2 + rise, 0);
    else step.position.set(0, h - boxH / 2 + rise, off);
    step.castShadow = step.receiveShadow = true;
    group.add(step);
  }

  // --- losa de soporte para tribunas elevadas ---
  if (stand.heightOff) {
    const depth = stand.rows * ROW_DEPTH + 1;
    const slabGeo = new THREE.BoxGeometry(
      stand.axis === "x" ? depth : along,
      0.7,
      stand.axis === "x" ? along : depth
    );
    const slab = new THREE.Mesh(slabGeo, concreteDark);
    const mid = (base + depth / 2 - 0.5) * stand.side;
    if (stand.axis === "x") slab.position.set(mid, h0 - 0.1, 0);
    else slab.position.set(0, h0 - 0.1, mid);
    slab.castShadow = true;
    group.add(slab);

    // columnas que sostienen el palco
    const colGeo = new THREE.CylinderGeometry(0.5, 0.6, h0, 10);
    const colMat = new THREE.MeshLambertMaterial({ color: 0x33415e });
    for (let i = -3; i <= 3; i++) {
      const col = new THREE.Mesh(colGeo, colMat);
      const t = (i / 3) * (along / 2 - 4);
      const d = (base + stand.rows * ROW_DEPTH * 0.6) * stand.side;
      if (stand.axis === "x") col.position.set(d, h0 / 2, t);
      else col.position.set(t, h0 / 2, d);
      group.add(col);
    }
  }

  // --- muro frontal bajo con baranda ---
  const wallH = 1.4;
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(
      stand.axis === "x" ? 0.3 : along,
      wallH,
      stand.axis === "x" ? along : 0.3
    ),
    new THREE.MeshLambertMaterial({ color: 0x33415e })
  );
  const wallY = stand.heightOff ? h0 + wallH / 2 : wallH / 2;
  const wallOff = (base - 0.3) * stand.side;
  if (stand.axis === "x") wall.position.set(wallOff, wallY, 0);
  else wall.position.set(0, wallY, wallOff);
  group.add(wall);

  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(
      stand.axis === "x" ? 0.08 : along,
      0.08,
      stand.axis === "x" ? along : 0.08
    ),
    new THREE.MeshBasicMaterial({ color: 0x5a7bb0 })
  );
  rail.position.copy(wall.position).setY(wallY + wallH / 2 + 0.04);
  group.add(rail);

  // --- muro trasero de cierre ---
  const topH = h0 + stand.rows * rise;
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(
      stand.axis === "x" ? 0.6 : along + 2,
      stand.heightOff ? topH - h0 + 3 : topH + 2,
      stand.axis === "x" ? along + 2 : 0.6
    ),
    new THREE.MeshLambertMaterial({ color: 0x1f2940 })
  );
  const backOff2 = (base + stand.rows * ROW_DEPTH + 0.5) * stand.side;
  const backY = stand.heightOff ? h0 + (topH - h0 + 3) / 2 : (topH + 2) / 2;
  if (stand.axis === "x") backWall.position.set(backOff2, backY, 0);
  else backWall.position.set(0, backY, backOff2);
  backWall.castShadow = true;
  group.add(backWall);

  // --- techo ---
  if (stand.roof) {
    const roofDepth = stand.rows * ROW_DEPTH + 8;
    const roofH = topH + 5.5;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(
        stand.axis === "x" ? roofDepth : along + 4,
        0.4,
        stand.axis === "x" ? along + 4 : roofDepth
      ),
      new THREE.MeshLambertMaterial({ color: 0x1b2333, emissive: 0x161e2e })
    );
    const roofOff = (base + roofDepth / 2 - 3) * stand.side;
    if (stand.axis === "x") roof.position.set(roofOff, roofH, 0);
    else roof.position.set(0, roofH, roofOff);
    roof.rotation[stand.axis === "x" ? "z" : "x"] = 0.1 * -stand.side * (stand.axis === "x" ? 1 : -1);
    roof.castShadow = true;
    group.add(roof);

    // tira de luz LED bajo el techo (borde frontal)
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(
        stand.axis === "x" ? 0.25 : along + 4,
        0.12,
        stand.axis === "x" ? along + 4 : 0.25
      ),
      new THREE.MeshBasicMaterial({ color: 0xcfe0f5 })
    );
    const stripOff = (base + 0.5) * stand.side;
    const stripY = roofH - 0.8 - Math.tan(0.1) * (roofDepth / 2 - 3);
    if (stand.axis === "x") strip.position.set(stripOff, stripY, 0);
    else strip.position.set(0, stripY, stripOff);
    group.add(strip);

    // columnas traseras
    const colGeo = new THREE.CylinderGeometry(0.35, 0.35, roofH, 10);
    const colMat = new THREE.MeshLambertMaterial({ color: 0x33415e });
    const backOff = (base + stand.rows * ROW_DEPTH + 2.5) * stand.side;
    for (let i = -2; i <= 2; i++) {
      const col = new THREE.Mesh(colGeo, colMat);
      const t = (i / 2) * (along / 2 - 4);
      if (stand.axis === "x") col.position.set(backOff, roofH / 2, t);
      else col.position.set(t, roofH / 2, backOff);
      group.add(col);
    }
  }

  // --- datos de asientos + secciones ---
  const seatsPerRow = Math.floor(along / SEAT_SPACING) - 2;
  const perSection = Math.floor(seatsPerRow / SECTIONS_PER_STAND);
  const prefix = stand.prefix;

  for (let s = 0; s < SECTIONS_PER_STAND; s++) {
    const sectionId = `${prefix}${s + 1}`;
    const secSeats = [];

    for (let r = 0; r < stand.rows; r++) {
      const d = base + r * ROW_DEPTH + ROW_DEPTH * 0.5;
      const y = h0 + r * rise + rise + 0.25; // asiento sobre la terraza

      for (let n = 0; n < perSection; n++) {
        const globalIdx = s * perSection + n;
        const t = (globalIdx - (perSection * SECTIONS_PER_STAND - 1) / 2) * SEAT_SPACING;
        const pos = new THREE.Vector3();
        if (stand.axis === "x") pos.set(d * stand.side, y, t);
        else pos.set(t, y, d * stand.side);

        // yaw mirando hacia la cancha (centro)
        const lookYaw = Math.atan2(-pos.x, -pos.z);

        const seat = {
          id: `${sectionId}-F${r + 1}-${n + 1}`,
          standId: stand.id,
          sectionId,
          row: r + 1,
          num: n + 1,
          pos,
          lookYaw,
          taken: pseudoRandom(sectionId, r, n) < occupancy(stand.tier),
        };
        seats.push(seat);
        secSeats.push(seat);
      }
    }

    // hitbox invisible para clic de sección
    const center = secSeats
      .reduce((acc, s2) => acc.add(s2.pos), new THREE.Vector3())
      .multiplyScalar(1 / secSeats.length);

    // bbox en planta (para el plano 2D)
    const bbox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const s2 of secSeats) {
      bbox.minX = Math.min(bbox.minX, s2.pos.x);
      bbox.maxX = Math.max(bbox.maxX, s2.pos.x);
      bbox.minZ = Math.min(bbox.minZ, s2.pos.z);
      bbox.maxZ = Math.max(bbox.maxZ, s2.pos.z);
    }

    const hbW = perSection * SEAT_SPACING;
    const hbD = stand.rows * ROW_DEPTH;
    const hbH = stand.rows * rise + 2;
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(
        stand.axis === "x" ? hbD : hbW,
        hbH,
        stand.axis === "x" ? hbW : hbD
      ),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitbox.position.copy(center);
    hitbox.userData.sectionId = sectionId;
    group.add(hitbox);

    sections.push({
      id: sectionId,
      standId: stand.id,
      standLabel: stand.label,
      tier: stand.tier,
      price: stand.price,
      rows: stand.rows,
      seatsPerRow: perSection,
      center,
      hitbox,
      bbox,
      color: stand.color,
      axis: stand.axis,
      side: stand.side,
    });
  }
}

function occupancy(tier) {
  return tier === "platea" ? 0.35 : tier === "palco" ? 0.45 : tier === "general" ? 0.25 : 0.18;
}

// determinista para que la demo siempre se vea igual
function pseudoRandom(sec, r, n) {
  let h = 0;
  const str = `${sec}${r * 31}${n * 7}`;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(Math.sin(h)) % 1;
}

// ------------------------------------------------------------
// Esquinas: graderías diagonales decorativas que cierran el óvalo
// ------------------------------------------------------------
function buildCornerStands(group) {
  const rows = 13;
  const len = 26;
  const concrete = new THREE.MeshLambertMaterial({ color: 0x27314a });

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const dir = new THREE.Vector3(sx, 0, sz).normalize(); // hacia afuera
      const yaw = Math.atan2(dir.x, dir.z);
      const geos = [];
      for (let r = 0; r < rows; r++) {
        const dist = 56 + r * ROW_DEPTH;
        const h = 1.2 + r * ROW_RISE;
        const g = new THREE.BoxGeometry(len - r * 0.5, h, ROW_DEPTH);
        g.rotateY(yaw + Math.PI);
        g.translate(dir.x * dist, h / 2, dir.z * dist);
        geos.push(g);
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos), concrete);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ------------------------------------------------------------
// Asientos con InstancedMesh (miles de asientos, un draw call)
// Geometría con base + respaldo, orientada hacia la cancha.
// ------------------------------------------------------------
function buildSeatInstances(seats, group) {
  const baseGeo = new THREE.BoxGeometry(0.42, 0.09, 0.4);
  baseGeo.translate(0, 0.045, 0.03);
  const backGeo = new THREE.BoxGeometry(0.42, 0.38, 0.08);
  backGeo.translate(0, 0.19, -0.18);
  const geo = mergeGeometries([baseGeo, backGeo]);

  const mat = new THREE.MeshLambertMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, seats.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const standColor = {};
  for (const s of STANDS) standColor[s.id] = s.color;

  seats.forEach((seat, i) => {
    dummy.position.copy(seat.pos);
    dummy.rotation.y = seat.lookYaw;
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHex(seat.taken ? 0x1c2536 : standColor[seat.standId]);
    mesh.setColorAt(i, color);
    seat.instanceId = i;
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

// ------------------------------------------------------------
// Torres de iluminación con halo (ambiente de partido nocturno)
// ------------------------------------------------------------
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(235,244,255,0.9)");
  grad.addColorStop(0.35, "rgba(200,220,250,0.28)");
  grad.addColorStop(1, "rgba(200,220,250,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function addFloodlights(group) {
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c3852 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xf5f9ff });
  const glowTex = makeGlowTexture();

  const corners = [
    [-PITCH_L / 2 - 26, -PITCH_W / 2 - 26],
    [PITCH_L / 2 + 26, -PITCH_W / 2 - 26],
    [-PITCH_L / 2 - 26, PITCH_W / 2 + 26],
    [PITCH_L / 2 + 26, PITCH_W / 2 + 26],
  ];

  for (const [x, z] of corners) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 36, 10), poleMat);
    pole.position.set(x, 18, z);
    group.add(pole);

    // panel de lámparas: rejilla 4×3
    const head = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), lampMat);
        lamp.position.set((i - 1.5) * 1.6, (j - 1) * 1.5, 0);
        head.add(lamp);
      }
    }
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 5.2, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x222d44 })
    );
    frame.position.z = -0.25;
    head.add(frame);
    head.position.set(x, 37, z);
    head.lookAt(0, 0, 0);
    group.add(head);

    // halo
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(26);
    glow.position.set(x, 37, z);
    group.add(glow);

    const spot = new THREE.SpotLight(0xf2f7ff, 900, 300, Math.PI / 5, 0.5, 1.4);
    spot.position.set(x, 37, z);
    spot.target.position.set(0, 0, 0);
    group.add(spot, spot.target);
  }
}

// ------------------------------------------------------------
// Pantalla / marcador sobre la gradería norte
// ------------------------------------------------------------
function makeScoreboardTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#060b14";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#23304b";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  ctx.textAlign = "center";
  ctx.fillStyle = "#f2c14e";
  ctx.font = "800 34px Archivo, Arial, sans-serif";
  ctx.fillText("VISTAGOL", c.width / 2, 48);

  ctx.fillStyle = "#edf1f7";
  ctx.font = "700 42px 'JetBrains Mono', monospace";
  ctx.fillText("LOCAL 1 - 0 VISITA", c.width / 2, 112);

  ctx.fillStyle = "#3da35d";
  ctx.font = "700 30px 'JetBrains Mono', monospace";
  ctx.fillText("72:15", c.width / 2, 164);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addScoreboard(group) {
  const w = 18, h = 6.75;
  const z = -(PITCH_W / 2 + 10 + 16 * ROW_DEPTH + 4);
  const y = 1.2 + 16 * ROW_RISE + 7;

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: makeScoreboardTexture() })
  );
  screen.position.set(0, y, z);
  group.add(screen);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 1, h + 1, 0.6),
    new THREE.MeshLambertMaterial({ color: 0x1b2333 })
  );
  frame.position.set(0, y, z - 0.35);
  group.add(frame);

  const legMat = new THREE.MeshLambertMaterial({ color: 0x2c3852 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, y, 8), legMat);
    leg.position.set(s * (w / 2 - 1), y / 2, z - 0.35);
    group.add(leg);
  }
}

// ------------------------------------------------------------
// Cielo estrellado
// ------------------------------------------------------------
function addStars(group) {
  const N = 700;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    // hemisferio sobre el estadio
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85); // evita el horizonte bajo
    const r = 380 + Math.random() * 60;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xcfdcf2, size: 1.4, sizeAttenuation: false, fog: false,
    transparent: true, opacity: 0.8,
  });
  group.add(new THREE.Points(geo, mat));
}
