// Desenhos em ASCII no canvas: nucleo do inicio, anel do mapa e bolhas.

import { MAP_COLORS } from "./catalog.js";
import { runFraction } from "./run.js";
import { S, areas, scanning } from "./state.js";

export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const FONT = (px) => `500 ${px}px "IBM Plex Mono", monospace`;
const TURN = Math.PI * 2;

/** Prepara o canvas para o tamanho atual (com DPI) e devolve o contexto. */
function prepare(cv) {
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  return { ctx, w, h };
}

/** Angulo de um ponto em voltas (0..1), comecando no topo, sentido horario. */
function turnOf(dx, dy) {
  const a = (Math.atan2(dy, dx) + Math.PI / 2) / TURN;
  return a < 0 ? a + 1 : a;
}

/** Fim acumulado de cada fatia (0..1). */
function sliceEnds(values) {
  const total = values.reduce((a, b) => a + b, 0);
  let acc = 0;
  return values.map((v) => (acc += v / total));
}

function sliceAt(ends, turn) {
  const k = ends.findIndex((e) => turn <= e);
  return k < 0 ? ends.length - 1 : k;
}

/** Caractere do anel conforme a profundidade (borda interna -> externa). */
const ringChar = (depth) => (depth > 0.66 ? "=" : depth > 0.33 ? "-" : ":");

// ---------------------------------------------------------------------------
// Nucleo da tela inicial
// ---------------------------------------------------------------------------

const CORE = {
  cell: 10,
  colStep: 0.78,
  innerRatio: 0.7,
  margin: 10,
  dotsGap: 16,
  spinSpeed: 0.000025,  // voltas por ms
  sweepSpeed: 0.00035,
  sweepWidth: 0.012,
  dimAlpha: 0.22,
};

let coreGeom = null;

function coreGeometry(w, h, t) {
  const slices = areas().filter((a) => a.bytes > 0);
  const R = Math.min(w, h) / 2 - CORE.margin;
  return {
    cx: w / 2, cy: h / 2, R, r0: R * CORE.innerRatio,
    spin: reduceMotion ? 0 : (t * CORE.spinSpeed) % 1,
    slices,
    ends: slices.length ? sliceEnds(slices.map((s) => s.bytes)) : [],
  };
}

/** Indice da area (na lista completa de areas) sob o angulo dado. */
function areaIndexAt(g, turn) {
  const k = sliceAt(g.ends, (turn - g.spin + 1) % 1);
  return areas().findIndex((a) => a.name === g.slices[k].name);
}

function coreCell(g, turn, depth, d, scanF) {
  if (scanF != null || !g.slices.length) {
    const lit = scanF != null && turn <= scanF;
    return { ch: lit ? ringChar(depth) : "·", color: lit ? "#FF2448" : "#2A2A30", alpha: 1 };
  }
  const rel = (turn - g.spin + 1) % 1;
  const k = sliceAt(g.ends, rel);
  const start = k ? g.ends[k - 1] : 0;
  const onEdge = g.slices.length > 1 && Math.min(rel - start, g.ends[k] - rel) * TURN * d < CORE.cell * 0.55;
  let alpha = onEdge ? 0.3 : 1;
  if (S.coreHover >= 0 && areas().findIndex((a) => a.name === g.slices[k].name) !== S.coreHover) alpha *= CORE.dimAlpha;
  return { ch: onEdge ? "·" : ringChar(depth), color: g.slices[k].color, alpha };
}

export function drawCore(t) {
  const cv = document.querySelector("#corecv");
  const p = cv && prepare(cv);
  if (!p) return;
  const { ctx, w, h } = p;
  const g = (coreGeom = coreGeometry(w, h, t));
  const scanF = scanning() ? runFraction(S.run) : null;
  const sweep = (t * CORE.sweepSpeed) % 1;
  ctx.font = FONT(CORE.cell);

  for (let y = CORE.cell / 2; y < h; y += CORE.cell) {
    for (let x = CORE.cell / 2; x < w; x += CORE.cell * CORE.colStep) {
      const dx = x - g.cx, dy = y - g.cy, d = Math.hypot(dx, dy);
      if (Math.abs(d - (g.r0 - CORE.dotsGap)) < CORE.cell * 0.45) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#3A3A40";
        ctx.fillText("·", x, y);
        continue;
      }
      if (d < g.r0 || d > g.R) continue;
      const turn = turnOf(dx, dy);
      const cell = coreCell(g, turn, (d - g.r0) / (g.R - g.r0), d, scanF);
      const nearSweep = Math.min(Math.abs(turn - sweep), 1 - Math.abs(turn - sweep)) < CORE.sweepWidth;
      ctx.globalAlpha = nearSweep ? Math.min(1, cell.alpha + 0.5) : cell.alpha;
      ctx.fillStyle = cell.color;
      ctx.fillText(cell.ch, x, y);
    }
  }
  ctx.globalAlpha = 1;
}

/** Area do nucleo sob o mouse, ou -1. */
export function coreAreaAt(e) {
  const cv = document.querySelector("#corecv");
  const g = coreGeom;
  if (!g || !cv || !g.slices.length || scanning()) return -1;
  const rect = cv.getBoundingClientRect();
  const dx = e.clientX - rect.left - g.cx, dy = e.clientY - rect.top - g.cy;
  const d = Math.hypot(dx, dy);
  return d < g.r0 || d > g.R ? -1 : areaIndexAt(g, turnOf(dx, dy));
}

// ---------------------------------------------------------------------------
// Anel do mapa de espaco
// ---------------------------------------------------------------------------

const MAP = { cell: 11, colStep: 0.8, innerRatio: 0.52, margin: 6, topSlices: 7 };

/** Chamado ao clicar numa pasta do anel (definido em main.js). */
export const mapHooks = { open: () => {} };

export function mapSegments() {
  const d = S.map.data;
  if (!d || !d.total) return [];
  const top = d.items.filter((i) => i.bytes > 0).slice(0, MAP.topSlices);
  const rest = d.total - top.reduce((a, i) => a + i.bytes, 0);
  const segs = top.map((i, k) => ({ ...i, color: MAP_COLORS[k] }));
  if (rest > 0) segs.push({ name: "Outros", bytes: rest, color: MAP_COLORS[MAP.topSlices], other: true });
  return segs;
}

function highlightLegend() {
  document.querySelectorAll(".mrow").forEach((el) => el.classList.toggle("hot", +el.dataset.seg === S.map.hover));
}

export function drawMap() {
  const cv = document.querySelector("#mapring");
  const p = cv && prepare(cv);
  if (!p) return;
  const { ctx, w, h } = p;
  const segs = mapSegments();
  if (!segs.length) return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - MAP.margin, r0 = R * MAP.innerRatio;
  const ends = sliceEnds(segs.map((s) => s.bytes));
  ctx.font = FONT(MAP.cell);

  for (let y = MAP.cell / 2; y < h; y += MAP.cell) {
    for (let x = MAP.cell / 2; x < w; x += MAP.cell * MAP.colStep) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d < r0 || d > R) continue;
      const turn = turnOf(dx, dy);
      const k = sliceAt(ends, turn);
      const start = k ? ends[k - 1] : 0;
      const onEdge = segs.length > 1 && Math.min(turn - start, ends[k] - turn) * TURN * d < MAP.cell * 0.6;
      const dimmed = S.map.hover >= 0 && S.map.hover !== k;
      ctx.globalAlpha = onEdge ? 0.25 : dimmed ? 0.22 : 1;
      ctx.fillStyle = segs[k].color;
      ctx.fillText(onEdge ? "·" : ringChar((d - r0) / (R - r0)), x, y);
    }
  }
  ctx.globalAlpha = 1;

  const segmentAt = (e) => {
    const rect = cv.getBoundingClientRect();
    const dx = e.clientX - rect.left - cx, dy = e.clientY - rect.top - cy, d = Math.hypot(dx, dy);
    return d >= r0 && d <= R ? sliceAt(ends, turnOf(dx, dy)) : -1;
  };
  const setHover = (k) => {
    if (k === S.map.hover) return;
    S.map.hover = k;
    drawMap();
    highlightLegend();
  };
  cv.onmousemove = (e) => setHover(segmentAt(e));
  cv.onmouseleave = () => setHover(-1);
  cv.onclick = () => {
    const s = segs[S.map.hover];
    if (s?.dir && !s.other) mapHooks.open(s.path);
  };
}

// ---------------------------------------------------------------------------
// Bolhas ASCII (metaballs) da tela de resultado
// ---------------------------------------------------------------------------

const BLOB_LEVELS = [
  [3.2, "=", "#9A9AA0"],
  [2.1, "-", "#E8203F"],
  [1.45, ":", "#C81B37"],
  [1.0, ".", "#8C1328"],
];
const BLOB_COUNT = 3;
const STILL_TIME = 20000; // instante fixo usado com "reduzir movimento"

function blobsAt(w, h, cell, seed, t) {
  const scale = Math.min(w, h) / 260;
  return Array.from({ length: BLOB_COUNT }, (_, k) => {
    const ph = seed * 1.7 + k * 2.3;
    return {
      x: w * (0.5 + 0.38 * Math.sin(t * 0.00011 * (1 + k * 0.35) + ph)),
      y: h * (0.5 + 0.34 * Math.cos(t * 0.00014 * (1 + k * 0.22) + ph * 1.3)),
      r: cell * (2.1 + k * 0.9) * scale * (1 + 0.32 * Math.sin(t * 0.0006 * (1 + k * 0.4) + ph)),
    };
  });
}

function drawBlobs(cv, t) {
  const p = prepare(cv);
  if (!p) return;
  const { ctx, w, h } = p;
  const cell = cv.classList.contains("full") ? 18 : 15;
  const balls = blobsAt(w, h, cell, +cv.dataset.seed || 1, t);
  ctx.font = FONT(Math.round(cell * 0.72));
  for (let y = cell / 2; y < h; y += cell) {
    for (let x = cell / 2; x < w; x += cell) {
      const field = balls.reduce((f, b) => f + (b.r * b.r) / ((x - b.x) ** 2 + (y - b.y) ** 2 + 1), 0);
      const level = BLOB_LEVELS.find(([min]) => field >= min);
      if (!level) continue;
      ctx.fillStyle = level[2];
      ctx.fillText(level[1], x, y);
    }
  }
}

// ---------------------------------------------------------------------------
// Laco de animacao (~30 fps)
// ---------------------------------------------------------------------------

const FRAME_MS = 33;
let lastFrame = 0;

function frame(now) {
  if (now - lastFrame > FRAME_MS && !document.hidden) {
    lastFrame = now;
    const t = reduceMotion ? STILL_TIME : now;
    document.querySelectorAll("canvas.blobs").forEach((cv) => drawBlobs(cv, t));
    drawCore(now);
  }
  requestAnimationFrame(frame);
}

export function startAnimation() {
  requestAnimationFrame(frame);
}
