// Tela inicial: nucleo ASCII, lixo por area, telemetria e unidades.

import { CHANNELS } from "../catalog.js";
import { asciiChart, esc, fmt, nf, plural } from "../format.js";
import { runButton } from "../run.js";
import { S, allIds, areas, bigCaches, busy, bytesOf, filesOf, scanning, selIn, selectedBytes, sum } from "../state.js";
import { bigNumber, cleanNote } from "../widgets.js";

const HOT_PERCENT = 88;

/** Largura (em caracteres) das barras ASCII das unidades, conforme a janela. */
const DISK_BAR_MIN = 20;
const DISK_BAR_MAX = 220;
const DISK_ROW_CHROME_PX = 560; // rotulos, % e "livres" ao redor da barra
const MONO_CHAR_PX = 6.95;
const diskBarWidth = () => Math.max(DISK_BAR_MIN, Math.min(DISK_BAR_MAX, Math.floor((window.innerWidth - DISK_ROW_CHROME_PX) / MONO_CHAR_PX) - 2));

function areaList(scanned) {
  return areas().map((a, k) => `
    <button class="grow ${a.bytes ? "" : "zero"} ${S.coreHover === k ? "hot" : ""}" data-go="${a.route}" data-area="${k}">
      <i style="background:${a.color}"></i><span class="gname">${a.name}</span><span class="gdots"></span>
      <span class="gsize">${scanned ? fmt(a.bytes) : scanning() ? "···" : "—"}</span>
    </button>`).join("");
}

/** Avisos de cache gigante: levam para a tela da categoria, com a dica. */
function bigCacheWarnings() {
  const list = bigCaches();
  if (!list.length || scanning()) return "";
  return `<div class="hwarns">${list.map((c) => {
    const route = CHANNELS.find((ch) => ch.group === c.group)?.id || "home";
    return `<button class="hwarn" data-go="${route}" title="Ver dica"><span>!</span> ${esc(c.name)} · <b>${fmt(bytesOf(c.id))}</b></button>`;
  }).join("")}</div>`;
}

function coreCaption(scanned) {
  if (scanning()) return ["Analisando", `analisando ${S.run.done}/${S.run.total}`];
  if (scanned) return ["Lixo detectado", plural(sum(selIn(allIds()), filesOf), "item", "itens")];
  return ["Aguardando", "sem leitura"];
}

export function viewHome() {
  const junk = selectedBytes();
  const scanned = S.scanAt != null;
  const time = S.scanAt ? S.scanAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--";
  const [caption, sub] = coreCaption(scanned);
  return `
    <section class="home-l">
      <div class="hhead"><span class="mono">Lixo por área</span><span class="ph-dots"></span></div>
      ${areaList(scanned)}
      ${bigCacheWarnings()}
      <div class="hfoot">scan <b>${time}</b> · ${S.scanSecs ? `${S.scanSecs}s` : "--"}<br>
        <button class="linkbtn mono rescan" data-rescan ${busy() ? "disabled" : ""}>&gt; Analisar de novo</button></div>
    </section>

    <section class="core" id="core">
      <canvas id="corecv"></canvas>
      <div class="core-c">
        ${bigNumber(junk, scanned ? "" : "dim", !scanned && !scanning())}
        <div class="caption">${caption}</div>
        <div class="core-sub">${sub}</div>
      </div>
    </section>

    <section class="home-act">
      ${runButton("all", "LIMPAR TUDO", busy() || junk === 0)}
      <div class="act-note">${cleanNote(allIds(), "all")}</div>
    </section>

    <section class="home-r">
      <div class="hhead"><span class="mono">Telemetria</span><span class="ph-dots"></span><span class="live mono"><i></i>Ao vivo</span></div>
      <div id="tel">${telemetryHtml()}</div>
    </section>

    ${disksHtml(junk)}`;
}

export function telemetryHtml() {
  const st = S.stats, h = S.hist;
  const memPct = st ? (st.mem_used / st.mem_total) * 100 : null;
  const memSub = st ? `${nf(st.mem_used / 1024 ** 3, 1)}/${nf(st.mem_total / 1024 ** 3, 0)} GB` : "";
  const rows = [
    ["CPU", st?.cpu, "", h.cpu],
    ["GPU", st?.gpu, "", h.gpu],
    ["MEM", memPct, memSub, h.mem],
    ["DISCO", st?.disk_activity, "atividade", h.disk],
  ];
  return rows.map(([label, value, sub, history]) => `
    <div class="tel">
      <div class="tel-h"><span class="mono">${label}<small>${sub}</small></span><span class="tel-v ${value > HOT_PERCENT ? "hot" : ""}">${value != null ? Math.round(value) : "--"}<small>%</small></span></div>
      <div class="spark">${asciiChart(history)}</div>
    </div>`).join("");
}

function diskLine(d, junk, after, width) {
  const j = d.system ? junk : 0;
  const used = Math.max(0, d.used - (after ? j : 0));
  const junkChars = after || !j ? 0 : Math.max(1, Math.round((j / d.total) * width));
  const usedChars = Math.max(0, Math.round((used / d.total) * width) - junkChars);
  const freeChars = Math.max(0, width - usedChars - junkChars);
  const bar = `[<u>${"=".repeat(usedChars)}</u><b>${"=".repeat(junkChars)}</b>${"·".repeat(freeChars)}]`;
  const extra = j ? (after ? ` · <b>+${fmt(j)}</b>` : ` · <b>${fmt(j)} lixo</b>`) : "";
  return `<div class="dline">
    <span class="dl-m">${esc(d.mount.replace(/\\$/, ""))}</span>
    <span class="dl-l">${esc(d.system ? "sistema" : (d.label || "local").toLowerCase())}</span>
    <span class="ascii dl-bar">${bar}</span>
    <span class="dl-p">${Math.round((used / d.total) * 100)}%</span>
    <span class="dl-f">${fmt(d.total - used)} livres${extra}</span>
  </div>`;
}

export function disksHtml(junk) {
  const after = S.diskView === "after";
  const width = diskBarWidth();
  const lines = (S.stats?.disks || []).map((d) => diskLine(d, junk, after, width)).join("");
  return `
    <section class="home-disks" id="disks">
      <div class="hhead"><span class="mono">Unidades</span><span class="ph-dots"></span>
        <div class="toggle"><button data-disk="now" aria-pressed="${!after}">Agora</button><button data-disk="after" aria-pressed="${after}">Após limpar</button></div>
      </div>
      ${lines || `<div class="dline">lendo unidades…</div>`}
    </section>`;
}
