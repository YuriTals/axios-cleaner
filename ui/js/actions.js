// Acoes que conversam com o backend: varrer, limpar, manutencao, ferramentas.

import { TASKS, taskById } from "./catalog.js";
import { esc, fmt, plural } from "./format.js";
import { S, allIds, busy, filesOf, idsOf, saveConfig, selIn, selectedBytes } from "./state.js";
import { invoke } from "./tauri.js";
import { render, updateLive } from "./render.js";
import { bigNumber, blobCanvas } from "./widgets.js";
import { currentSchedule } from "./views/app.js";

const DONE_FLASH_MS = 700;

/** Mostra 100% por um instante e libera o botao. */
async function finishRun() {
  if (!S.run) return;
  S.run.finished = true;
  S.confirmRun = null;
  render();
  await new Promise((r) => setTimeout(r, DONE_FLASH_MS));
  S.run = null;
}

export function go(route) {
  S.route = route;
  S.coreHover = -1;
  if (route === "startup" && !S.startup) invoke("startup_list").then((list) => { S.startup = list; render(); });
  if (route === "big" && !S.big.items && !S.big.loading) loadBigFiles();
  if (route === "map" && !S.map.data && !S.map.loading && S.map.home) loadMap(S.map.home, true);
  render();
}

// ---------------------------------------------------------------------------
// Varredura e limpeza
// ---------------------------------------------------------------------------

export async function scan() {
  if (busy()) return;
  S.run = { kind: "scan", action: "*scan", start: performance.now(), total: S.cats.length, done: 0 };
  S.scan = {};
  S.details = {};
  render();
  const t0 = performance.now();
  try {
    (await invoke("scan")).forEach((item) => (S.scan[item.id] = item));
  } catch (e) {
    console.error(e);
  }
  S.scanSecs = Math.max(1, Math.round((performance.now() - t0) / 1000));
  S.scanAt = new Date();
  S.run = null;
  render();
  updateLive();
  invoke("set_tray_tooltip", { text: `Axios Cleaner · ${fmt(selectedBytes())} de lixo` }).catch(() => {});
}

function idsForAction(action) {
  if (action === "all") return selIn(allIds());
  if (action === "recycle") return ["recycle"];
  return selIn(idsOf(action.slice("group:".length)));
}

export async function clean(action) {
  const ids = idsForAction(action);
  if (!ids.length || busy()) return;
  // O % e calculado pelos arquivos que a varredura encontrou em cada categoria.
  const weights = Object.fromEntries(ids.map((id) => [id, filesOf(id) + 1]));
  S.run = {
    kind: "clean", action, cancel: "clean", start: performance.now(),
    weights, total: Object.values(weights).reduce((a, b) => a + b, 0), done: 0, cur: 0, freed: 0, phase: "Preparando…",
  };
  S.cleaned = {};
  S.summary = null;
  render();
  let result = null;
  try {
    result = await invoke("clean", { opts: { ids, closeApps: !!S.settings.closeApps, restorePoint: !!S.settings.restorePoint } });
    S.summary = { ...result, scope: action };
  } catch (e) {
    console.error(e);
  }
  S.working = null;
  await finishRun();
  if (result) showResult(result);
  S.history = await invoke("get_history");
  await scan();
}

export function cancelRun() {
  if (!S.run?.cancel) return;
  S.run.cancelling = true;
  invoke("cancel", { job: S.run.cancel });
}

// ---------------------------------------------------------------------------
// Manutencao e ferramentas
// ---------------------------------------------------------------------------

async function runMaintenance() {
  const ids = TASKS.map((t) => t.id).filter((id) => S.tasks.picked.has(id));
  S.tasks.status = {};
  S.run = {
    kind: "tasks", action: "tasks", cancel: "tasks", start: performance.now(),
    totalW: ids.reduce((a, id) => a + taskById(id).est, 0), doneW: 0, curId: null, curStart: 0,
  };
  render();
  try { await invoke("maintenance", { ids }); } catch (e) { console.error(e); }
  await finishRun();
  render();
}

export async function loadBigFiles() {
  Object.assign(S.big, { loading: true, items: null, result: null });
  S.big.picked.clear();
  render();
  try { S.big.items = await invoke("large_files", { minMb: S.big.min }); } catch (e) { console.error(e); S.big.items = []; }
  S.big.loading = false;
  render();
}

async function recycleBigFiles() {
  const paths = [...S.big.picked];
  if (!paths.length || busy()) return;
  S.run = { kind: "recycle", action: "recycle-big", cancel: "recycle", start: performance.now(), total: paths.length, done: 0 };
  render();
  try {
    S.big.result = await invoke("recycle_files", { paths });
    const sent = new Set(paths.slice(0, S.run.done));
    S.big.items = S.big.items.filter((f) => !sent.has(f.path));
    S.big.picked = new Set(paths.filter((p) => !sent.has(p)));
  } catch (e) { console.error(e); }
  await finishRun();
  render();
}

export async function loadMap(path, isRoot = false) {
  Object.assign(S.map, { loading: true, progress: null, hover: -1 });
  if (isRoot || S.map.root == null) S.map.root = path;
  render();
  try { S.map.data = await invoke("map_folder", { path }); } catch (e) { console.error(e); }
  S.map.loading = false;
  render();
}

export async function saveSchedule() {
  const sc = currentSchedule();
  sc.day = document.querySelector("#schDay")?.value ?? sc.day;
  sc.time = document.querySelector("#schTime")?.value || sc.time;
  S.config.schedule = sc;
  try {
    if (sc.freq === "off") {
      await invoke("schedule_clear");
      S.schedule.msg = "Agendamento removido.";
    } else {
      await invoke("schedule_set", { freq: sc.freq, day: String(sc.day), time: sc.time });
      S.schedule.msg = "";
    }
  } catch (e) {
    S.schedule.msg = "Não deu para salvar: " + e;
  }
  S.schedule.active = await invoke("schedule_status");
  saveConfig();
  render();
}

// ---------------------------------------------------------------------------
// Atualizacoes
// ---------------------------------------------------------------------------

/** Consulta o GitHub. Na verificacao automatica, abre o aviso uma vez por versao. */
export async function checkForUpdates({ manual = false } = {}) {
  if (S.update.checking) return;
  Object.assign(S.update, { checking: true, error: "" });
  render();
  try {
    S.update.info = await invoke("check_update");
    const version = S.update.info?.version;
    if (version && (manual || S.config.updateSeen !== version)) S.update.open = true;
  } catch (e) {
    S.update.error = String(e).slice(0, 80);
  }
  Object.assign(S.update, { checking: false, checkedAt: new Date() });
  render();
}

export function dismissUpdate() {
  S.update.open = false;
  S.config.updateSeen = S.update.info?.version;
  saveConfig();
}

async function installUpdate() {
  if (busy()) return;
  S.run = { kind: "update", action: "update", start: performance.now(), total: 0, done: 0 };
  render();
  try {
    await invoke("install_update"); // o instalador fecha e reabre o app
  } catch (e) {
    S.update.error = String(e).slice(0, 80);
    S.run = null;
    render();
  }
}

/** Disparado quando o usuario termina de segurar um botao de execucao. */
export function startAction(action) {
  if (action === "update") installUpdate();
  else if (action === "tasks") runMaintenance();
  else if (action === "recycle-big") recycleBigFiles();
  else clean(action);
}

// ---------------------------------------------------------------------------
// Tela de resultado
// ---------------------------------------------------------------------------

const REPORT_RULE = 18;

export function showResult(res) {
  const frame = "+" + "-".repeat(REPORT_RULE) + " RELATÓRIO " + "-".repeat(REPORT_RULE) + "+";
  const skipped = res.skipped ? ` · ${plural(res.skipped, "em uso pulado", "em uso pulados")}` : "";
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    ${blobCanvas(7, "full")}
    <div class="ov-c">
      <div class="ov-frame">${frame}</div>
      <div class="mono ruby">${res.cancelled ? "Limpeza cancelada" : "Limpeza concluída"}</div>
      ${bigNumber(res.freed, "xl")}
      <div class="ov-u mono">liberados</div>
      <div class="ov-d">${plural(res.files, "arquivo apagado", "arquivos apagados")}${skipped}</div>
      ${res.log ? `<button class="linkbtn mono" data-openfile="${esc(res.log)}">&gt; Ver log</button>` : ""}
      <div class="ov-frame">+${"-".repeat(frame.length - 2)}+</div>
    </div>
    <div class="ov-foot mono">Clique · para fechar</div>`;
  const close = (e) => {
    if (e?.target?.closest?.("[data-openfile]")) return;
    overlay.remove();
    document.removeEventListener("keydown", close);
  };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", close);
  document.body.appendChild(overlay);
}
