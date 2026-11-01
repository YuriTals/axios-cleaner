// Ponto de entrada: liga eventos da interface e do backend e inicia o app.

import { CHANNELS, RESCAN_SETTINGS, UPDATE_FIRST_CHECK_MS, UPDATE_INTERVAL_MS, VERSION, taskById } from "./catalog.js";
import { S, applyConfig, areas, idsOf, saveConfig, toggle } from "./state.js";
import { currentWindow, invoke, listen } from "./tauri.js";
import { hold, holdEnd, holdStart, patchRun, syncRunClasses } from "./run.js";
import { modalOpen, render, tickSpinners, trapModalFocus, updateLive } from "./render.js";
import { coreAreaAt, mapHooks, startAnimation } from "./canvas.js";
import * as actions from "./actions.js";
import { currentSchedule } from "./views/app.js";

const STATS_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 150;
const HISTORY_SAMPLES = 90;
const RESIZE_DEBOUNCE_MS = 120;

// ---------------------------------------------------------------------------
// Cliques: um handler por atributo data-*. Devolver false evita re-render.
// ---------------------------------------------------------------------------

const ignoreErrors = (promise) => promise.catch(() => {});

const CLICK = {
  runcancel: (action) => { S.confirmRun = action; syncRunClasses(); return false; },
  confirm: (answer) => {
    if (answer === "yes") actions.cancelRun();
    S.confirmRun = null;
    syncRunClasses();
    patchRun();
    return false;
  },
  rescan: () => { actions.scan(); return false; },
  go: (route) => { actions.go(route); return false; },
  toggle: (id) => { toggle(S.selected, id); saveConfig(); },
  all: (group) => {
    const ids = idsOf(group);
    const allOn = ids.every((id) => S.selected.has(id));
    ids.forEach((id) => (allOn ? S.selected.delete(id) : S.selected.add(id)));
    saveConfig();
  },
  details: (id) => {
    S.openDetails = S.openDetails === id ? null : id;
    if (S.openDetails && !S.details[id]) {
      S.details[id] = "loading";
      invoke("details", { id }).then((d) => { S.details[id] = d; render(); }).catch(() => { delete S.details[id]; });
    }
  },
  open: (path) => { ignoreErrors(invoke("open_folder", { path })); return false; },
  reveal: (path) => { ignoreErrors(invoke("reveal_path", { path })); return false; },
  openfile: (path) => { ignoreErrors(invoke("open_log", { path })); return false; },
  logs: () => { ignoreErrors(invoke("open_logs_folder")); return false; },
  cancel: (job) => { invoke("cancel", { job }); return false; },
  disk: (view) => { S.diskView = view; },
  setting: (key) => {
    S.settings[key] = !S.settings[key];
    const saved = saveConfig();
    if (RESCAN_SETTINGS.includes(key)) saved.then(() => actions.scan());
  },
  clearhistory: () => { invoke("clear_history"); S.history = []; },
  pick: (path) => { toggle(S.big.picked, path); S.big.result = null; },
  bigmin: (mb) => { S.big.min = +mb; actions.loadBigFiles(); return false; },
  maproot: (path) => { actions.loadMap(path, true); return false; },
  mapgo: (path) => { actions.loadMap(path); return false; },
  startup: (id, el) => { toggleStartup(id, el); return false; },
  task: (id) => { toggle(S.tasks.picked, id); },
  schfreq: (freq) => {
    const days = { weekly: "SUN", monthly: "1" };
    S.config.schedule = { ...currentSchedule(), freq, day: days[freq] ?? currentSchedule().day };
    S.schedule.msg = "Clique em Salvar para aplicar.";
  },
  schsave: () => { actions.saveSchedule(); return false; },
  zoom: (z) => { actions.setZoom(+z); return false; },
  openupdate: () => { S.update.open = true; },
  closeupdate: (mode) => { actions.dismissUpdate(mode === "skip"); },
  apps: (answer) => { actions.answerApps(answer); return false; },
  apppick: (name) => { toggle(S.askApps.picked, name); },
  checkupdate: () => { actions.checkForUpdates({ manual: true }); return false; },
  quit: (answer) => {
    if (answer === "yes") { actions.quitApp(); return false; }
    S.quit = null;
  },
};
const CLICK_SELECTOR = Object.keys(CLICK).map((k) => `[data-${k}]`).join(",");

async function toggleStartup(id, el) {
  const item = S.startup.find((i) => i.id === id);
  try {
    await invoke("startup_set", { id, enabled: !item.enabled });
    item.enabled = !item.enabled;
    render();
  } catch (err) {
    const desc = el.closest(".row")?.querySelector(".desc");
    if (desc) {
      desc.textContent = "Não deu para mudar: " + err;
      desc.style.color = "var(--ruby-hi)";
    }
  }
}

function onClick(e) {
  if (e.target.closest("#core") && S.coreHover >= 0) return actions.go(areas()[S.coreHover].route);
  const el = e.target.closest(CLICK_SELECTOR);
  if (!el) return;
  const key = Object.keys(CLICK).find((k) => k in el.dataset);
  if (CLICK[key](el.dataset[key], el) !== false) render();
}

// ---------------------------------------------------------------------------
// Mouse e teclado
// ---------------------------------------------------------------------------

/** Mostra "cancelar" no botao em andamento que esta sob o mouse. */
function trackRunHover(e) {
  if (S.demoHover) return;
  const action = e.target.closest?.(".rb.running")?.dataset.run || null;
  if (action === S.hoverRun) return;
  S.hoverRun = action;
  if (!action) S.confirmRun = null;
  syncRunClasses();
}

/** Destaca a area do nucleo e da lista sob o mouse (tela inicial). */
function trackCoreHover(e) {
  if (S.route !== "home") return;
  const overCore = e.target.closest?.("#core");
  const overRow = e.target.closest?.("[data-area]");
  const k = overCore ? coreAreaAt(e) : overRow ? +overRow.dataset.area : -1;
  if (k === S.coreHover) return;
  S.coreHover = k;
  document.querySelectorAll(".grow").forEach((el) => el.classList.toggle("hot", +el.dataset.area === k));
  const core = document.querySelector("#core");
  if (core) core.style.cursor = overCore && k >= 0 ? "pointer" : "";
}

/** Esc escolhe sempre a opcao segura da janela aberta. */
function closeModalWithEsc() {
  if (S.quit === "ask") S.quit = null;
  else if (S.askApps) return actions.answerApps("cancel");
  else if (S.update.open && S.run?.kind !== "update") actions.dismissUpdate(false);
  else return;
  render();
}

function wireInput() {
  document.addEventListener("click", onClick);
  document.addEventListener("pointerover", trackRunHover);
  document.addEventListener("mousemove", trackCoreHover);
  document.documentElement.addEventListener("mouseleave", () => {
    if (S.demoHover) return;
    S.hoverRun = null;
    S.confirmRun = null;
    syncRunClasses();
  });

  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-hold]");
    if (!btn || e.button !== 0) return;
    btn.setPointerCapture(e.pointerId);
    holdStart(btn, actions.startAction);
  });
  document.addEventListener("pointerup", () => holdEnd(false));
  document.addEventListener("pointercancel", () => holdEnd(false));
  document.addEventListener("keydown", (e) => {
    const isPress = e.key === " " || e.key === "Enter";
    const btn = document.activeElement?.closest?.("[data-hold]");
    if (btn && isPress) {
      e.preventDefault();
      if (!e.repeat) holdStart(btn, actions.startAction);
    }
    if (modalOpen()) trapModalFocus(e);
    if (e.key === "Escape") closeModalWithEsc();
    if (e.ctrlKey && !e.altKey) {
      const dir = { "+": 1, "=": 1, "-": -1, "0": 0 }[e.key];
      if (dir !== undefined) { e.preventDefault(); actions.stepZoom(dir); }
    }
    // Sem recarregar a janela, para parecer app nativo.
    if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) e.preventDefault();
  });
  document.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") holdEnd(false); });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (S.route === "home" && !hold.active) render(); }, RESIZE_DEBOUNCE_MS);
  });
}

function wireWindowButtons() {
  const win = currentWindow();
  document.querySelector("#wMin").onclick = () => win.minimize();
  document.querySelector("#wMax").onclick = () => win.toggleMaximize();
  // O backend trata o CloseRequested: esconde na bandeja ou emite "quit-requested".
  document.querySelector("#wClose").onclick = () => win.close();
}

// ---------------------------------------------------------------------------
// Eventos do backend
// ---------------------------------------------------------------------------

async function wireBackendEvents() {
  const onClean = (fn) => (p) => { if (S.run?.kind === "clean") fn(S.run, p); };
  await listen("scan-progress", (p) => {
    S.scan[p.id] = p;
    if (S.run?.kind === "scan") S.run.done++;
    render();
  });
  await listen("clean-phase", (p) => { if (S.run) S.run.phase = p; patchRun(); });
  await listen("clean-start", (id) => {
    S.working = id;
    if (S.run) Object.assign(S.run, { cat: id, cur: 0, freed: 0 });
    render();
  });
  await listen("clean-tick", onClean((r, p) => {
    r.cur = Math.min(p.files, r.weights[p.id] || 0);
    r.freed = p.freed;
    patchRun();
  }));
  await listen("clean-progress", (p) => {
    S.cleaned[p.id] = p;
    S.working = null;
    if (S.run?.kind === "clean") { S.run.done += S.run.weights[p.id] || 0; S.run.cur = 0; }
    render();
  });
  await listen("task-start", (id) => {
    S.tasks.status[id] = "running";
    if (S.run) Object.assign(S.run, { curId: id, curStart: performance.now() });
    render();
  });
  await listen("task-done", (res) => {
    S.tasks.status[res.id] = res;
    if (S.run?.kind === "tasks") Object.assign(S.run, { doneW: S.run.doneW + taskById(res.id).est, curId: null, curStart: 0 });
    render();
  });
  await listen("recycle-progress", (p) => { if (S.run?.kind === "recycle") S.run.done = p.done; patchRun(); });
  await listen("map-progress", (p) => { S.map.progress = p; if (S.route === "map") render(); });
  await listen("tray-scan", () => { S.route = "home"; actions.scan(); });
  // X, Alt+F4 ou "Sair" na bandeja. Responder logo avisa o backend que a interface nao travou.
  await listen("quit-requested", () => {
    invoke("quit_ack");
    if (S.quit) return;
    if (!S.settings.confirmClose) return actions.quitApp();
    S.quit = "ask";
    render();
  });
  await listen("update-progress", (p) => {
    if (S.run?.kind !== "update") return;
    Object.assign(S.run, { done: p.downloaded, total: p.total || 0 });
    patchRun();
  });
}

// ---------------------------------------------------------------------------
// Telemetria, relogio e boot
// ---------------------------------------------------------------------------

async function pollStats() {
  if (document.hidden) return;
  try {
    const st = (S.stats = await invoke("system_stats"));
    const push = (arr, v) => { arr.push(v); if (arr.length > HISTORY_SAMPLES) arr.shift(); };
    push(S.hist.cpu, st.cpu);
    push(S.hist.gpu, st.gpu);
    push(S.hist.mem, (st.mem_used / st.mem_total) * 100);
    push(S.hist.disk, st.disk_activity);
    updateLive();
  } catch {
    // sensores indisponiveis: tenta de novo no proximo ciclo
  }
}

function startClock() {
  const clock = document.querySelector("#clock");
  const tick = () => { clock.textContent = new Date().toLocaleTimeString("pt-BR"); };
  tick();
  setInterval(tick, 1000);
}

const BOOT_LINE_MS = 150;
const BOOT_HOLD_MS = 380;
const BOOT_FADE_MS = 450;

/** Sequencia de "boot" em ASCII (~1 s). Clique para pular. */
async function boot() {
  const el = document.querySelector("#boot");
  if (!el) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const leader = (label, width = 30) => `${label} ${".".repeat(Math.max(3, width - label.length))}`;
  const lines = [
    `> ${leader("regras de limpeza")} <span class="ok">${S.cats.length} categorias</span>`,
    `> ${leader("sensores cpu/gpu/mem/disco")} <span class="ok">ok</span>`,
    `> ${leader("permissão")} <span class="ok">${S.admin ? "administrador" : "usuário"}</span>`,
    `> ${leader("varredura")} <span class="cur">${S.settings.autoScan ? "iniciando" : "manual"}</span>`,
  ];
  el.onclick = () => el.classList.add("gone");
  el.innerHTML = `<div class="l1">AXIOS<b>//</b>CLEANER · v${VERSION}</div>`;
  for (const line of lines) {
    await wait(BOOT_LINE_MS);
    el.insertAdjacentHTML("beforeend", `<div>${line}</div>`);
  }
  await wait(BOOT_HOLD_MS);
  el.classList.add("gone");
  setTimeout(() => el.remove(), BOOT_FADE_MS);
}

const DEMO_RUN_ROUTES = ["demo-run", "demo-hover", "demo-confirm"];
const DEMO_UPDATE = { version: "1.3.0", current: VERSION, date: "2026-11-01", notes: "## Novidades\n- Exemplo de item novo\n- Outro item" };

/** AXIOS_ROUTE=demo-*: estados simulados para capturas de tela (desenvolvimento). */
async function applyDevRoute(route) {
  if (route === "demo-update") Object.assign(S.update, { info: DEMO_UPDATE, open: true });
  if (route === "demo-result") actions.showResult({ freed: 4.37 * 1024 ** 3, files: 31240, skipped: 112 });
  if (!DEMO_RUN_ROUTES.includes(route)) return;
  await actions.scan(); // o nucleo mostra dados reais por tras do botao simulado
  S.run = { kind: "clean", action: "all", cancel: "clean", start: performance.now() - 8000, weights: {}, total: 100, done: 41, cur: 6, freed: 1.3 * 1024 ** 3, cat: "usertemp" };
  if (route === "demo-hover") Object.assign(S, { hoverRun: "all", demoHover: true });
  if (route === "demo-confirm") S.confirmRun = "all";
  render();
}

/** Verifica ao abrir (com um pequeno atraso) e a cada 12 h, se estiver ligado. */
function scheduleUpdateChecks(route) {
  if (route?.startsWith("demo-")) return;
  const check = () => { if (S.settings.updateCheck && S.run?.kind !== "update") actions.checkForUpdates(); };
  setTimeout(check, UPDATE_FIRST_CHECK_MS);
  setInterval(check, UPDATE_INTERVAL_MS);
}

async function init() {
  document.querySelector("#ver").textContent = `v${VERSION}`;
  wireWindowButtons();
  wireInput();
  startClock();
  mapHooks.open = (path) => actions.loadMap(path);

  S.cats = await invoke("categories");
  S.admin = await invoke("is_admin");
  applyConfig(await invoke("get_config"));
  boot();
  S.history = await invoke("get_history");
  S.map.home = await invoke("home_dir");
  S.schedule.active = await invoke("schedule_status");
  await wireBackendEvents();

  const route = await invoke("start_route");
  if (CHANNELS.some((c) => c.id === route)) actions.go(route);

  render();
  startAnimation();
  pollStats();
  setInterval(pollStats, STATS_INTERVAL_MS);
  setInterval(() => { patchRun(); tickSpinners(true); }, TICK_INTERVAL_MS);
  if (route?.startsWith("demo-")) applyDevRoute(route);
  else if (S.settings.autoScan) actions.scan();
  scheduleUpdateChecks(route);
}

init();
