// Telas do app: historico e ajustes.

import { CHANNELS, SCHEDULE_FREQS, VERSION, WEEKDAYS } from "../catalog.js";
import { esc, fmt, plural } from "../format.js";
import { S, catsOf } from "../state.js";
import { bigNumber, empty, panelHeader, switchRow } from "../widgets.js";
import { updateStatus } from "./update.js";

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------

function historyRow(h) {
  const d = new Date(h.at);
  const when = `${d.toLocaleDateString("pt-BR")} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const tags = (h.auto ? `<span class="tag soft">AGENDADA</span>` : "") + (h.cancelled ? `<span class="tag soft">CANCELADA</span>` : "");
  return `<div class="row static"><span class="row-main"><span class="main">
      <span class="name">${when}${tags}</span>
      <span class="desc">${plural(h.files || 0, "arquivo", "arquivos")} · ${esc(h.what || "")}</span></span>
      <span class="size">${fmt(h.freed || 0)}</span></span>
      ${h.log ? `<button class="row-more" data-openfile="${esc(h.log)}" title="Abrir log">log</button>` : ""}
    </div>`;
}

export function viewHistory() {
  const total = S.history.reduce((a, h) => a + (h.freed || 0), 0);
  const actions = `<button class="linkbtn mono" data-logs>Pasta de logs</button>` +
    (S.history.length ? `<button class="linkbtn mono" data-clearhistory>Apagar histórico</button>` : "");
  const rows = S.history.slice().reverse().map(historyRow).join("");
  return `
    <section class="panel">
      ${panelHeader("history", "Histórico", actions)}
      <div class="rec-hero">
        ${bigNumber(total, "white")}
        <div class="caption">Liberados no total</div>
      </div>
      <div class="list scroll">${rows || empty("Nenhuma limpeza ainda.")}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

const BEHAVIOR = [
  ["closeApps", "Fechar apps abertos antes de limpar", "Pede para navegadores, Discord, Teams e OneDrive fecharem (como clicar no X) e só força quem não fechar em 8 s. O OneDrive é reaberto no final. Desligado, arquivos em uso são pulados."],
  ["autoScan", "Analisar ao abrir", "Faz a varredura (só leitura) assim que o app abre."],
  ["restorePoint", "Criar ponto de restauração antes de limpar", "Mais seguro, mas deixa a limpeza ~1 min mais lenta. Precisa da Proteção do Sistema ativa."],
  ["closeToTray", "Fechar para a bandeja", "Fechar a janela deixa o app rodando no ícone perto do relógio. Para sair de vez, use o menu do ícone."],
];

const DEFAULT_SCHEDULE = { freq: "off", day: "SUN", time: "12:00" };
export const currentSchedule = () => S.config.schedule || { ...DEFAULT_SCHEDULE };

function adminRow() {
  const desc = S.admin
    ? "Ativa: limpa pastas do Windows e de todos os usuários."
    : "Inativa: só os arquivos do usuário atual que não exigem admin serão limpos.";
  return `<div class="row static"><span class="row-main">
      <span class="main"><span class="name">Permissão de administrador</span><span class="desc">${desc}</span></span>
      <span class="tag ${S.admin ? "ok" : ""}">${S.admin ? "ATIVA" : "INATIVA"}</span></span>
    </div>`;
}

function dayPicker(sc) {
  if (sc.freq === "weekly") {
    return `<select id="schDay">${WEEKDAYS.map(([v, l]) => `<option value="${v}" ${sc.day === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  }
  if (sc.freq === "monthly") {
    return `<select id="schDay">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${String(sc.day) === String(i + 1) ? "selected" : ""}>Dia ${i + 1}</option>`).join("")}</select>`;
  }
  return "";
}

function scheduleSection() {
  const sc = currentSchedule();
  const freqs = SCHEDULE_FREQS.map(([v, l]) => `<button data-schfreq="${v}" aria-pressed="${sc.freq === v}">${l}</button>`).join("");
  const timing = sc.freq === "off" ? "" : `${dayPicker(sc)}<input type="time" id="schTime" value="${esc(sc.time || DEFAULT_SCHEDULE.time)}">`;
  const message = S.schedule.msg ||
    (S.schedule.active ? "Ativa: roda sozinha, sem abrir janela, com as categorias marcadas abaixo, e avisa quando terminar." : "Desligada.");
  const tone = S.schedule.msg ? "" : S.schedule.active ? "on" : "off";
  return `
    <div class="dh">Limpeza agendada</div>
    <div class="sched"><div class="toggle">${freqs}</div>${timing}<button class="btn" data-schsave>Salvar</button></div>
    <div class="sched-msg ${tone}">${esc(message)}</div>`;
}

function updatesSection() {
  const [tone, text] = updateStatus();
  const toggle = switchRow({
    on: !!S.settings.updateCheck, attrs: `data-setting="updateCheck"`, name: "Verificar atualizações automaticamente",
    desc: "Consulta só o GitHub do projeto ao abrir e a cada 12 h. Nenhum dado seu é enviado. A versão nova só é instalada se estiver assinada.",
  });
  const action = S.update.info
    ? `<button class="btn" data-openupdate>Ver atualização</button>`
    : `<button class="btn" data-checkupdate ${S.update.checking ? "disabled" : ""}>Verificar agora</button>`;
  return `
    <div class="dh">Atualizações</div>
    <div class="list">${toggle}</div>
    <div class="sched" style="margin-top:8px">${action}<span class="sched-msg ${tone}" style="margin:0">${esc(text)}</span></div>`;
}

function categoriesSection() {
  return CHANNELS.filter((c) => c.group).map((ch) => `
    <div class="dh">${ch.code} · ${ch.t}</div>
    ${catsOf(ch.group).map((c) => switchRow({ on: S.selected.has(c.id), attrs: `data-toggle="${c.id}"`, name: c.name })).join("")}`).join("");
}

export function viewSettings() {
  const behavior = BEHAVIOR.map(([key, name, desc]) => switchRow({ on: !!S.settings[key], attrs: `data-setting="${key}"`, name, desc })).join("");
  return `
    <section class="panel">
      ${panelHeader("settings", "Ajustes")}
      <div class="scroll settings">
        <div class="dh">Comportamento</div>
        <div class="list">${behavior}${adminRow()}</div>
        ${scheduleSection()}
        ${updatesSection()}
        <div class="dh">Categorias incluídas na limpeza</div>
        <div class="list">${categoriesSection()}</div>
        <div class="about">
          <div class="dh">Sobre</div>
          <p>O <b>Axios Cleaner</b> remove arquivos temporários, caches e logs que o Windows e os programas recriam sozinhos quando precisam.</p>
          <p>Histórico, senhas, cookies, favoritos e documentos nunca são tocados. Atalhos de pasta (junctions) não são seguidos, e arquivos em uso são pulados.</p>
          <p>Versão ${VERSION}.</p>
        </div>
      </div>
    </section>`;
}
