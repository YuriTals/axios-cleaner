// Ferramentas: arquivos grandes, mapa de espaco, inicializacao e manutencao.

import { BIG_FILE_SIZES_MB, TASKS } from "../catalog.js";
import { ago, asciiBar, esc, fmt, parentOf, plural } from "../format.js";
import { runButton, runFor, runHint } from "../run.js";
import { S, busy } from "../state.js";
import { actionBar, empty, panelHeader } from "../widgets.js";
import { mapSegments } from "../canvas.js";

// ---------------------------------------------------------------------------
// Arquivos grandes
// ---------------------------------------------------------------------------

const sizeLabel = (mb) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);

function bigFileRow(f) {
  const on = S.big.picked.has(f.path);
  return `
    <div class="row" aria-checked="${on}">
      <button class="row-main" role="checkbox" aria-checked="${on}" data-pick="${esc(f.path)}" ${busy() ? "disabled" : ""}>
        <span class="check"></span>
        <span class="main"><span class="name">${esc(f.name)}</span><span class="desc">${esc(f.folder || "Pasta do usuário")} · ${ago(f.modified)}</span></span>
        <span class="size">${fmt(f.bytes)}</span>
      </button>
      <button class="row-more" data-reveal="${esc(f.path)}" title="Mostrar no Explorer">↗</button>
    </div>`;
}

function bigFileList() {
  const B = S.big;
  if (B.loading) return empty(`<span class="spinner"></span><br>Procurando arquivos grandes<br><button class="linkbtn mono" data-cancel="large">Parar</button>`);
  if (!B.items) return empty("Escolha o tamanho mínimo para procurar.");
  if (!B.items.length) return empty(`Nenhum arquivo acima de ${sizeLabel(B.min)}.`);
  return B.items.map(bigFileRow).join("");
}

export function viewBig() {
  const B = S.big;
  const chips = BIG_FILE_SIZES_MB.map((mb) => `<button data-bigmin="${mb}" aria-pressed="${B.min === mb}">${sizeLabel(mb)}</button>`).join("");
  const items = B.items || [];
  const picked = items.filter((f) => B.picked.has(f.path));
  const bytes = picked.reduce((a, f) => a + f.bytes, 0);
  const total = items.reduce((a, f) => a + f.bytes, 0);
  const note = B.result
    ? `<b>${plural(B.result[0], "arquivo enviado", "arquivos enviados")} para a Lixeira</b> · ${fmt(B.result[1])}`
    : "Destino: Lixeira — dá para restaurar depois.";
  return `
    <section class="panel">
      ${panelHeader("big", "Arquivos grandes", `<div class="toggle">${chips}</div>`)}
      <div class="sub">Na sua pasta de usuário (Downloads, Documentos, Vídeos…). Nada vem marcado: revise e escolha.</div>
      <div class="list scroll">${bigFileList()}</div>
      ${actionBar({
        label: "Selecionado", size: bytes, count: plural(picked.length, "arquivo", "arquivos"), note,
        frac: total ? bytes / total : 0, action: "recycle-big", buttonLabel: "MOVER P/ LIXEIRA",
        disabled: !picked.length || B.loading || busy(),
      })}
    </section>`;
}

// ---------------------------------------------------------------------------
// Mapa de espaco
// ---------------------------------------------------------------------------

function mapRoots() {
  const disks = (S.stats?.disks || []).map((d) => ({ label: d.mount.replace(/\\$/, ""), path: d.mount }));
  return [{ label: "Usuário", path: S.map.home }, ...disks].filter((r) => r.path);
}

function mapLoading() {
  const p = S.map.progress || {};
  const f = p.total ? (p.done + 0.5) / p.total : 0;
  return empty(`
    <div class="bignum white" style="justify-content:center"><span class="v">${Math.floor(f * 100)}</span><span class="u">%</span></div>
    <div class="ascii" style="margin:10px 0">${asciiBar(f, 32)}</div>
    Lendo ${esc(p.current || "…")} · ${fmt(p.bytes || 0)}<br>
    <button class="linkbtn mono" data-cancel="map">Parar</button>`);
}

function mapLegend() {
  return mapSegments().map((s, k) => `
    <button class="mrow ${S.map.hover === k ? "hot" : ""}" ${s.dir && !s.other ? `data-mapgo="${esc(s.path)}"` : "disabled"} data-seg="${k}">
      <i style="background:${s.color}"></i><span class="mname">${esc(s.name)}</span><span class="size">${fmt(s.bytes)}</span>
    </button>`).join("");
}

function mapBody() {
  const M = S.map;
  if (M.loading) return mapLoading();
  if (!M.data) return empty("Escolha uma pasta ou disco para mapear.");
  return `
    <div class="mapwrap">
      <div class="ring"><canvas id="mapring"></canvas>
        <div class="ring-c"><div class="mono muted">${M.data.partial ? "Parcial" : "Mapeado"}</div><div class="ring-v">${fmt(M.data.total)}</div></div>
      </div>
      <div class="mlegend">${mapLegend()}<div class="hint" style="text-align:left">Clique numa pasta para entrar nela.</div></div>
    </div>`;
}

function mapCrumb() {
  const M = S.map;
  if (!M.data || M.loading) return "&nbsp;";
  const up = parentOf(M.data.path);
  return `${up ? `<button class="linkbtn mono" data-mapgo="${esc(up)}">&lt;- Voltar</button>` : ""}<span class="path">${esc(M.data.path)}</span>`;
}

export function viewMap() {
  const chips = mapRoots().map((r) => `<button data-maproot="${esc(r.path)}" aria-pressed="${S.map.root === r.path}">${esc(r.label)}</button>`).join("");
  return `
    <section class="panel">
      ${panelHeader("map", "Mapa de espaço", `<div class="toggle">${chips}</div>`)}
      <div class="crumb">${mapCrumb()}</div>
      ${mapBody()}
    </section>`;
}

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------

function startupRow(it) {
  return `
    <div class="row" aria-checked="${it.enabled}">
      <button class="row-main" role="switch" aria-checked="${it.enabled}" data-startup="${esc(it.id)}">
        <span class="main"><span class="name">${esc(it.name)}</span><span class="desc one" title="${esc(it.command)}">${esc(it.source)} · ${esc(it.command)}</span></span>
        <span class="switch"></span>
      </button>
    </div>`;
}

export function viewStartup() {
  const items = S.startup;
  const list = !items ? empty(`<span class="spinner"></span><br>Lendo`)
    : !items.length ? empty("Nenhum programa inicia com o Windows.")
      : items.map(startupRow).join("");
  const counter = items ? `<span class="mono muted">${items.filter((i) => i.enabled).length}/${items.length} ligados</span>` : "";
  return `
    <section class="panel">
      ${panelHeader("startup", "Programas na inicialização", counter)}
      <div class="sub">Desligar é reversível, igual ao Gerenciador de Tarefas: dá para religar depois.</div>
      <div class="list scroll">${list}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Manutencao
// ---------------------------------------------------------------------------

function taskState(t) {
  const st = S.tasks.status[t.id];
  if (st === "running") return ["working", "rodando", t.desc];
  if (st) return [st.ok ? "done" : "fail", st.ok ? `ok · ${st.secs}s` : "falhou", esc(st.msg)];
  return ["", t.time, t.desc];
}

function taskRow(t, locked) {
  const on = S.tasks.picked.has(t.id);
  const [state, size, desc] = taskState(t);
  return `
    <div class="row ${state}" aria-checked="${on}">
      <button class="row-main" role="checkbox" aria-checked="${on}" data-task="${t.id}" ${locked ? "disabled" : ""}>
        <span class="check"></span>
        <span class="main"><span class="name">${t.name}</span><span class="desc">${desc}</span></span>
        <span class="size">${size}</span>
      </button>
    </div>`;
}

const durationLabel = (secs) => (secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`);

export function viewTasks() {
  const running = runFor("tasks");
  const picked = TASKS.filter((t) => S.tasks.picked.has(t.id));
  const estimate = picked.reduce((a, t) => a + t.est, 0);
  return `
    <section class="panel">
      ${panelHeader("tasks", "Manutenção do Windows")}
      <div class="sub">Ferramentas do próprio Windows, rodadas em sequência. As mais longas podem levar vários minutos.</div>
      <div class="list scroll">${TASKS.map((t) => taskRow(t, !!running)).join("")}</div>
      <div class="actionbar">
        <div class="ab-info">
          <div class="mono">Fila</div>
          <div class="ab-size">${picked.length} <small>· ${picked.length === 1 ? "tarefa" : "tarefas"} · ~${durationLabel(estimate)}</small></div>
          <div class="ab-note">Pode continuar usando o PC enquanto roda.</div>
        </div>
        <div>
          ${runButton("tasks", "RODAR", (busy() && !running) || !picked.length)}
          <div class="hint">${runHint("tasks")}</div>
        </div>
      </div>
    </section>`;
}
