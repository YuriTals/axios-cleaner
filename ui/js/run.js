// Botao de execucao: segurar para iniciar, % ao vivo e cancelar no hover.
//
// S.run descreve a tarefa em andamento:
//   { kind: "scan" | "clean" | "simulate" | "tasks" | "recycle" | "update", action, cancel?, start, ... }

import { taskById } from "./catalog.js";
import { asciiBar, esc, fmt, remaining } from "./format.js";
import { catName, t, tb } from "./i18n.js";
import { S, busy } from "./state.js";

const HOLD_MS = 1000;
const MAX_UNFINISHED = 0.99;
const TASK_MAX_GUESS = 0.95; // uma tarefa longa nunca passa de 95% da estimativa
const ETA_MIN_FRACTION = 0.03;
const ETA_MIN_SECONDS = 1.5;
const BAR_WIDTH = 30;
const LONG_LABEL = 12;

export const KIND_LABEL = { scan: "Analisando", clean: "Limpando", simulate: "Simulando", tasks: "Manutenção", recycle: "Lixeira", update: "Atualizando" };

const isCleanAction = (a) => a === "all" || a === "recycle" || a.startsWith("group:");

/** A tarefa em andamento que este botao deve mostrar (se houver). */
export function runFor(action) {
  const r = S.run;
  if (!r) return null;
  if (r.action === action) return r;
  if (["clean", "scan", "simulate"].includes(r.kind) && isCleanAction(action)) return r;
  return null;
}

function tasksFraction(r) {
  const est = r.curId ? taskById(r.curId).est : 0;
  const elapsed = r.curStart ? (performance.now() - r.curStart) / 1000 : 0;
  const current = est ? Math.min(elapsed / est, TASK_MAX_GUESS) * est : 0;
  return (r.doneW + current) / Math.max(1, r.totalW);
}

export function runFraction(r) {
  if (r.finished) return 1;
  const raw = {
    clean: () => (r.done + r.cur) / Math.max(1, r.total),
    scan: () => r.done / Math.max(1, r.total),
    simulate: () => r.done / Math.max(1, r.total),
    recycle: () => r.done / Math.max(1, r.total),
    update: () => (r.total ? r.done / r.total : 0),
    tasks: () => tasksFraction(r),
  }[r.kind]();
  return Math.max(0, Math.min(MAX_UNFINISHED, raw));
}

const percent = (r) => Math.floor(runFraction(r) * 100);

function eta(r) {
  if (r.finished) return t("concluído");
  if (r.cancelling) return t("cancelando…");
  const f = runFraction(r);
  const elapsed = (performance.now() - r.start) / 1000;
  if (f < ETA_MIN_FRACTION || elapsed < ETA_MIN_SECONDS) return t("calculando…");
  return remaining((elapsed * (1 - f)) / f);
}

function stage(r) {
  const counts = { done: r.done, total: r.total };
  if (r.kind === "scan") return t("Analisando · {done}/{total} categorias", counts);
  if (r.kind === "simulate") return t("Simulando, sem apagar · {done}/{total} categorias", counts);
  if (r.kind === "recycle") return t("Lixeira · {done}/{total} arquivos", counts);
  if (r.kind === "update") {
    if (r.total && r.done >= r.total) return t("Instalando…");
    return r.total ? t("Baixando · {done} de {total}", { done: fmt(r.done), total: fmt(r.total) }) : t("Baixando · {done}", { done: fmt(r.done) });
  }
  if (r.kind === "tasks") return t(taskById(r.curId)?.name || "Preparando…");
  const cat = S.cats.find((c) => c.id === r.cat);
  return cat ? `${catName(cat)} · ${fmt(r.freed || 0)}` : tb(r.phase) || t("Preparando…");
}

const detail = (r) => `${stage(r)} · ${eta(r)}`;

export function statusText() {
  const r = S.run;
  if (r) return `${t(KIND_LABEL[r.kind])} ${percent(r)}%`;
  if (!S.admin) return t("Sem admin · parcial");
  return S.scanAt ? t("Pronto · scan {n}s", { n: S.scanSecs }) : t("Pronto");
}

function idleButton(action, label, disabled) {
  return `<button class="rb ${label.length > LONG_LABEL ? "long" : ""}" data-hold="${action}" ${disabled ? "disabled" : ""}>
    <span class="fill"></span><span class="rb-label">${label}</span></button>`;
}

function runningButton(action, r) {
  const f = runFraction(r);
  const canCancel = !!r.cancel && !r.finished;
  const cls = [S.hoverRun === action && canCancel ? "hover" : "", S.confirmRun === action ? "confirm" : "", r.finished ? "done" : ""].join(" ");
  const cancelUi = canCancel ? `
    <div class="rb-cancel" data-runcancel="${action}">■ ${t("CANCELAR")}</div>
    <div class="rb-confirm"><span>${t("CANCELAR AGORA?")}</span><button class="yes" data-confirm="yes">${t("SIM")}</button><button data-confirm="no">${t("NÃO")}</button></div>` : "";
  return `
    <div class="rb running ${cls}" data-run="${action}">
      <div class="rb-fill" style="--p:${f}"></div>
      <div class="rb-body">
        <span class="rb-pct">${Math.floor(f * 100)}%</span>
        <span class="rb-mid"><span class="rb-ascii">${asciiBar(f, BAR_WIDTH)}</span><span class="rb-sub">${esc(detail(r))}</span></span>
      </div>
      ${cancelUi}
    </div>`;
}

export function runButton(action, label, disabled) {
  const r = runFor(action);
  return r ? runningButton(action, r) : idleButton(action, label, disabled);
}

export function runHint(action) {
  const r = runFor(action);
  if (r) return t(r.cancel ? "Passe o mouse para cancelar" : "Só leitura · aguarde");
  return t(busy() ? "Outra tarefa em andamento" : "Segure até a barra encher");
}

/** Atualiza o % sem recriar o botao (o hover continua estavel). */
export function patchRun() {
  const r = S.run;
  if (!r) return;
  const f = runFraction(r);
  document.querySelectorAll(".rb.running").forEach((el) => {
    el.querySelector(".rb-fill")?.style.setProperty("--p", f);
    el.querySelector(".rb-pct").textContent = `${Math.floor(f * 100)}%`;
    el.querySelector(".rb-ascii").innerHTML = asciiBar(f, BAR_WIDTH);
    el.querySelector(".rb-sub").textContent = detail(r);
  });
  const row = document.querySelector(".row.working .size");
  if (row && r.kind === "clean") row.textContent = t("limpando · {size}", { size: fmt(r.freed || 0) });
  document.querySelector("#statusText").textContent = statusText();
}

export function syncRunClasses() {
  document.querySelectorAll(".rb.running").forEach((el) => {
    const action = el.dataset.run;
    const canCancel = !!el.querySelector(".rb-cancel");
    el.classList.toggle("hover", canCancel && S.hoverRun === action);
    el.classList.toggle("confirm", S.confirmRun === action);
  });
}

// ---------------------------------------------------------------------------
// Segurar para iniciar
// ---------------------------------------------------------------------------

export const hold = { active: false, btn: null, start: 0, raf: 0 };

export function holdStart(btn, onComplete) {
  if (btn.disabled || hold.active) return;
  Object.assign(hold, { active: true, btn, start: performance.now() });
  const fill = btn.querySelector(".fill");
  const tick = (now) => {
    const p = Math.min(1, (now - hold.start) / HOLD_MS);
    fill.style.setProperty("--p", p);
    if (p < 1) {
      hold.raf = requestAnimationFrame(tick);
      return;
    }
    const action = btn.dataset.hold;
    holdEnd(true);
    onComplete(action);
  };
  hold.raf = requestAnimationFrame(tick);
}

export function holdEnd(completed) {
  if (!hold.active) return;
  cancelAnimationFrame(hold.raf);
  if (!completed) hold.btn.querySelector(".fill").style.setProperty("--p", 0);
  Object.assign(hold, { active: false, btn: null });
}
