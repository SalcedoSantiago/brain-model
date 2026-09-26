/**
 * Generador procedural del modelo educativo del encéfalo (public/models/brain.glb).
 *
 * Construye cada estructura como un campo de distancia con signo (SDF), la
 * poligoniza con marching cubes y exporta un GLB donde cada malla es una
 * estructura independiente y seleccionable.
 *
 * Convención de nombres de nodo:  <idEstructura>__<lado>   (lado: L | R | C)
 * Además cada nodo lleva extras = { structureId, side }.
 *
 * Sistema de coordenadas (centímetros):
 *   +X = derecha del sujeto, +Y = superior, +Z = anterior.
 *
 * Este modelo es una aproximación didáctica: respeta la topografía y las
 * proporciones generales, pero no procede de neuroimagen. La app está preparada
 * para sustituirlo por un GLB anatómico de mayor precisión (ver src/data/modelConfig.js).
 *
 * Uso: node scripts/generate-brain.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../public/models/brain.glb');

// ---------------------------------------------------------------------------
// Utilidades matemáticas
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
};
const smax = (a, b, k) => -smin(-a, -b, k);
const groove = (d, w) => Math.exp(-(d * d) / (w * w));

const ell = (c, r) => ({ c, r });
function sdEll(x, y, z, e) {
  const px = x - e.c[0], py = y - e.c[1], pz = z - e.c[2];
  const ax = px / e.r[0], ay = py / e.r[1], az = pz / e.r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / e.r[0], by = ay / e.r[1], bz = az / e.r[2];
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-9) return -Math.min(e.r[0], e.r[1], e.r[2]);
  return (k0 * (k0 - 1)) / k1;
}
function ellNorm(x, y, z, e) {
  const ax = (x - e.c[0]) / e.r[0], ay = (y - e.c[1]) / e.r[1], az = (z - e.c[2]) / e.r[2];
  return Math.sqrt(ax * ax + ay * ay + az * az);
}

/** Interpolación Catmull-Rom de una trayectoria con radios. */
function smoothPath(points, radii, sub = 6, extra = null) {
  const P = [], R = [], E = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, n - 1)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      const pt = p1.map((_, k) =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
      );
      P.push(pt);
      R.push(mix(radii[i], radii[i + 1], t));
      if (extra) E.push(mix(extra[i], extra[i + 1], t));
    }
  }
  P.push(points[n - 1]);
  R.push(radii[n - 1]);
  if (extra) E.push(extra[n - 1]);
  return { P, R, E };
}

/** SDF de un tubo de radio variable a lo largo de una polilínea 3D. */
function sdTube(x, y, z, path) {
  const { P, R } = path;
  let best = 1e9;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = dx * dx + dy * dy + dz * dz;
    const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / L, 0, 1);
    const qx = a[0] + dx * t - x, qy = a[1] + dy * t - y, qz = a[2] + dz * t - z;
    const d = Math.sqrt(qx * qx + qy * qy + qz * qz) - mix(R[i], R[i + 1], t);
    best = smin(best, d, 0.04);
  }
  return best;
}

/** Distancia en el plano (y,z) a una polilínea 2D [[y,z],...]; devuelve {d, i, t, qy, qz}. */
function polyDist2(y, z, pts) {
  let best = 1e9, bi = 0, bt = 0, bqy = 0, bqz = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ay = pts[i][0], az = pts[i][1];
    const dy = pts[i + 1][0] - ay, dz = pts[i + 1][1] - az;
    const t = clamp(((y - ay) * dy + (z - az) * dz) / (dy * dy + dz * dz), 0, 1);
    const qy = ay + dy * t, qz = az + dz * t;
    const d = Math.hypot(qy - y, qz - z);
    if (d < best) { best = d; bi = i; bt = t; bqy = qy; bqz = qz; }
  }
  return { d: best, i: bi, t: bt, qy: bqy, qz: bqz };
}

function interpZ(z, table) {
  // table: [[z, v], ...] con z decreciente
  if (z >= table[0][0]) return table[0][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [z0, v0] = table[i], [z1, v1] = table[i + 1];
    if (z <= z0 && z >= z1) return mix(v0, v1, (z0 - z) / (z0 - z1));
  }
  return table[table.length - 1][1];
}

const noise = new ImprovedNoise();

// ---------------------------------------------------------------------------
// Geometría de referencia (hemisferio derecho, x > 0)
// ---------------------------------------------------------------------------
const MID = 0.22; // semiancho de la fisura longitudinal
const H = {
  main: ell([3.2, 2.0, -0.6], [3.6, 4.5, 7.6]),
  front: ell([2.75, 1.95, 3.8], [3.15, 3.45, 4.4]),
  occ: ell([2.8, 0.9, -5.2], [2.9, 3.6, 3.4]),
  temp: ell([4.25, -2.35, 0.3], [2.45, 1.85, 4.9]),
  cav: ell([4.1, -0.15, 0.5], [0.75, 1.45, 2.5]), // cavidad de la ínsula (bajo los opérculos)
  dienc: ell([0, 0.1, -0.8], [2.0, 1.8, 2.8]), // espacio del diencéfalo en la cara medial
};

// Cisura lateral (de Silvio) en el plano (y, z): [y, z]
const SYLVIAN = [[-1.25, 5.3], [-1.0, 3.2], [-0.35, 0.0], [0.35, -2.5], [1.3, -3.3]];
const Y_SYLVIAN = [[5.6, -1.25], [3.2, -1.0], [0.0, -0.35], [-2.5, 0.35]];

// Línea media del cuerpo calloso [y, z], grosor y semiancho lateral
const CC_PTS = [[0.5, 2.4], [1.3, 3.45], [2.3, 3.25], [2.75, 1.8], [2.85, 0.0], [2.7, -1.8], [2.3, -3.0], [1.6, -3.75], [1.05, -3.4]];
const CC_R = [0.18, 0.42, 0.4, 0.3, 0.27, 0.29, 0.38, 0.55, 0.42];
const CC_W = [0.7, 1.35, 1.5, 1.5, 1.5, 1.5, 1.5, 1.55, 1.2];
const CC = (() => {
  const s = smoothPath(CC_PTS.map((p) => [p[0], p[1]]), CC_R, 6, CC_W);
  return { P: s.P, R: s.R, W: s.E };
})();

const zCS = (y) => 1.0 - (y - 0.4) * 0.3 + 0.18 * Math.sin(y * 2.3); // surco central
const ySyl = (z) => interpZ(z, Y_SYLVIAN);
const yClass = (z) => (z >= -2.5 ? ySyl(z) : 0.35 - 0.3 * (-2.5 - z));
function zPO(y, x) {
  const med = y >= 0.2 ? -3.6 - (y - 0.2) * 0.386 : -3.6 - (0.2 - y) * 0.6;
  const lat = -5.4 + 0.05 * y;
  return mix(med, lat, smoothstep(0.8, 2.8, x));
}
function ccInfo(y, z) {
  const r = polyDist2(y, z, CC.P);
  const rad = mix(CC.R[r.i], CC.R[r.i + 1], r.t);
  // ¿el punto está por fuera del arco calloso?
  const cy = 1.0, cz = -0.2;
  const ry = r.qy - cy, rz = r.qz - cz;
  const out = ((y - r.qy) * ry + (z - r.qz) * rz) / (Math.hypot(ry, rz) || 1);
  return { d: r.d, rad, outside: out > 0, out };
}

function fissureSlab(x, y, z) {
  const r = polyDist2(y, z, SYLVIAN);
  const xmin = z > 3.0 ? mix(3.3, 2.0, smoothstep(3.0, 4.2, z)) : 3.3;
  const hw = 0.13 + 0.08 * smoothstep(5.0, 3.6, x);
  return Math.max(r.d - hw, xmin - x);
}

function hemiBase(x, y, z) {
  let d = sdEll(x, y, z, H.main);
  d = smin(d, sdEll(x, y, z, H.front), 1.2);
  d = smin(d, sdEll(x, y, z, H.occ), 1.2);
  d = smin(d, sdEll(x, y, z, H.temp), 0.9);
  d = smax(d, MID - x, 0.5); // cara medial plana
  const wT = smoothstep(-2.2, -3.6, z); // tienda del cerebelo
  if (wT > 0) {
    const tent = -2.35 - 0.1 * x - 0.06 * (-3 - z) - y;
    d = mix(d, smax(d, tent, 0.45), wT);
  }
  d = smax(d, -fissureSlab(x, y, z), 0.1);
  d = smax(d, -sdEll(x, y, z, H.cav), 0.35);
  d = smax(d, -sdEll(x, y, z, H.dienc), 0.3);
  return d;
}

/** Plegamiento cortical: surcos principales explícitos + patrón giral secundario. */
function fold(x, y, z) {
  const zc = zCS(y);
  let g = 0;
  // Surco central y surcos pre/poscentral
  g = Math.max(g, groove(z - zc, 0.12) * smoothstep(0.35, 0.9, y));
  g = Math.max(g, groove(z - (zc + 1.35 + 0.15 * Math.sin(y * 2.1)), 0.11) * smoothstep(0.5, 1.0, y) * smoothstep(0.8, 1.6, x));
  g = Math.max(g, groove(z - (zc - 1.25 + 0.12 * Math.sin(y * 1.9 + 1)), 0.11) * smoothstep(0.9, 1.4, y) * smoothstep(0.8, 1.6, x));
  // Lóbulo frontal: surcos frontal superior e inferior
  const inFront = smoothstep(zc + 1.25, zc + 1.8, z) * (1 - smoothstep(6.8, 7.8, z));
  if (inFront > 0) {
    g = Math.max(g, groove(x - (2.1 + 0.18 * Math.sin(z * 1.6)), 0.12) * smoothstep(3.0, 3.8, y) * inFront);
    g = Math.max(g, groove(y - (1.45 - 0.08 * z + 0.15 * Math.sin(z * 1.9)), 0.12) * smoothstep(3.9, 4.6, x) * inFront * (1 - smoothstep(6.2, 7.2, z)));
  }
  // Ramas anteriores de la cisura lateral (delimitan la región de Broca)
  const latX = smoothstep(4.4, 5.2, x);
  if (latX > 0) {
    g = Math.max(g, groove(polyDist2(y, z, [[-0.8, 2.7], [0.7, 2.45]]).d, 0.1) * latX);
    g = Math.max(g, groove(polyDist2(y, z, [[-0.95, 3.4], [-0.55, 4.5]]).d, 0.1) * latX);
  }
  // Surco intraparietal
  const inPar = smoothstep(zc - 1.4, zc - 1.9, z) * smoothstep(zPO(y, x) + 0.1, zPO(y, x) + 0.6, z);
  if (inPar > 0) g = Math.max(g, groove(x - (3.7 + 0.2 * Math.sin(z * 1.3)), 0.12) * smoothstep(2.6, 3.4, y) * inPar);
  // Surcos temporal superior e inferior
  const ys = ySyl(Math.max(z, -2.5)) - (z < -2.5 ? 0.3 * (-2.5 - z) : 0);
  const tz = smoothstep(4.8, 3.8, z) * smoothstep(-5.6, -4.2, z);
  if (tz > 0) {
    g = Math.max(g, groove(y - (ys - 1.25), 0.12) * smoothstep(4.3, 5.0, x) * tz);
    g = Math.max(g, groove(y - (ys - 2.45), 0.11) * smoothstep(4.8, 5.5, x) * tz);
  }
  // Cara medial: surco del cíngulo, parietooccipital y calcarino
  const med = 1 - smoothstep(0.6, 1.3, x);
  if (med > 0) {
    const cc = ccInfo(y, z);
    if (cc.outside) g = Math.max(g, groove(cc.d - 1.75, 0.12) * med * smoothstep(-3.4, -2.8, z));
    g = Math.max(g, groove(z - zPO(y, 0), 0.12) * med * smoothstep(0.0, 0.5, y));
    g = Math.max(g, groove(y - (0.3 - 0.06 * (z + 3.8)), 0.12) * med * smoothstep(-3.6, -4.3, z));
  }

  // Patrón giral secundario (ruido con orientación regional)
  const wFront = smoothstep(zc + 1.6, zc + 2.6, z);
  const wTemp = smoothstep(ys + 0.2, ys - 0.6, y) * smoothstep(5.4, 4.0, z);
  const sz = 1 - 0.4 * Math.max(wFront, wTemp);
  const q = 0.3;
  const wx = noise.noise(x * q + 11.3, y * q, z * q) * 1.1;
  const wy = noise.noise(x * q, y * q + 23.1, z * q) * 1.1;
  const wz = noise.noise(x * q, y * q, z * q + 37.7) * 1.1;
  const f = 0.92;
  const px = (x + wx) * f, py = (y + wy) * f, pz = (z + wz) * f * sz;
  // Unión de dos conjuntos de nivel cero: surcos sinuosos con uniones en "T"
  const n1 = Math.abs(noise.noise(px, py, pz));
  const n2 = Math.abs(noise.noise(px * 0.9 + 5.2, py * 0.9 + 1.7, pz * 0.9 + 9.4)) * 1.25;
  const s = Math.min(n1, n2 + 0.12);
  let amp = 1;
  const motor = smoothstep(zc - 1.35, zc - 1.0, z) * smoothstep(zc + 1.5, zc + 1.15, z) * smoothstep(0.6, 1.2, y);
  amp *= 1 - 0.85 * motor;
  amp *= 1 - 0.75 * g;
  // Surco estrecho y profundo + perfil redondeado de la circunvolución
  const ng = 0.34 * groove(s, 0.055) + 0.16 * (1 - smoothstep(0, 0.42, s));
  const eg = 0.42 * g + 0.2 * g * g;
  const bumps = 0.025 * noise.noise(x * 2.1, y * 2.1, z * 2.1);
  return Math.max(eg, ng * amp) + bumps;
}

function sdHemisphere(x, y, z) {
  const b = hemiBase(x, y, z);
  if (b > 0.8 || b < -1.2) return b;
  return b + fold(x, y, z);
}
const sdWhiteMatter = (x, y, z) => hemiBase(x, y, z) + 0.85;

/**
 * Regiones de cada lóbulo como funciones continuas (positivas dentro de la
 * región). Cada lóbulo se genera como un sólido cerrado:
 *   hemisferio ∩ región ∖ núcleo de sustancia blanca
 * de modo que las piezas encajan entre sí y conservan volumen al desarmarlas.
 * Precedencia: pared diencefálica > ínsula > cíngulo > occipital > temporal > frontal/parietal.
 */
const LOBE_IDS = ['lobulo_frontal', 'lobulo_parietal', 'lobulo_temporal', 'lobulo_occipital', 'insula', 'giro_cingulado'];
function lobeRegions(x, y, z) {
  const Wc = 1.08 - ellNorm(x, y, z, H.dienc);
  const I0 = Math.min(1.18 - ellNorm(x, y, z, H.cav), H.cav.c[0] - 0.15 - x);
  const I = Math.min(I0, -Wc);
  const cc = ccInfo(y, z);
  const C0 = Math.min(1.1 - x, cc.out, cc.d - cc.rad - 0.2, 1.72 - cc.d, z + 4.6);
  const C = Math.min(C0, -Wc, -I0);
  const O = Math.min(zPO(y, x) - z, -Wc, -I0, -C0);
  const T0 = Math.min(yClass(z) - y, 5.4 - z, Math.max(2.6 - z, x - 2.4));
  const T = Math.min(T0, -Wc, -I0, -C0, -(zPO(y, x) - z));
  const rest = Math.min(-Wc, -I0, -C0, -(zPO(y, x) - z), -T0);
  const F = Math.min(z - zCS(y), rest);
  const P = Math.min(zCS(y) - z, rest);
  return { lobulo_frontal: F, lobulo_parietal: P, lobulo_temporal: T, lobulo_occipital: O, insula: I, giro_cingulado: C, wall: Wc };
}

/**
 * Áreas corticales (clasificación jerárquica de Luria + zonas paralímbicas de
 * Mesulam). Se guardan por vértice en el atributo _AREA de cada lóbulo; la
 * lista de ids va en scenes[0].extras.areas. 255 = superficie interna (corte).
 * Las fronteras son aproximadas y siguen los surcos del modelo.
 */
const AREA_IDS = [
  'motora_primaria', 'somatosensorial_primaria', 'auditiva_primaria', 'visual_primaria',
  'premotora', 'broca', 'somatosensorial_asociacion', 'auditiva_asociacion', 'wernicke', 'visual_asociacion', 'temporal_inferior',
  'prefrontal_dorsolateral', 'prefrontal_ventromedial', 'parieto_temporo_occipital', 'temporal_media',
  'cingular', 'insular', 'temporal_medial_polar',
];
const AREA_INDEX = Object.fromEntries(AREA_IDS.map((id, i) => [id, i]));
const INTERIOR = 255;

function corticalArea(lobe, x, y, z) {
  const zc = zCS(y);
  switch (lobe) {
    case 'lobulo_frontal':
      if (z < zc + 1.35 && y > 0.1) return 'motora_primaria'; // giro precentral y lobulillo paracentral anterior
      if (x > 3.6 && z > zc + 1.0 && z < 4.7 && y < 1.55 - 0.08 * z && y > ySyl(z) - 0.3) return 'broca'; // giro frontal inferior posterior
      if (z < zc + 2.7 && y > 0.5) return 'premotora'; // incluye el área motora suplementaria medial
      if ((y < 0.6 && z > 2.5) || x < 1.3 || z > 7.3) return 'prefrontal_ventromedial';
      return 'prefrontal_dorsolateral';
    case 'lobulo_parietal':
      if (z > zc - 1.25) return 'somatosensorial_primaria'; // giro poscentral
      if (x < 3.7) return 'somatosensorial_asociacion'; // lobulillo parietal superior y precúneo
      return 'parieto_temporo_occipital'; // lobulillo parietal inferior: supramarginal y angular
    case 'lobulo_temporal': {
      const ys = yClass(z);
      if (z > 3.4 || (x < 3.0 && y < ys - 1.0)) return 'temporal_medial_polar';
      if (y > ys - 0.45 && x < 5.0 && z > -2.0 && z < 0.7) return 'auditiva_primaria'; // giros de Heschl en el plano temporal superior
      if (y > ys - 1.25) return z < -1.6 && z > -3.8 ? 'wernicke' : 'auditiva_asociacion';
      if (y > ys - 2.45 && x > 4.3) return 'temporal_media';
      return 'temporal_inferior';
    }
    case 'lobulo_occipital':
      if ((x < 1.7 && Math.abs(y - (0.3 - 0.06 * (z + 3.8))) < 0.95 && z < -4.4) || z < -8.0) return 'visual_primaria'; // surco calcarino y polo
      return 'visual_asociacion';
    case 'giro_cingulado':
      return 'cingular';
    case 'insula':
      return 'insular';
  }
  return null;
}

/** Etiqueta cada vértice de la superficie externa (pial) con su área cortical. */
function labelAreas(mesh, lobe) {
  const n = mesh.pos.length / 3;
  mesh.area = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const x = mesh.pos[v * 3], y = mesh.pos[v * 3 + 1], z = mesh.pos[v * 3 + 2];
    const pial = Math.abs(sdHemisphere(x, y, z)) < 0.15;
    const id = pial ? corticalArea(lobe, x, y, z) : null;
    mesh.area[v] = id ? AREA_INDEX[id] : INTERIOR;
  }
  return mesh;
}

// ---------------------------------------------------------------------------
// Estructuras profundas, tronco y cerebelo
// ---------------------------------------------------------------------------
function sdCorpusCallosum(x, y, z) {
  const r = polyDist2(y, z, CC.P);
  const rad = mix(CC.R[r.i], CC.R[r.i + 1], r.t);
  const w = mix(CC.W[r.i], CC.W[r.i + 1], r.t);
  const q = Math.sqrt((r.d / rad) ** 2 + (x / w) ** 2);
  return (q - 1) * rad;
}

const FORNIX = smoothPath(
  [[1.75, -0.3, -2.75], [1.3, 0.9, -2.75], [0.75, 1.72, -2.0], [0.36, 1.95, -0.9], [0.26, 1.92, 0.4], [0.22, 1.4, 1.3], [0.2, 0.45, 1.2], [0.2, -0.4, 0.45], [0.22, -0.95, -0.3]],
  [0.13, 0.15, 0.17, 0.17, 0.16, 0.14, 0.12, 0.11, 0.1]
);
const HIPPO = smoothPath(
  [[2.55, -2.55, 1.15], [2.7, -2.35, 0.2], [2.7, -2.0, -0.8], [2.45, -1.45, -1.8], [2.05, -0.7, -2.55], [1.6, 0.15, -2.85]],
  [0.56, 0.5, 0.42, 0.35, 0.28, 0.2]
);
const CAUDATE = smoothPath(
  [[1.45, 0.9, 2.25], [1.55, 1.35, 1.2], [1.7, 1.6, 0.0], [1.85, 1.5, -1.3], [2.1, 1.0, -2.4], [2.55, 0.0, -2.9], [2.9, -1.0, -2.3], [3.05, -1.5, -1.0], [3.0, -1.7, 0.4]],
  [0.8, 0.62, 0.45, 0.33, 0.24, 0.18, 0.14, 0.12, 0.1]
);
const sdThalamus = (x, y, z) => smin(sdEll(x, y, z, ell([0.95, 0.75, -1.0], [0.8, 0.8, 1.5])), sdEll(x, y, z, ell([1.2, 0.8, -2.05], [0.68, 0.74, 0.72])), 0.3);
const sdAmygdala = (x, y, z) => sdEll(x, y, z, ell([2.35, -1.95, 2.1], [0.62, 0.55, 0.7]));
const sdPutamen = (x, y, z) => sdEll(x, y, z, ell([2.65, 0.35, 0.55], [0.5, 1.05, 1.65]));
const sdPallidus = (x, y, z) => sdEll(x, y, z, ell([2.14, 0.1, 0.25], [0.32, 0.72, 0.95]));
const sdHippocampus = (x, y, z) => sdTube(x, y, z, HIPPO) + 0.035 * noise.noise(x * 3, y * 3, z * 3);
const sdCaudate = (x, y, z) => sdTube(x, y, z, CAUDATE);
const sdFornix = (x, y, z) => sdTube(x, y, z, FORNIX);

function sdHypothalamus(x, y, z) {
  let d = sdEll(x, y, z, ell([0, -0.55, 0.2], [0.55, 0.55, 0.85]));
  const ax = Math.abs(x);
  d = smin(d, sdEll(ax, y, z, ell([0.22, -1.05, -0.45], [0.2, 0.2, 0.22])), 0.15); // cuerpos mamilares
  d = smin(d, sdTube(x, y, z, { P: [[0, -0.9, 0.55], [0, -1.8, 0.9]], R: [0.14, 0.1] }), 0.12); // infundíbulo
  return d;
}

function sdBrainstem(x, y, z) {
  const ax = Math.abs(x);
  let d = sdTube(x, y, z, { P: [[0, -0.9, -1.35], [0, -3.0, -1.25]], R: [0.95, 0.95] }); // mesencéfalo
  d = smin(d, sdEll(ax, y, z, ell([0.55, -1.75, -0.75], [0.45, 0.95, 0.5])), 0.3); // pedúnculos cerebrales
  for (const cy of [-1.55, -2.25]) d = smin(d, sdEll(ax, y, z, ell([0.32, cy, -2.25], [0.25, 0.22, 0.2])), 0.12); // colículos
  d = smin(d, sdEll(x, y, z, ell([0, -3.9, -0.9], [1.35, 1.2, 1.25])), 0.45); // protuberancia
  d = smin(d, sdTube(ax, y, z, { P: [[0.85, -3.9, -1.3], [2.0, -4.3, -2.85]], R: [0.58, 0.5] }), 0.3); // pedúnculo cerebeloso medio
  d = smin(d, sdTube(x, y, z, { P: [[0, -4.9, -1.3], [0, -7.0, -1.6], [0, -8.4, -1.75]], R: [0.85, 0.62, 0.5] }), 0.35); // bulbo
  d = smin(d, sdEll(ax, y, z, ell([0.52, -5.8, -0.95], [0.24, 0.55, 0.24])), 0.1); // olivas
  d = smin(d, sdEll(ax, y, z, ell([0.2, -5.9, -0.85], [0.17, 0.9, 0.17])), 0.08); // pirámides
  return d;
}
function brainstemRegions(x, y, z) {
  const tilt = 0.15 * (z + 1);
  const a = y - (-2.95 + tilt), b = y - (-5.0 + tilt);
  return { mesencefalo: a, protuberancia: Math.min(-a, b), bulbo_raquideo: -b };
}

function sdCerebellum(x, y, z) {
  const ax = Math.abs(x);
  let d = sdEll(ax, y, z, ell([2.55, -4.95, -5.1], [2.7, 2.2, 3.0]));
  d = smin(d, sdEll(x, y, z, ell([0, -4.75, -5.0], [1.2, 2.25, 2.85])), 0.9);
  d = smax(d, y - (-2.6 - 0.1 * ax), 0.4); // cara tentorial
  d = smax(d, -sdTube(x, y, z, { P: [[0, -1.5, -1.4], [0, -8.5, -1.9]], R: [1.35, 1.2] }), 0.4); // escotadura para el tronco
  if (d > 0.5 || d < -0.8) return d;
  // Folias: láminas transversales concéntricas
  // Capas esféricas centradas cerca de la entrada de los pedúnculos: en la vista
  // lateral las folias se abren en abanico hacia atrás, como en el cerebelo real.
  const r = Math.hypot(x * 0.7, y + 0.8, z + 2.8) + 0.1 * noise.noise(x * 0.9, y * 0.9, z * 0.9);
  const lam = Math.pow(0.5 + 0.5 * Math.cos((r * 2 * Math.PI) / 0.36), 4);
  const primary = groove(r - 2.55, 0.08) * smoothstep(-4.4, -3.4, y);
  const horizontal = groove(r - 5.9, 0.08);
  return d + 0.12 * lam + 0.35 * Math.max(primary, horizontal);
}
const cerebellumRegions = (x) => ({ R: x - 0.95, L: -0.95 - x, C: Math.min(0.95 - x, x + 0.95) });

// ---------------------------------------------------------------------------
// Marching cubes con vértices compartidos y normales por gradiente
// ---------------------------------------------------------------------------
const CORNERS = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
// arista -> [dx, dy, dz, eje] de la arista canónica de la malla
const EDGES = [[0, 0, 0, 0], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1], [0, 0, 0, 2], [1, 0, 0, 2], [1, 1, 0, 2], [0, 1, 0, 2]];

function makeGrid(min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  return { min, cell, nx, ny, nz, n: nx * ny * nz };
}
/** Evalúa fn(x,y,z) en cada punto de la malla; fn puede escribir varios campos a la vez. */
function sampleGrid(g, fn) {
  let i = 0;
  for (let k = 0; k < g.nz; k++) {
    const z = g.min[2] + k * g.cell;
    for (let j = 0; j < g.ny; j++) {
      const y = g.min[1] + j * g.cell;
      for (let ii = 0; ii < g.nx; ii++, i++) fn(i, g.min[0] + ii * g.cell, y, z);
    }
  }
}
function marchingCubes(sdf, min, max, cell) {
  const g = makeGrid(min, max, cell);
  const F = new Float32Array(g.n);
  sampleGrid(g, (i, x, y, z) => (F[i] = sdf(x, y, z)));
  return polygonize(F, g);
}
/** Varias piezas sólidas que comparten un campo base: pieza = base ∩ región. */
function solidPieces(sdf, regionsFn, ids, min, max, cell, extra = null) {
  const g = makeGrid(min, max, cell);
  const base = new Float32Array(g.n);
  const R = Object.fromEntries(ids.map((id) => [id, new Float32Array(g.n)]));
  sampleGrid(g, (i, x, y, z) => {
    let b = sdf(x, y, z);
    if (extra) b = extra(b, x, y, z);
    base[i] = b;
    if (b > 0.4) return; // lejos del interior: la región no importa
    const r = regionsFn(x, y, z);
    for (const id of ids) R[id][i] = r[id];
  });
  const out = {};
  for (const id of ids) {
    const F = new Float32Array(g.n);
    const r = R[id];
    for (let i = 0; i < g.n; i++) F[i] = base[i] > 0.4 ? base[i] : Math.max(base[i], -r[i]);
    out[id] = polygonize(F, g);
  }
  return out;
}
function polygonize(F, g) {
  const { min, cell, nx, ny, nz } = g;
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const grad = (i, j, k) => {
    const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx - 1);
    const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, ny - 1);
    const k0 = Math.max(k - 1, 0), k1 = Math.min(k + 1, nz - 1);
    return [(F[idx(i1, j, k)] - F[idx(i0, j, k)]) / (i1 - i0), (F[idx(i, j1, k)] - F[idx(i, j0, k)]) / (j1 - j0), (F[idx(i, j, k1)] - F[idx(i, j, k0)]) / (k1 - k0)];
  };
  const edgeVert = new Map();
  const pos = [], nor = [], ind = [];
  const vertOnEdge = (i, j, k, axis) => {
    const key = (idx(i, j, k) * 3 + axis);
    const hit = edgeVert.get(key);
    if (hit !== undefined) return hit;
    const i2 = i + (axis === 0), j2 = j + (axis === 1), k2 = k + (axis === 2);
    const a = F[idx(i, j, k)], b = F[idx(i2, j2, k2)];
    const t = a / (a - b);
    pos.push(min[0] + (i + (i2 - i) * t) * cell, min[1] + (j + (j2 - j) * t) * cell, min[2] + (k + (k2 - k) * t) * cell);
    const ga = grad(i, j, k), gb = grad(i2, j2, k2);
    let gx = mix(ga[0], gb[0], t), gy = mix(ga[1], gb[1], t), gz = mix(ga[2], gb[2], t);
    const l = Math.hypot(gx, gy, gz) || 1;
    nor.push(gx / l, gy / l, gz / l);
    const v = pos.length / 3 - 1;
    edgeVert.set(key, v);
    return v;
  };
  const vals = new Float32Array(8);
  const ev = new Int32Array(12);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let ci = 0;
        for (let c = 0; c < 8; c++) {
          vals[c] = F[idx(i + CORNERS[c][0], j + CORNERS[c][1], k + CORNERS[c][2])];
          if (vals[c] < 0) ci |= 1 << c;
        }
        const bits = edgeTable[ci];
        if (!bits) continue;
        for (let e = 0; e < 12; e++) if (bits & (1 << e)) ev[e] = vertOnEdge(i + EDGES[e][0], j + EDGES[e][1], k + EDGES[e][2], EDGES[e][3]);
        const o = ci * 16;
        for (let t = 0; triTable[o + t] !== -1; t += 3) ind.push(ev[triTable[o + t]], ev[triTable[o + t + 1]], ev[triTable[o + t + 2]]);
      }
  const mesh = { pos: Float32Array.from(pos), nor: Float32Array.from(nor), ind: Uint32Array.from(ind) };
  orientOutward(mesh);
  return mesh;
}

/** Garantiza que el orden de los triángulos coincida con la normal saliente. */
function orientOutward(m) {
  let agree = 0;
  const { pos: p, nor: n, ind } = m;
  for (let t = 0; t < ind.length; t += 3 * 97) {
    const a = ind[t] * 3, b = ind[t + 1] * 3, c = ind[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    agree += Math.sign(fx * n[a] + fy * n[a + 1] + fz * n[a + 2]);
  }
  if (agree < 0) for (let t = 0; t < ind.length; t += 3) { const s = ind[t + 1]; ind[t + 1] = ind[t + 2]; ind[t + 2] = s; }
}

function mirrorX(m) {
  const pos = m.pos.slice(), nor = m.nor.slice(), ind = m.ind.slice();
  for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nor[i] = -nor[i]; }
  for (let t = 0; t < ind.length; t += 3) { const s = ind[t + 1]; ind[t + 1] = ind[t + 2]; ind[t + 2] = s; }
  return { pos, nor, ind, area: m.area?.slice() };
}
/** Suavizado de Taubin (reduce el escalonado sin encoger la malla). */
function taubin(m, iters = 2, lambda = 0.5, mu = -0.53) {
  const n = m.pos.length / 3;
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < m.ind.length; t += 3) {
    const a = m.ind[t], b = m.ind[t + 1], c = m.ind[t + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const step = (f) => {
    const src = m.pos.slice();
    for (let v = 0; v < n; v++) {
      if (!nb[v].size) continue;
      let sx = 0, sy = 0, sz = 0;
      for (const u of nb[v]) { sx += src[u * 3]; sy += src[u * 3 + 1]; sz += src[u * 3 + 2]; }
      const k = nb[v].size;
      m.pos[v * 3] += f * (sx / k - src[v * 3]);
      m.pos[v * 3 + 1] += f * (sy / k - src[v * 3 + 1]);
      m.pos[v * 3 + 2] += f * (sz / k - src[v * 3 + 2]);
    }
  };
  for (let i = 0; i < iters; i++) { step(lambda); step(mu); }
  return m;
}

// ---------------------------------------------------------------------------
// Optimización y escritura GLB
//   - simplificación conservadora (meshoptimizer) con bordes bloqueados para
//     que los lóbulos vecinos sigan encajando
//   - posiciones int16 y normales int8 (KHR_mesh_quantization)
//   - compresión EXT_meshopt_compression (decodificador incluido en three.js)
// ---------------------------------------------------------------------------
const POS_SCALE = 1 / 1000; // 1 unidad entera = 0,01 mm

function optimizeMesh(m, ratio) {
  let ind = m.ind;
  if (ratio < 1) {
    const target = Math.floor((ind.length / 3) * ratio) * 3;
    [ind] = MeshoptSimplifier.simplify(ind, m.pos, 3, target, 0.0012, ['LockBorder']);
  }
  ind = Uint32Array.from(ind);
  const [remap, unique] = MeshoptEncoder.reorderMesh(ind, true, false);
  const pos = new Float32Array(unique * 3), nor = new Float32Array(unique * 3);
  const area = m.area ? new Uint8Array(unique) : null;
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    pos.set(m.pos.subarray(v * 3, v * 3 + 3), r * 3);
    nor.set(m.nor.subarray(v * 3, v * 3 + 3), r * 3);
    if (area) area[r] = m.area[v];
  }
  return { pos, nor, ind, area };
}

function writeGLB(parts, file) {
  const EXT = 'EXT_meshopt_compression';
  const json = {
    asset: { version: '2.0', generator: 'NeuroAtlas procedural brain generator' },
    extensionsUsed: ['KHR_mesh_quantization', EXT],
    extensionsRequired: ['KHR_mesh_quantization', EXT],
    scene: 0,
    scenes: [{ name: 'Encefalo', nodes: [], extras: { areas: AREA_IDS } }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
    buffers: [{ byteLength: 0 }, { byteLength: 0, extensions: { [EXT]: { fallback: true } } }],
  };
  const chunks = [];
  let offset = 0, rawOffset = 0;
  const align4 = (n) => (n + 3) & ~3;
  const addView = (arr, target, stride, count, mode) => {
    const raw = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const enc = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode);
    const view = {
      buffer: 1, byteOffset: rawOffset, byteLength: raw.length, target,
      extensions: { [EXT]: { buffer: 0, byteOffset: offset, byteLength: enc.length, byteStride: stride, count, mode } },
    };
    if (target === 34962) view.byteStride = stride;
    json.bufferViews.push(view);
    chunks.push(Buffer.from(enc));
    offset += enc.length;
    const pad = align4(offset) - offset;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    rawOffset = align4(rawOffset + raw.length);
    return json.bufferViews.length - 1;
  };
  const matIndex = new Map();
  let tris = 0;
  for (const part of parts) {
    const { name, color, structureId, side } = part;
    const mesh = optimizeMesh(part.mesh, part.simplify ?? 1);
    const vc = mesh.pos.length / 3;
    tris += mesh.ind.length / 3;
    const pq = new Int16Array(vc * 4);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < vc; v++)
      for (let k = 0; k < 3; k++) {
        const q = Math.round(mesh.pos[v * 3 + k] / POS_SCALE);
        pq[v * 4 + k] = q;
        mn[k] = Math.min(mn[k], q);
        mx[k] = Math.max(mx[k], q);
      }
    const nq = new Int8Array(vc * 4);
    for (let v = 0; v < vc; v++) for (let k = 0; k < 3; k++) nq[v * 4 + k] = Math.round(clamp(mesh.nor[v * 3 + k], -1, 1) * 127);
    const small = vc < 65536;
    const ind = small ? Uint16Array.from(mesh.ind) : mesh.ind;
    json.accessors.push({ bufferView: addView(pq, 34962, 8, vc, 'ATTRIBUTES'), componentType: 5122, count: vc, type: 'VEC3', min: mn, max: mx });
    const pAcc = json.accessors.length - 1;
    json.accessors.push({ bufferView: addView(nq, 34962, 4, vc, 'ATTRIBUTES'), componentType: 5120, normalized: true, count: vc, type: 'VEC3' });
    const nAcc = json.accessors.length - 1;
    json.accessors.push({ bufferView: addView(ind, 34963, small ? 2 : 4, ind.length, 'TRIANGLES'), componentType: small ? 5123 : 5125, count: ind.length, type: 'SCALAR' });
    const iAcc = json.accessors.length - 1;
    if (!matIndex.has(structureId)) {
      json.materials.push({ name: structureId, pbrMetallicRoughness: { baseColorFactor: [...hexToLinear(color), 1], metallicFactor: 0, roughnessFactor: 0.72 } });
      matIndex.set(structureId, json.materials.length - 1);
    }
    const attributes = { POSITION: pAcc, NORMAL: nAcc };
    if (mesh.area) {
      // Atributo propio (prefijo _): índice de área cortical por vértice, relleno a 4 bytes
      const aq = new Uint8Array(vc * 4);
      for (let v = 0; v < vc; v++) aq[v * 4] = mesh.area[v];
      json.accessors.push({ bufferView: addView(aq, 34962, 4, vc, 'ATTRIBUTES'), componentType: 5121, count: vc, type: 'SCALAR' });
      attributes._AREA = json.accessors.length - 1;
    }
    json.meshes.push({ name, primitives: [{ attributes, indices: iAcc, material: matIndex.get(structureId) }] });
    json.nodes.push({ name, mesh: json.meshes.length - 1, scale: [POS_SCALE, POS_SCALE, POS_SCALE], extras: { structureId, side } });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  console.log(`  Total tras optimizar: ${tris} triángulos`);
  json.buffers[0].byteLength = offset;
  json.buffers[1].byteLength = rawOffset;
  let jsonBuf = Buffer.from(JSON.stringify(json));
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, bin]));
}
function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
}

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------
const COLORS = {
  lobulo_frontal: '#e2b4a6', lobulo_parietal: '#e2b4a6', lobulo_temporal: '#e2b4a6', lobulo_occipital: '#e2b4a6',
  insula: '#d9a898', giro_cingulado: '#dcae9f', sustancia_blanca: '#efe6d8', cuerpo_calloso: '#f3ede2', fornix: '#eee0c8',
  talamo: '#9bb7d4', hipotalamo: '#d98bb0', hipocampo: '#e9b949', amigdala: '#d9695f', nucleo_caudado: '#7fb58f',
  putamen: '#5f9e8f', globo_palido: '#a8c79a', mesencefalo: '#d8b08c', protuberancia: '#cfa27e', bulbo_raquideo: '#c89a78', cerebelo: '#d19a93',
};

const parts = [];
// Proporción de triángulos que se conserva al simplificar
const SIMPLIFY = { lobulo_frontal: 0.45, lobulo_parietal: 0.45, lobulo_temporal: 0.45, lobulo_occipital: 0.45, insula: 0.55, giro_cingulado: 0.55, sustancia_blanca: 0.25, cerebelo: 0.5 };
const addPart = (id, side, mesh) => {
  parts.push({ name: `${id}__${side}`, structureId: id, side, mesh, color: COLORS[id], simplify: SIMPLIFY[id] ?? 0.45 });
  console.log(`  ${`${id}__${side}`.padEnd(26)} ${String(mesh.pos.length / 3).padStart(7)} vért. ${String(mesh.ind.length / 3).padStart(7)} tri.`);
};
const addBilateral = (id, mesh) => { addPart(id, 'R', mesh); addPart(id, 'L', mirrorX(mesh)); };
const t0 = Date.now();
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

console.log('Hemisferio cerebral (corteza)…');
// Cada lóbulo es un sólido: hemisferio ∩ región del lóbulo, sin el núcleo de sustancia blanca
const lobes = solidPieces(sdHemisphere, lobeRegions, LOBE_IDS, [0, -4.8, -9.2], [7.3, 7.0, 8.9], 0.1, (b, x, y, z) => Math.max(b, -(sdWhiteMatter(x, y, z) + 0.06)));
for (const id of LOBE_IDS) addBilateral(id, labelAreas(taubin(lobes[id], 2), id));
console.log('Sustancia blanca…');
const sdWhitePiece = (x, y, z) => Math.min(sdWhiteMatter(x, y, z), Math.max(sdHemisphere(x, y, z), ellNorm(x, y, z, H.dienc) - 1.08));
addBilateral('sustancia_blanca', taubin(marchingCubes(sdWhitePiece, [0, -4.8, -9.2], [7.3, 7.0, 8.9], 0.14), 2));

console.log('Estructuras profundas…');
addPart('cuerpo_calloso', 'C', taubin(marchingCubes(sdCorpusCallosum, [-1.7, -0.2, -4.6], [1.7, 3.6, 4.2], 0.07), 1));
addBilateral('fornix', taubin(marchingCubes(sdFornix, [0, -1.4, -3.2], [2.2, 2.4, 1.8], 0.06), 1));
addBilateral('talamo', taubin(marchingCubes(sdThalamus, [0, -0.3, -3.0], [2.1, 1.8, 0.8], 0.075), 1));
addPart('hipotalamo', 'C', taubin(marchingCubes(sdHypothalamus, [-0.8, -2.0, -0.9], [0.8, 0.2, 1.3], 0.06), 1));
addBilateral('hipocampo', taubin(marchingCubes(sdHippocampus, [1.0, -3.3, -3.3], [3.5, 0.6, 1.9], 0.07), 1));
addBilateral('amigdala', taubin(marchingCubes(sdAmygdala, [1.6, -2.7, 1.3], [3.1, -1.3, 2.9], 0.07), 1));
addBilateral('nucleo_caudado', taubin(marchingCubes(sdCaudate, [0.5, -2.0, -3.3], [3.4, 2.4, 3.2], 0.065), 1));
addBilateral('putamen', taubin(marchingCubes(sdPutamen, [2.0, -0.9, -1.3], [3.3, 1.6, 2.4], 0.075), 1));
addBilateral('globo_palido', taubin(marchingCubes(sdPallidus, [1.7, -0.8, -0.9], [2.6, 1.0, 1.4], 0.07), 1));

console.log('Tronco encefálico…');
const STEM_IDS = ['mesencefalo', 'protuberancia', 'bulbo_raquideo'];
const stem = solidPieces(sdBrainstem, brainstemRegions, STEM_IDS, [-2.7, -8.9, -3.6], [2.7, 0.2, 0.6], 0.08);
for (const id of STEM_IDS) addPart(id, 'C', taubin(stem[id], 1));

console.log('Cerebelo…');
const cereb = solidPieces(sdCerebellum, cerebellumRegions, ['L', 'R', 'C'], [-5.6, -7.5, -8.4], [5.6, -2.3, -1.8], 0.075);
for (const side of ['L', 'R', 'C']) addPart('cerebelo', side, taubin(cereb[side], 1));

writeGLB(parts, OUT);
const size = fs.statSync(OUT).size;
console.log(`\nGLB escrito en ${path.relative(process.cwd(), OUT)} (${(size / 1048576).toFixed(2)} MB) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
