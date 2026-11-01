// Ferramentas: arquivos grandes, duplicados, mapa de espaco, inicializacao e manutencao.

import { BIG_FILE_SIZES_MB, DUP_SIZES_MB, TASKS } from "../catalog.js";
import { ago, asciiBar, esc, fmt, parentOf, plural } from "../format.js";
import { t, tb } from "../i18n.js";
import { runButton, runFor, runHint } from "../run.js";
import { S, busy, dupGroupsFullyPicked } from "../state.js";
import { actionBar, empty, panelHeader } from "../widgets.js";
import { mapSegments } from "../canvas.js";

const sizeLabel = (mb) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);

const sentNote = (result) =>
  `<b>${t("{files} para a Lixeira", { files: plural(result[0], "arquivo enviado", "arquivos enviados") })}</b> · ${fmt(result[1])}`;

// ---------------------------------------------------------------------------
// Arquivos grandes
// ---------------------------------------------------------------------------

function bigFileRow(f) {
  const on = S.big.picked.has(f.path);
  return `
    <div class="row" aria-checked="${on}">
      <button class="row-main" role="checkbox" aria-checked="${on}" data-pick="${esc(f.path)}" ${busy() ? "disabled" : ""}>
        <span class="check"></span>
        <span class="main"><span class="name">${esc(f.name)}</span><span class="desc">${esc(f.folder || t("Pasta do usuário"))} · ${ago(f.modified)}</span></span>
        <span class="size">${fmt(f.bytes)}</span>
      </button>
      <button class="row-more" data-reveal="${esc(f.path)}" title="${t("Mostrar no Explorer")}">↗</button>
    </div>`;
}

function bigFileList() {
  const B = S.big;
  if (B.loading) return empty(`<span class="spinner"></span><br>${t("Procurando arquivos grandes")}<br><button class="linkbtn mono" data-cancel="large">${t("Parar")}</button>`);
  if (!B.items) return empty(t("Escolha o tamanho mínimo para procurar."));
  if (!B.items.length) return empty(t("Nenhum arquivo acima de {size}.", { size: sizeLabel(B.min) }));
  return B.items.map(bigFileRow).join("");
}

export function viewBig() {
  const B = S.big;
  const chips = BIG_FILE_SIZES_MB.map((mb) => `<button data-bigmin="${mb}" aria-pressed="${B.min === mb}">${sizeLabel(mb)}</button>`).join("");
  const items = B.items || [];
  const picked = items.filter((f) => B.picked.has(f.path));
  const bytes = picked.reduce((a, f) => a + f.bytes, 0);
  const total = items.reduce((a, f) => a + f.bytes, 0);
  const note = B.result ? sentNote(B.result) : t("Destino: Lixeira — dá para restaurar depois.");
  return `
    <section class="panel">
      ${panelHeader("big", t("Arquivos grandes"), `<div class="toggle">${chips}</div>`)}
      <div class="sub">${t("Na sua pasta de usuário (Downloads, Documentos, Vídeos…). Nada vem marcado: revise e escolha.")}</div>
      <div class="list scroll">${bigFileList()}</div>
      ${actionBar({
        label: t("Selecionado"), size: bytes, count: plural(picked.length, "arquivo", "arquivos"), note,
        frac: total ? bytes / total : 0, action: "recycle-big", buttonLabel: t("MOVER P/ LIXEIRA"),
        disabled: !picked.length || B.loading || busy(),
      })}
    </section>`;
}

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------

function dupFileRow(f, k) {
  const on = S.dups.picked.has(f.path);
  return `
    <div class="row" aria-checked="${on}">
      <button class="row-main" role="checkbox" aria-checked="${on}" data-duppick="${esc(f.path)}" ${busy() ? "disabled" : ""}>
        <span class="check"></span>
        <span class="main"><span class="name">${esc(f.name)}${k === 0 ? `<span class="tag soft">${t("MAIS ANTIGA")}</span>` : ""}</span><span class="desc">${esc(f.folder || t("Pasta do usuário"))} · ${ago(f.modified)}</span></span>
      </button>
      <button class="row-more" data-reveal="${esc(f.path)}" title="${t("Mostrar no Explorer")}">↗</button>
    </div>`;
}

function dupGroup(g) {
  const full = g.files.every((f) => S.dups.picked.has(f.path));
  const status = full ? t("todas marcadas: deixe uma") : t("{size} a liberar", { size: fmt(g.bytes * (g.files.length - 1)) });
  return `
    <div class="dgroup ${full ? "full" : ""}">
      <div class="dgroup-h"><span>${t("{n} cópias · {size} cada", { n: g.files.length, size: fmt(g.bytes) })}</span><span>${status}</span></div>
      ${g.files.map(dupFileRow).join("")}
    </div>`;
}

function dupList() {
  const D = S.dups;
  if (D.loading) {
    const p = D.progress || {};
    const f = p.total ? p.done / p.total : 0;
    return empty(`
      <span class="spinner"></span><br>${esc(tb(p.phase || "Listando"))} · ${p.total ? `${p.done}/${p.total}` : t("lendo pastas")}<br>
      <div class="ascii" style="margin:10px 0">${asciiBar(f, 32)}</div>
      <span class="muted">${esc(p.current || "")}</span><br>
      <button class="linkbtn mono" data-cancel="dups">${t("Parar")}</button>`);
  }
  if (D.error) return empty(esc(tb(D.error)));
  if (!D.groups) return empty(`${t("Procura arquivos com exatamente o mesmo conteúdo, mesmo com nomes diferentes.")}<br><br><button class="btn" data-dupsearch>${t("Procurar")}</button>`);
  if (!D.groups.length) return empty(t("Nenhum arquivo duplicado acima de {size}.", { size: sizeLabel(D.min) }));
  return D.groups.map(dupGroup).join("");
}

export function viewDups() {
  const D = S.dups;
  const root = D.root || S.map.home || "";
  const chips = DUP_SIZES_MB.map((mb) => `<button data-dupmin="${mb}" aria-pressed="${D.min === mb}">${sizeLabel(mb)}</button>`).join("");
  const groups = D.groups || [];
  const files = groups.flatMap((g) => g.files);
  const picked = files.filter((f) => D.picked.has(f.path));
  const bytes = picked.reduce((a, f) => a + f.bytes, 0);
  const wasted = groups.reduce((a, g) => a + g.bytes * (g.files.length - 1), 0);
  const blocked = dupGroupsFullyPicked().length > 0;
  const note = blocked ? `<b>${t("Em algum grupo todas as cópias estão marcadas.")}</b> ${t("Deixe pelo menos uma.")}`
    : D.result ? sentNote(D.result) : t("Destino: Lixeira — dá para restaurar depois.");
  const tools = groups.length ? `<button class="linkbtn mono" data-dupmark>${t("Marcar cópias")}</button>` : "";
  return `
    <section class="panel">
      ${panelHeader("dups", t("Arquivos duplicados"), `<div class="toggle">${chips}</div>`)}
      <div class="crumb">
        <button class="linkbtn mono" data-duproot="home" ${D.loading ? "disabled" : ""}>${t("Usuário")}</button>
        <button class="linkbtn mono" data-duproot="pick" ${D.loading ? "disabled" : ""}>${t("Escolher pasta…")}</button>
        <span class="path">${esc(root)}</span>
        ${D.groups && !D.loading ? `<button class="linkbtn mono" data-dupsearch>${t("Procurar de novo")}</button>` : ""}${tools}
      </div>
      <div class="sub">${t("Nada vem marcado: revise e escolha. Cópias usadas por programas, como mods em cada instância de um jogo, podem ser necessárias. Pastas do Windows, de programas e da Steam ficam de fora.")}</div>
      <div class="list scroll">${dupList()}</div>
      ${actionBar({
        label: t("Selecionado"), size: bytes, count: `${plural(picked.length, "arquivo", "arquivos")} · ${t("{size} em cópias", { size: fmt(wasted) })}`, note,
        frac: wasted ? bytes / wasted : 0, action: "recycle-dups", buttonLabel: t("MOVER P/ LIXEIRA"),
        disabled: !picked.length || D.loading || busy() || blocked,
      })}
    </section>`;
}

// ---------------------------------------------------------------------------
// Mapa de espaco
// ---------------------------------------------------------------------------

function mapRoots() {
  const disks = (S.stats?.disks || []).map((d) => ({ label: d.mount.replace(/\\$/, ""), path: d.mount }));
  return [{ label: t("Usuário"), path: S.map.home }, ...disks].filter((r) => r.path);
}

function mapLoading() {
  const p = S.map.progress || {};
  const f = p.total ? (p.done + 0.5) / p.total : 0;
  return empty(`
    <div class="bignum white" style="justify-content:center"><span class="v">${Math.floor(f * 100)}</span><span class="u">%</span></div>
    <div class="ascii" style="margin:10px 0">${asciiBar(f, 32)}</div>
    ${t("Lendo {path} · {size}", { path: esc(p.current || "…"), size: fmt(p.bytes || 0) })}<br>
    <button class="linkbtn mono" data-cancel="map">${t("Parar")}</button>`);
}

function mapLegend() {
  return mapSegments().map((s, k) => `
    <button class="mrow ${S.map.hover === k ? "hot" : ""}" ${s.dir && !s.other ? `data-mapgo="${esc(s.path)}"` : "disabled"} data-seg="${k}">
      <i style="background:${s.color}"></i><span class="mname">${esc(s.other ? t(s.name) : s.name)}</span><span class="size">${fmt(s.bytes)}</span>
    </button>`).join("");
}

function mapBody() {
  const M = S.map;
  if (M.loading) return mapLoading();
  if (!M.data) return empty(t("Escolha uma pasta ou disco para mapear."));
  return `
    <div class="mapwrap">
      <div class="ring"><canvas id="mapring"></canvas>
        <div class="ring-c"><div class="mono muted">${t(M.data.partial ? "Parcial" : "Mapeado")}</div><div class="ring-v">${fmt(M.data.total)}</div></div>
      </div>
      <div class="mlegend">${mapLegend()}<div class="hint" style="text-align:left">${t("Clique numa pasta para entrar nela.")}</div></div>
    </div>`;
}

function mapCrumb() {
  const M = S.map;
  if (!M.data || M.loading) return "&nbsp;";
  const up = parentOf(M.data.path);
  return `${up ? `<button class="linkbtn mono" data-mapgo="${esc(up)}">&lt;- ${t("Voltar")}</button>` : ""}<span class="path">${esc(M.data.path)}</span>`;
}

export function viewMap() {
  const chips = mapRoots().map((r) => `<button data-maproot="${esc(r.path)}" aria-pressed="${S.map.root === r.path}">${esc(r.label)}</button>`).join("");
  return `
    <section class="panel">
      ${panelHeader("map", t("Mapa de espaço"), `<div class="toggle">${chips}</div>`)}
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
        <span class="main"><span class="name">${esc(it.name)}</span><span class="desc one" title="${esc(it.command)}">${esc(tb(it.source))} · ${esc(it.command)}</span></span>
        <span class="switch"></span>
      </button>
    </div>`;
}

export function viewStartup() {
  const items = S.startup;
  const list = !items ? empty(`<span class="spinner"></span><br>${t("Lendo")}`)
    : !items.length ? empty(t("Nenhum programa inicia com o Windows."))
      : items.map(startupRow).join("");
  const counter = items ? `<span class="mono muted">${t("{on}/{total} ligados", { on: items.filter((i) => i.enabled).length, total: items.length })}</span>` : "";
  return `
    <section class="panel">
      ${panelHeader("startup", t("Programas na inicialização"), counter)}
      <div class="sub">${t("Desligar é reversível, igual ao Gerenciador de Tarefas: dá para religar depois.")}</div>
      <div class="list scroll">${list}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Manutencao
// ---------------------------------------------------------------------------

function taskState(task) {
  const st = S.tasks.status[task.id];
  if (st === "running") return ["working", t("rodando"), t(task.desc)];
  if (st) return [st.ok ? "done" : "fail", st.ok ? `ok · ${st.secs}s` : t("falhou"), esc(tb(st.msg))];
  return ["", t(task.time), t(task.desc)];
}

function taskRow(task, locked) {
  const on = S.tasks.picked.has(task.id);
  const [state, size, desc] = taskState(task);
  return `
    <div class="row ${state}" aria-checked="${on}">
      <button class="row-main" role="checkbox" aria-checked="${on}" data-task="${task.id}" ${locked ? "disabled" : ""}>
        <span class="check"></span>
        <span class="main"><span class="name">${t(task.name)}</span><span class="desc">${desc}</span></span>
        <span class="size">${size}</span>
      </button>
    </div>`;
}

const durationLabel = (secs) => (secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`);

export function viewTasks() {
  const running = runFor("tasks");
  const picked = TASKS.filter((task) => S.tasks.picked.has(task.id));
  const estimate = picked.reduce((a, task) => a + task.est, 0);
  return `
    <section class="panel">
      ${panelHeader("tasks", t("Manutenção do Windows"))}
      <div class="sub">${t("Ferramentas do próprio Windows, rodadas em sequência. As mais longas podem levar vários minutos.")}</div>
      <div class="list scroll">${TASKS.map((task) => taskRow(task, !!running)).join("")}</div>
      <div class="actionbar">
        <div class="ab-info">
          <div class="mono">${t("Fila")}</div>
          <div class="ab-size">${picked.length} <small>· ${t(picked.length === 1 ? "tarefa" : "tarefas")} · ~${durationLabel(estimate)}</small></div>
          <div class="ab-note">${t("Pode continuar usando o PC enquanto roda.")}</div>
        </div>
        <div>
          ${runButton("tasks", t("RODAR"), (busy() && !running) || !picked.length)}
          <div class="hint">${runHint("tasks")}</div>
        </div>
      </div>
    </section>`;
}
