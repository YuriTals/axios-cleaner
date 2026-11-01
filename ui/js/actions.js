// Acoes que conversam com o backend: varrer, limpar, manutencao, ferramentas.

import { TASKS, ZOOM_LEVELS, taskById } from "./catalog.js";
import { esc, fmt, groupApps, plural } from "./format.js";
import { setLang, t, tb } from "./i18n.js";
import { S, allIds, busy, filesOf, idsOf, saveConfig, selIn, selectedBytes } from "./state.js";
import { invoke } from "./tauri.js";
import { render, updateLive } from "./render.js";
import { bigNumber, blobCanvas } from "./widgets.js";
import { currentSchedule } from "./views/app.js";
import { updateSkipped } from "./views/update.js";

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
  invoke("set_tray_tooltip", { text: `Axios Cleaner · ${t("{size} de lixo", { size: fmt(selectedBytes()) })}` }).catch(() => {});
}

function idsForAction(action) {
  if (action === "all") return selIn(allIds());
  if (action === "recycle") return ["recycle"];
  return selIn(idsOf(action.slice("group:".length)));
}

/** Antes de limpar, pergunta se pode fechar os apps abertos que travam os arquivos. */
export async function clean(action) {
  const ids = idsForAction(action);
  if (!ids.length || busy()) return;
  if (S.settings.closeApps) {
    const running = await invoke("running_apps", { ids }).catch(() => []);
    if (running.length) {
      const apps = groupApps(running);
      S.askApps = { action, apps, picked: new Set(apps.map((a) => a.name)) };
      render();
      return;
    }
  }
  runClean(action, ids, !!S.settings.closeApps);
}

/** Resposta da pergunta: "go" limpa fechando so os apps marcados, "cancel" desiste. */
export function answerApps(answer) {
  const ask = S.askApps;
  S.askApps = null;
  if (!ask || answer !== "go" || busy()) return render();
  const closeOnly = ask.apps.filter((a) => ask.picked.has(a.name)).flatMap((a) => a.exes);
  runClean(ask.action, idsForAction(ask.action), closeOnly.length > 0, closeOnly);
}

async function runClean(action, ids, closeApps, closeOnly = null) {
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
    result = await invoke("clean", { opts: { ids, closeApps, closeOnly, restorePoint: !!S.settings.restorePoint } });
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

/** Mostra o que a limpeza apagaria, sem apagar nada (o log lista os arquivos). */
export async function simulate(action) {
  const ids = idsForAction(action);
  if (!ids.length || busy()) return;
  S.run = { kind: "simulate", action: "*simulate", cancel: "clean", start: performance.now(), total: ids.length, done: 0 };
  render();
  let result = null;
  try {
    result = await invoke("simulate", { ids });
  } catch (e) {
    console.error(e);
  }
  await finishRun();
  render();
  if (result) showSimulation(result);
}

export function cancelRun() {
  if (!S.run?.cancel) return;
  S.run.cancelling = true;
  invoke("cancel", { job: S.run.cancel });
}

const QUIT_WAIT_MS = 20000;
const QUIT_POLL_MS = 200;

/** Sai do app. Uma tarefa cancelavel e cancelada antes, para religar servicos e reabrir apps. */
export async function quitApp() {
  S.quit = "closing";
  render();
  if (S.run?.cancel) {
    cancelRun();
    const until = performance.now() + QUIT_WAIT_MS;
    while (S.run && performance.now() < until) await new Promise((r) => setTimeout(r, QUIT_POLL_MS));
  }
  invoke("quit_app");
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

/** Manda os arquivos marcados de uma ferramenta (Grandes ou Duplicados) para a Lixeira. */
async function recycleFiles(tool, action, dropSent) {
  const paths = [...tool.picked];
  if (!paths.length || busy()) return;
  S.run = { kind: "recycle", action, cancel: "recycle", start: performance.now(), total: paths.length, done: 0 };
  render();
  try {
    tool.result = await invoke("recycle_files", { paths });
    const sent = new Set(paths.slice(0, S.run.done));
    dropSent(sent);
    tool.picked = new Set(paths.filter((p) => !sent.has(p)));
  } catch (e) { console.error(e); }
  await finishRun();
  render();
}

const recycleBigFiles = () => recycleFiles(S.big, "recycle-big", (sent) => {
  S.big.items = S.big.items.filter((f) => !sent.has(f.path));
});

const recycleDupFiles = () => recycleFiles(S.dups, "recycle-dups", (sent) => {
  S.dups.groups = S.dups.groups
    .map((g) => ({ ...g, files: g.files.filter((f) => !sent.has(f.path)) }))
    .filter((g) => g.files.length > 1);
});

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------

export async function loadDups() {
  const D = S.dups;
  if (D.loading || busy()) return;
  D.root ||= S.map.home;
  Object.assign(D, { loading: true, groups: null, progress: null, result: null, error: "" });
  D.picked.clear();
  render();
  try {
    D.groups = await invoke("duplicates", { root: D.root, minMb: D.min });
  } catch (e) {
    D.error = String(e);
  }
  D.loading = false;
  render();
}

/** Escolhe outra pasta para procurar (ou volta para a pasta do usuario). */
export async function setDupRoot(which) {
  const root = which === "home" ? S.map.home : await invoke("pick_path", { folder: true }).catch(() => null);
  if (!root) return;
  Object.assign(S.dups, { root, groups: null, error: "", result: null });
  S.dups.picked.clear();
  render();
}

/** Marca todas as copias menos a mais antiga de cada grupo. */
export function markDupCopies() {
  S.dups.picked = new Set((S.dups.groups || []).flatMap((g) => g.files.slice(1).map((f) => f.path)));
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
      S.schedule.msg = t("Agendamento removido.");
    } else {
      await invoke("schedule_set", { freq: sc.freq, day: String(sc.day), time: sc.time });
      S.schedule.msg = "";
    }
  } catch (e) {
    S.schedule.msg = t("Não deu para salvar: {error}", { error: tb(String(e)) });
  }
  S.schedule.active = await invoke("schedule_status");
  saveConfig();
  render();
}

// ---------------------------------------------------------------------------
// Atualizacoes
// ---------------------------------------------------------------------------

/**
 * Consulta o GitHub e pergunta se quer atualizar. Na verificacao automatica nao
 * pergunta de novo se escolheu "depois" nesta sessao ou pulou esta versao.
 */
export async function checkForUpdates({ manual = false } = {}) {
  if (S.update.checking) return;
  Object.assign(S.update, { checking: true, error: "" });
  render();
  try {
    S.update.info = await invoke("check_update");
    if (S.update.info && (manual || (!S.update.later && !updateSkipped()))) S.update.open = true;
  } catch (e) {
    S.update.error = String(e).slice(0, 80);
  }
  Object.assign(S.update, { checking: false, checkedAt: new Date() });
  render();
}

/** "Depois" pergunta de novo na proxima abertura; "pular" ignora esta versao de vez. */
export function dismissUpdate(skip) {
  S.update.open = false;
  if (!skip) {
    S.update.later = true;
    return;
  }
  S.config.updateSkip = S.update.info?.version;
  delete S.config.updateSeen; // usado ate a 1.2.2
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

// ---------------------------------------------------------------------------
// Exclusoes e pastas extras (Ajustes)
// ---------------------------------------------------------------------------

const samePath = (a, b) => a.replace(/\\+$/, "").toLowerCase() === b.replace(/\\+$/, "").toLowerCase();

/** Salva a lista e analisa de novo, porque os totais mudam. */
async function savePaths(key, list, msg) {
  S.config[key] = list;
  S.pathsMsg = { key, text: msg };
  render();
  await saveConfig();
  scan();
}

/** "exclude": nunca apagar (pasta ou arquivo). "custom": pasta extra para limpar. */
export async function addPath(key, folder = true) {
  const picked = await invoke("pick_path", { folder }).catch(() => null);
  if (!picked) return;
  const list = S.config[key] || [];
  if (list.some((p) => samePath(p, picked))) {
    S.pathsMsg = { key, text: t("Esse caminho já está na lista.") };
    return render();
  }
  if (key === "custom") {
    try {
      const ok = await invoke("check_custom_folder", { path: picked });
      return savePaths(key, [...list, ok], t("Adicionada: {path}", { path: ok }));
    } catch (e) {
      S.pathsMsg = { key, text: tb(String(e)), error: true };
      return render();
    }
  }
  savePaths(key, [...list, picked], t("Excluído: {path}", { path: picked }));
}

export function removePath(key, path) {
  savePaths(key, (S.config[key] || []).filter((p) => !samePath(p, path)), t("Removido: {path}", { path }));
}

// ---------------------------------------------------------------------------
// Idioma e tamanho da interface
// ---------------------------------------------------------------------------

/** Troca o idioma; o backend usa a configuracao salva para a bandeja e os logs. */
export async function setLanguage(lang) {
  S.settings.lang = lang;
  setLang(lang);
  translateStatic();
  render();
  await saveConfig();
  invoke("language_changed").catch(() => {});
}

/** Textos fixos do index.html (barra de titulo e botoes da janela). */
export function translateStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.dataset.i18nPt ??= el.textContent;
    el.textContent = t(el.dataset.i18nPt);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", el.title);
  });
}

/** Aplica o zoom; o backend devolve o maior nivel que cabe no monitor. */
export async function setZoom(zoom) {
  const applied = await invoke("set_zoom", { zoom });
  S.settings.zoom = applied;
  S.zoomMsg = applied < zoom ? t("Seu monitor comporta no máximo {n}%.", { n: Math.round(applied * 100) }) : "";
  saveConfig();
  render();
}

/** Ctrl + / Ctrl -: proximo ou anterior; Ctrl 0: volta a 100%. */
export function stepZoom(dir) {
  const levels = ZOOM_LEVELS.map(([z]) => z);
  const i = levels.findIndex((z) => z >= (S.settings.zoom || 1) - 0.001);
  const next = dir === 0 ? 1 : levels[Math.max(0, Math.min(levels.length - 1, i + dir))];
  if (next !== S.settings.zoom) setZoom(next);
}

/** Disparado quando o usuario termina de segurar um botao de execucao. */
export function startAction(action) {
  if (action === "update") installUpdate();
  else if (action === "tasks") runMaintenance();
  else if (action === "recycle-big") recycleBigFiles();
  else if (action === "recycle-dups") recycleDupFiles();
  else clean(action);
}

// ---------------------------------------------------------------------------
// Tela de resultado
// ---------------------------------------------------------------------------

const REPORT_RULE = 18;

export function showResult(res) {
  const skipped = res.skipped ? ` · ${plural(res.skipped, "em uso pulado", "em uso pulados")}` : "";
  showReport({
    frame: t("RELATÓRIO"), title: t(res.cancelled ? "Limpeza cancelada" : "Limpeza concluída"), bytes: res.freed, unit: t("liberados"),
    detail: plural(res.files, "arquivo apagado", "arquivos apagados") + skipped, log: res.log, logLabel: t("Ver log"),
  });
}

function showSimulation(res) {
  showReport({
    frame: t("SIMULAÇÃO"), title: t(res.cancelled ? "Simulação cancelada" : "Simulação concluída · nada foi apagado"), bytes: res.bytes,
    unit: t("seriam liberados"), detail: `${plural(res.files, "arquivo", "arquivos")} · ${t("arquivos em uso podem ser pulados na limpeza de verdade")}`,
    log: res.log, logLabel: t("Ver a lista de arquivos"),
  });
}

function showReport({ frame: name, title, bytes, unit, detail, log, logLabel }) {
  const frame = "+" + "-".repeat(REPORT_RULE) + ` ${name} ` + "-".repeat(REPORT_RULE) + "+";
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    ${blobCanvas(7, "full")}
    <div class="ov-c">
      <div class="ov-frame">${frame}</div>
      <div class="mono ruby">${title}</div>
      ${bigNumber(bytes, "xl")}
      <div class="ov-u mono">${unit}</div>
      <div class="ov-d">${detail}</div>
      ${log ? `<button class="linkbtn mono" data-openfile="${esc(log)}">&gt; ${logLabel}</button>` : ""}
      <div class="ov-frame">+${"-".repeat(frame.length - 2)}+</div>
    </div>
    <div class="ov-foot mono">${t("Clique · para fechar")}</div>`;
  const close = (e) => {
    if (e?.target?.closest?.("[data-openfile]")) return;
    overlay.remove();
    document.removeEventListener("keydown", close);
  };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", close);
  document.body.appendChild(overlay);
}
