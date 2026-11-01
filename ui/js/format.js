// Funcoes puras de formatacao e de desenho em ASCII (testadas em tests/ui).

import { APP_NAMES } from "./catalog.js";
import { locale, t } from "./i18n.js";

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;
const TB = KB ** 4;

export const nf = (n, d = 0) => n.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });

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

/** "1 arquivo" / "3 arquivos" (as palavras passam pelo tradutor). */
export const plural = (n, one, many) => `${nf(n)} ${t(n === 1 ? one : many)}`;

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
  if (days < 1) return t("hoje");
  if (days < 2) return t("ontem");
  if (days < 30) return t("há {n} dias", { n: Math.floor(days) });
  if (days < 365) {
    const n = Math.floor(days / 30);
    return t(n === 1 ? "há 1 mês" : "há {n} meses", { n });
  }
  const n = Math.floor(days / 365);
  return t(n === 1 ? "há 1 ano" : "há {n} anos", { n });
}

/** "restam ~20 s" / "restam ~3 min". */
export function remaining(secs) {
  return secs < 60 ? t("restam ~{n} s", { n: Math.max(1, Math.ceil(secs)) }) : t("restam ~{n} min", { n: Math.round(secs / 60) });
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
