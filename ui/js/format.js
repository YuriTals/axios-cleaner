// Funcoes puras de formatacao e de desenho em ASCII (testadas em tests/ui).

import { APP_NAMES } from "./catalog.js";

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;
const TB = KB ** 4;

export const nf = (n, d = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Escolhe a unidade e as casas decimais de um tamanho em bytes. */
export function sizeParts(bytes) {
  const units = [["TB", TB], ["GB", GB], ["MB", MB], ["KB", KB]];
  const [unit, scale] = units.find(([, s]) => bytes >= s) || units[units.length - 1];
  const value = bytes / scale;
  const decimals = unit === "KB" ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return { value, decimals, unit };
}

export function fmt(bytes) {
  const { value, decimals, unit } = sizeParts(bytes);
  return `${nf(value, decimals)} ${unit}`;
}

export const plural = (n, one, many) => `${nf(n)} ${n === 1 ? one : many}`;

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const appNames = (list) => list.map((p) => APP_NAMES[p] || p.replace(/\.exe$/i, ""));

/** Um item por nome amigavel: Teams.exe e ms-teams.exe viram um so "Teams". */
export function groupApps(exes) {
  const groups = {};
  exes.forEach((exe) => (groups[appNames([exe])[0]] ||= []).push(exe));
  return Object.entries(groups).map(([name, list]) => ({ name, exes: list }));
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** "há 3 dias", "há 2 meses"... a partir de segundos desde 1970. */
export function ago(secs, nowMs = Date.now()) {
  if (!secs) return "";
  const days = (nowMs / 1000 - secs) / 86400;
  if (days < 1) return "hoje";
  if (days < 2) return "ontem";
  if (days < 30) return `há ${Math.floor(days)} dias`;
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `há ${m} ${m === 1 ? "mês" : "meses"}`;
  }
  const y = Math.floor(days / 365);
  return `há ${y} ${y === 1 ? "ano" : "anos"}`;
}

/** "restam ~20 s" / "restam ~3 min". */
export function remaining(secs) {
  return secs < 60 ? `restam ~${Math.max(1, Math.ceil(secs))} s` : `restam ~${Math.round(secs / 60)} min`;
}

/** Barra ASCII: [=====-----]. */
export function asciiBar(frac, width = 24) {
  const filled = Math.round(clamp01(frac) * width);
  return `[<b>${"=".repeat(filled)}</b>${"-".repeat(width - filled)}]`;
}

/** Grafico de area em ASCII: cada coluna e uma amostra (0-100), de baixo para cima. */
export function asciiChart(values, width = 64, rows = 3) {
  const cols = Array(Math.max(0, width - values.length)).fill(null).concat(values.slice(-width));
  const cell = (v, row, isLast) => {
    const empty = row === 0 ? "<i>.</i>" : " ";
    if (v == null) return empty;
    const level = (v / 100) * rows;
    const ch = level >= row + 1 ? "=" : level > row + 0.5 ? "-" : level > row || (row === 0 && v > 0) ? "." : "";
    if (!ch) return empty;
    const cls = isLast ? "now" : v > 88 ? "hot" : "";
    return cls ? `<b class="${cls}">${ch}</b>` : ch;
  };
  const lines = [];
  for (let row = rows - 1; row >= 0; row--) {
    lines.push(cols.map((v, i) => cell(v, row, i === cols.length - 1)).join(""));
  }
  return `<pre>${lines.join("\n")}</pre>`;
}

/** Pasta acima de um caminho do Windows; "C:\Users" -> "C:\". */
export function parentOf(path) {
  const p = path.replace(/\\+$/, "");
  const i = p.lastIndexOf("\\");
  if (i < 0) return null;
  const up = p.slice(0, i);
  return up.length === 2 ? up + "\\" : up;
}
