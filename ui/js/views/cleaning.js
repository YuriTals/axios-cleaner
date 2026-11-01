// Telas de limpeza: grupos de categorias e Lixeira.

import { BIG_CACHE_BYTES, BIG_CACHE_TIP, BIG_CACHE_TIPS } from "../catalog.js";
import { esc, fmt, nf, plural } from "../format.js";
import { S, busy, catsOf, filesOf, scanning, selIn, sum, bytesOf } from "../state.js";
import { actionBar, bigNumber, cleanNote, panelHeader } from "../widgets.js";

const DETAIL_ROWS = 8;

function detailsHtml(id) {
  const d = S.details[id];
  if (!d || d === "loading") return `<div class="details"><div class="muted">Lendo…</div></div>`;
  if (!d.locations.length) return `<div class="details"><div class="muted">Nada para limpar agora.</div></div>`;
  const locations = d.locations.slice(0, DETAIL_ROWS).map((l) =>
    `<div class="drow"><button class="linkbtn path" data-open="${esc(l.path)}" title="Abrir pasta">${esc(l.path)}</button><span class="size">${fmt(l.bytes)} · ${nf(l.files)}</span></div>`).join("");
  const largest = d.largest.slice(0, DETAIL_ROWS).map((f) =>
    `<div class="drow"><button class="linkbtn path" data-reveal="${esc(f.path)}" title="Mostrar no Explorer">${esc(f.path.split("\\").pop())}</button><span class="size">${fmt(f.bytes)}</span></div>`).join("");
  return `<div class="details"><div class="dh">Onde está</div>${locations}<div class="dh">Maiores arquivos</div>${largest}</div>`;
}

function rowState(c) {
  const scanned = S.scan[c.id];
  if (S.working === c.id) return ["working", `limpando · ${fmt(S.run?.freed || 0)}`];
  if (S.cleaned[c.id]) return ["done", `−${fmt(S.cleaned[c.id].freed)}`];
  return ["", scanned ? fmt(scanned.bytes) : scanning() ? "···" : "—"];
}

function categoryRow(c) {
  const on = S.selected.has(c.id);
  const [state, size] = rowState(c);
  const open = S.openDetails === c.id;
  const openTag = (S.scan[c.id]?.running || []).length ? `<span class="tag">ABERTO</span>` : "";
  const serviceTag = c.services.length ? `<span class="tag soft">PAUSA SERVIÇO</span>` : "";
  const big = bytesOf(c.id) >= BIG_CACHE_BYTES;
  const bigTag = big ? `<span class="tag">GRANDE</span>` : "";
  const tip = big ? `<span class="desc tip">! ${esc(BIG_CACHE_TIPS[c.id] || BIG_CACHE_TIP)}</span>` : "";
  return `
    <div class="row ${state}" aria-checked="${on}">
      <button class="row-main" role="checkbox" aria-checked="${on}" data-toggle="${c.id}">
        <span class="check"></span>
        <span class="main">
          <span class="name">${esc(c.name)}${bigTag}${openTag}${serviceTag}</span>
          <span class="desc">${esc(c.desc)}</span>${tip}
        </span>
        <span class="size">${size}</span>
      </button>
      <button class="row-more" data-details="${c.id}" title="Ver detalhes" aria-expanded="${open}">${open ? "[-]" : "[+]"}</button>
    </div>
    ${open ? detailsHtml(c.id) : ""}`;
}

export function viewGroup(ch) {
  const cats = catsOf(ch.group);
  const ids = cats.map((c) => c.id);
  const selected = selIn(ids);
  const allOn = selected.length === ids.length;
  const bytes = sum(selected, bytesOf);
  const total = sum(ids, bytesOf);
  const action = `group:${ch.group}`;
  return `
    <section class="panel">
      ${panelHeader(ch.id, ch.t, `<button class="linkbtn mono" data-all="${ch.group}">${allOn ? "Desmarcar tudo" : "Marcar tudo"}</button>`)}
      <div class="sub">${ch.sub}</div>
      <div class="list scroll">${cats.map(categoryRow).join("")}</div>
      ${actionBar({
        label: "Selecionado", size: bytes, count: plural(sum(selected, filesOf), "item", "itens"),
        note: cleanNote(ids, action), frac: total ? bytes / total : 0,
        action, buttonLabel: "LIMPAR", disabled: busy() || bytes === 0, simulate: true,
      })}
    </section>`;
}

export function viewRecycle() {
  const r = S.scan.recycle;
  const res = S.summary?.scope === "recycle" ? S.summary : null;
  const note = res ? `<b>Liberado ${fmt(res.freed)}</b> · ${plural(res.files, "item", "itens")}`
    : r && r.files === 0 ? "A Lixeira já está vazia." : "Esvaziar apaga de vez, de todas as unidades.";
  return `
    <section class="panel">
      ${panelHeader("recycle", "Lixeira")}
      <div class="rec-hero">
        ${bigNumber(r ? r.bytes : 0, r ? "white" : "dim", !r)}
        <div class="caption">${r ? plural(r.files, "item", "itens") : "Sem leitura"}</div>
      </div>
      <div class="list">
        <div class="row static"><span class="row-main"><span class="main"><span class="name">Todas as unidades</span><span class="desc">A Lixeira de cada disco é esvaziada de uma vez.</span></span><span class="size">${r ? fmt(r.bytes) : "—"}</span></span></div>
      </div>
      <div style="flex:1"></div>
      ${actionBar({
        label: "Na Lixeira", size: r ? r.bytes : 0, count: plural(r ? r.files : 0, "item", "itens"),
        note, frac: r?.bytes ? 1 : 0, action: "recycle", buttonLabel: "ESVAZIAR", disabled: busy() || !r || r.files === 0,
      })}
    </section>`;
}

