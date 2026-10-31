// Monta a tela atual e mantem as partes "ao vivo" atualizadas.

import { CHANNELS, VERSION, channel } from "./catalog.js";
import { fmt } from "./format.js";
import { hold, statusText } from "./run.js";
import { S, idsOf, selectedBytes, bytesOf } from "./state.js";
import { drawMap } from "./canvas.js";
import { viewHome, telemetryHtml, disksHtml } from "./views/home.js";
import { viewGroup, viewRecycle } from "./views/cleaning.js";
import { viewBig, viewMap, viewStartup, viewTasks } from "./views/tools.js";
import { viewHistory, viewSettings } from "./views/app.js";
import { updateBadge, updateModalHtml } from "./views/update.js";

const VIEWS = {
  home: viewHome,
  recycle: viewRecycle,
  big: viewBig,
  map: viewMap,
  startup: viewStartup,
  tasks: viewTasks,
  history: viewHistory,
  settings: viewSettings,
};

const SCRAMBLE_CHARS = "=-:.#/+*<>[]";
const SCRAMBLE_STEPS = 12;
const SCRAMBLE_MS = 26;

/** Efeito de "decodificacao" dos titulos ao trocar de tela. */
function scramble(el) {
  const final = el.textContent;
  let step = 0;
  const timer = setInterval(() => {
    step++;
    el.textContent = [...final]
      .map((c, i) => (c === " " || i < (final.length * step) / SCRAMBLE_STEPS ? c : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0]))
      .join("");
    if (step >= SCRAMBLE_STEPS) {
      clearInterval(timer);
      el.textContent = final;
    }
  }, SCRAMBLE_MS);
}

function junkOf(c) {
  if (c.group) return selectedBytes(idsOf(c.group));
  return c.id === "recycle" ? bytesOf("recycle") : 0;
}

function renderChannels() {
  document.querySelector("#channels").innerHTML = CHANNELS.map((c) => `
    ${c.sep ? `<div class="navsep"></div>` : ""}
    <button class="ch" data-go="${c.id}" title="${c.t}" ${S.route === c.id ? 'aria-current="page"' : ""}>
      <span class="code">${c.code}</span><span class="t">${c.t}</span><span class="dot ${junkOf(c) ? "has" : ""}"></span>
    </button>`).join("") + `<div class="nav-foot">v${VERSION}\n${S.admin ? "ADMIN" : "USER"}</div>`;
}

function renderUpdate() {
  const pill = document.querySelector("#updPill");
  const badge = updateBadge();
  pill.hidden = !badge;
  pill.textContent = badge;
  document.querySelector("#modal").innerHTML = updateModalHtml();
}

function renderStatus() {
  document.querySelector("#statusLed").className = "ok-led" + (S.run ? " busy" : S.admin ? "" : " warn");
  document.querySelector("#statusText").textContent = statusText();
}

/** Recria a tela atual a partir do estado. */
export function render() {
  if (hold.active) return; // nao interrompe o gesto de segurar
  renderChannels();
  const screen = document.querySelector("#screen");
  const ch = channel(S.route);
  const scrolls = [...screen.querySelectorAll(".scroll")].map((s) => s.scrollTop);
  screen.className = "screen " + (S.route === "home" ? "home" : "full");
  screen.innerHTML = ch.group ? viewGroup(ch) : VIEWS[S.route]();
  screen.querySelectorAll(".scroll").forEach((s, i) => (s.scrollTop = scrolls[i] || 0));
  if (S.route === "map") drawMap();
  if (S.lastRoute !== S.route) {
    S.lastRoute = S.route;
    screen.querySelectorAll(".ph-t, .hhead > .mono:first-child").forEach(scramble);
  }
  tickSpinners();
  renderUpdate();
  renderStatus();
}

/** Atualiza telemetria, unidades e a leitura da barra de titulo sem recriar a tela. */
export function updateLive() {
  const tel = document.querySelector("#tel");
  if (tel) tel.innerHTML = telemetryHtml();
  const disks = document.querySelector("#disks");
  if (disks && !hold.active) disks.outerHTML = disksHtml(selectedBytes());
  const st = S.stats;
  if (!st) return;
  const pct = (v) => (v == null ? "--" : Math.round(v) + "%");
  const junk = S.scanAt ? ` · lixo <em>${fmt(selectedBytes())}</em>` : "";
  document.querySelector("#readout").innerHTML =
    `sys :: cpu <b>${pct(st.cpu)}</b> · gpu <b>${pct(st.gpu)}</b> · mem <b>${pct((st.mem_used / st.mem_total) * 100)}</b>${junk}`;
}

const SPINNER = ["[=     ]", "[==    ]", "[ ==   ]", "[  ==  ]", "[   == ]", "[    ==]", "[     =]", "[    ==]", "[   == ]", "[  ==  ]", "[ ==   ]", "[==    ]"];
let spinnerFrame = 0;

export function tickSpinners(advance = false) {
  if (advance) spinnerFrame++;
  document.querySelectorAll(".spinner").forEach((el) => (el.textContent = SPINNER[spinnerFrame % SPINNER.length]));
}
