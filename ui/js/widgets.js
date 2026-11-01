// Pecas de interface usadas por varias telas.

import { channel } from "./catalog.js";
import { appNames, asciiBar, esc, fmt, nf, plural, sizeParts } from "./format.js";
import { t } from "./i18n.js";
import { runButton, runHint } from "./run.js";
import { S, scanning, selIn } from "./state.js";

export function bigNumber(bytes, cls = "", placeholder = false) {
  const { value, decimals, unit } = sizeParts(bytes);
  return `<div class="bignum ${cls}"><span class="v">${placeholder ? "--" : nf(value, decimals)}</span><span class="u">${unit}</span></div>`;
}

export function panelHeader(id, title, right = "") {
  return `<header class="ph"><span class="ph-id">${channel(id).code}</span><span class="ph-sl">//</span><span class="ph-t">${title}</span><span class="ph-dots"></span><span class="ph-r">${right}</span></header>`;
}

export const blobCanvas = (seed, cls = "") => `<canvas class="blobs ${cls}" data-seed="${seed}"></canvas>`;

export const empty = (html) => `<div class="empty">${html}</div>`;

function runningApps(ids) {
  const names = new Set();
  ids.forEach((id) => appNames(S.scan[id]?.running || []).forEach((n) => names.add(n)));
  return [...names];
}

function lastResultNote(s) {
  const freed = t(s.cancelled ? "Cancelado · Liberado {size}" : "Liberado {size}", { size: fmt(s.freed) });
  return `<b>${freed}</b> · ${plural(s.files, "arquivo", "arquivos")}` +
    (s.skipped ? ` · ${plural(s.skipped, "em uso pulado", "em uso pulados")}` : "") +
    (s.closed.length ? ` · ${t("fechados: {apps}", { apps: appNames(s.closed).join(", ") })}` : "") +
    (s.restore_error ? ` · ${t("sem ponto de restauração")}` : "");
}

/** Frase sob o botao de limpar: andamento, ultimo resultado ou o que vai acontecer. */
export function cleanNote(ids, action) {
  if (S.run?.kind === "clean") return t("Arquivos em uso são pulados — o log da limpeza lista todos.");
  if (scanning()) return t("Lendo o disco, só leitura.");
  if (S.summary?.scope === action) return lastResultNote(S.summary);
  const apps = runningApps(selIn(ids));
  if (!apps.length) return t("Apagado de vez, sem passar pela Lixeira.");
  return S.settings.closeApps
    ? `${t("Vai perguntar antes de fechar:")} <b>${apps.join(", ")}</b>`
    : t("{apps} aberto — arquivos em uso serão pulados.", { apps: apps.join(", ") });
}

/** Link "Simular sem apagar" ao lado de um botao de limpeza. */
export const simulateLink = (action, disabled) =>
  `<button class="linkbtn mono simlink" data-simulate="${action}" ${disabled ? "disabled" : ""} title="${t("Lista o que seria apagado, sem apagar nada")}">&gt; ${t("Simular sem apagar")}</button>`;

/** Rodape das telas de lista: resumo a esquerda, botao de execucao a direita. */
export function actionBar({ label, size, count, note, frac, action, buttonLabel, disabled, simulate = false }) {
  return `
    <div class="actionbar">
      <div class="ab-info">
        <div class="mono">${label}</div>
        <div class="ab-size">${fmt(size)} <small>· ${count}</small></div>
        <div class="ab-note"><span class="ascii">${asciiBar(frac, 16)}</span>${note}</div>
        ${simulate ? simulateLink(action, disabled) : ""}
      </div>
      <div>
        ${runButton(action, buttonLabel, disabled)}
        <div class="hint">${runHint(action)}</div>
      </div>
    </div>`;
}

/** Linha com switch [ ON ] / [ OFF ]. */
export function switchRow({ on, attrs, name, desc = "" }) {
  return `
    <div class="row" aria-checked="${on}"><button class="row-main" role="switch" aria-checked="${on}" ${attrs}>
      <span class="main"><span class="name">${esc(name)}</span>${desc ? `<span class="desc">${desc}</span>` : ""}</span>
      <span class="switch"></span>
    </button></div>`;
}
