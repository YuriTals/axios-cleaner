// Telas do app: historico e ajustes.

import { CHANNELS, SCHEDULE_FREQS, VERSION, WEEKDAYS, ZOOM_LEVELS } from "../catalog.js";
import { esc, fmt, plural } from "../format.js";
import { LANGS, catName, getLang, locale, t } from "../i18n.js";
import { S, catsOf } from "../state.js";
import { bigNumber, empty, panelHeader, switchRow } from "../widgets.js";
import { updateStatus } from "./update.js";

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------

const HISTORY_NAMES = 3;

/** "Sistema, Chrome, Edge +4" no idioma atual (historicos antigos so tem o texto pronto). */
function historyWhat(h) {
  if (!Array.isArray(h.ids)) return h.what || "";
  const names = h.ids.map((id) => S.cats.find((c) => c.id === id)).filter(Boolean).map(catName);
  return names.length > HISTORY_NAMES ? `${names.slice(0, HISTORY_NAMES).join(", ")} +${names.length - HISTORY_NAMES}` : names.join(", ");
}

function historyRow(h) {
  const d = new Date(h.at);
  const when = `${d.toLocaleDateString(locale())} · ${d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`;
  const tags = (h.auto ? `<span class="tag soft">${t("AGENDADA")}</span>` : "") + (h.cancelled ? `<span class="tag soft">${t("CANCELADA")}</span>` : "");
  return `<div class="row static"><span class="row-main"><span class="main">
      <span class="name">${when}${tags}</span>
      <span class="desc">${plural(h.files || 0, "arquivo", "arquivos")} · ${esc(historyWhat(h))}</span></span>
      <span class="size">${fmt(h.freed || 0)}</span></span>
      ${h.log ? `<button class="row-more" data-openfile="${esc(h.log)}" title="${t("Abrir log")}">log</button>` : ""}
    </div>`;
}

export function viewHistory() {
  const total = S.history.reduce((a, h) => a + (h.freed || 0), 0);
  const actions = `<button class="linkbtn mono" data-logs>${t("Pasta de logs")}</button>` +
    (S.history.length ? `<button class="linkbtn mono" data-clearhistory>${t("Apagar histórico")}</button>` : "");
  const rows = S.history.slice().reverse().map(historyRow).join("");
  return `
    <section class="panel">
      ${panelHeader("history", t("Histórico"), actions)}
      <div class="rec-hero">
        ${bigNumber(total, "white")}
        <div class="caption">${t("Liberados no total")}</div>
      </div>
      <div class="list scroll">${rows || empty(t("Nenhuma limpeza ainda."))}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

const BEHAVIOR = [
  ["closeApps", "Fechar apps abertos antes de limpar", "Se navegadores, Discord, Teams, WhatsApp, Telegram ou OneDrive estiverem abertos, pergunta antes de fechá-los (como clicar no X) e só força quem não fechar em 8 s. O OneDrive é reaberto no final. Desligado, arquivos em uso são pulados."],
  ["autoScan", "Analisar ao abrir", "Faz a varredura (só leitura) assim que o app abre."],
  ["protectRecent", "Proteger temporários recentes", "Arquivos das pastas Temp criados ou alterados nas últimas 24 h ficam, porque podem ser de um instalador ou programa ainda em uso."],
  ["restorePoint", "Criar ponto de restauração antes de limpar", "Mais seguro, mas deixa a limpeza ~1 min mais lenta. Precisa da Proteção do Sistema ativa."],
  ["closeToTray", "Fechar para a bandeja", "Fechar a janela deixa o app rodando no ícone perto do relógio. Para sair de vez, use o menu do ícone."],
  ["confirmClose", "Perguntar antes de fechar", "Confirma antes de sair pelo X, Alt+F4 ou “Sair” na bandeja. Tarefas em andamento são canceladas com segurança antes. Se a janela travar, Alt+F4 duas vezes fecha de qualquer jeito."],
];

const DEFAULT_SCHEDULE = { freq: "off", day: "SUN", time: "12:00" };
export const currentSchedule = () => S.config.schedule || { ...DEFAULT_SCHEDULE };

function adminRow() {
  const desc = t(S.admin
    ? "Ativa: limpa pastas do Windows e de todos os usuários."
    : "Inativa: só os arquivos do usuário atual que não exigem admin serão limpos.");
  return `<div class="row static"><span class="row-main">
      <span class="main"><span class="name">${t("Permissão de administrador")}</span><span class="desc">${desc}</span></span>
      <span class="tag ${S.admin ? "ok" : ""}">${t(S.admin ? "ATIVA" : "INATIVA")}</span></span>
    </div>`;
}

function dayPicker(sc) {
  if (sc.freq === "weekly") {
    return `<select id="schDay">${WEEKDAYS.map(([v, l]) => `<option value="${v}" ${sc.day === v ? "selected" : ""}>${t(l)}</option>`).join("")}</select>`;
  }
  if (sc.freq === "monthly") {
    return `<select id="schDay">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${String(sc.day) === String(i + 1) ? "selected" : ""}>${t("Dia {n}", { n: i + 1 })}</option>`).join("")}</select>`;
  }
  return "";
}

function scheduleSection() {
  const sc = currentSchedule();
  const freqs = SCHEDULE_FREQS.map(([v, l]) => `<button data-schfreq="${v}" aria-pressed="${sc.freq === v}">${t(l)}</button>`).join("");
  const timing = sc.freq === "off" ? "" : `${dayPicker(sc)}<input type="time" id="schTime" value="${esc(sc.time || DEFAULT_SCHEDULE.time)}">`;
  const message = S.schedule.msg ||
    t(S.schedule.active ? "Ativa: roda sozinha, sem abrir janela, com as categorias marcadas abaixo, e avisa quando terminar." : "Desligada.");
  const tone = S.schedule.msg ? "" : S.schedule.active ? "on" : "off";
  return `
    <div class="dh">${t("Limpeza agendada")}</div>
    <div class="sched"><div class="toggle">${freqs}</div>${timing}<button class="btn" data-schsave>${t("Salvar")}</button></div>
    <div class="sched-msg ${tone}">${esc(message)}</div>`;
}

function appearanceSection() {
  const current = S.settings.zoom || 1;
  const zooms = ZOOM_LEVELS.map(([z, label]) => `<button data-zoom="${z}" aria-pressed="${Math.abs(current - z) < 0.001}">${label}</button>`).join("");
  const langs = LANGS.map(([code, label]) => `<button data-lang="${code}" aria-pressed="${getLang() === code}">${label}</button>`).join("");
  return `
    <div class="dh">${t("Aparência")}</div>
    <div class="sched"><span class="sched-label">${t("Idioma")}</span><div class="toggle">${langs}</div></div>
    <div class="sched" style="margin-top:8px"><span class="sched-label">${t("Tamanho da interface")}</span><div class="toggle">${zooms}</div></div>
    <div class="sched-msg">${esc(S.zoomMsg || t("Atalhos: Ctrl + e Ctrl − mudam o tamanho, Ctrl 0 volta a 100%."))}</div>`;
}

function updatesSection() {
  const [tone, text] = updateStatus();
  const toggle = switchRow({
    on: !!S.settings.updateCheck, attrs: `data-setting="updateCheck"`, name: t("Verificar atualizações automaticamente"),
    desc: t("Consulta só o GitHub do projeto ao abrir e a cada 12 h. Nenhum dado seu é enviado. A versão nova só é instalada se estiver assinada."),
  });
  const action = S.update.info
    ? `<button class="btn" data-openupdate>${t("Ver atualização")}</button>`
    : `<button class="btn" data-checkupdate ${S.update.checking ? "disabled" : ""}>${t("Verificar agora")}</button>`;
  return `
    <div class="dh">${t("Atualizações")}</div>
    <div class="list">${toggle}</div>
    <div class="sched" style="margin-top:8px">${action}<span class="sched-msg ${tone}" style="margin:0">${esc(text)}</span></div>`;
}

function pathRows(key, emptyText) {
  const list = S.config[key] || [];
  if (!list.length) return `<div class="row static"><span class="row-main"><span class="main"><span class="desc">${emptyText}</span></span></span></div>`;
  return list.map((p) => `
    <div class="row static"><span class="row-main"><span class="main"><span class="name path-name" title="${esc(p)}">${esc(p)}</span></span></span>
      <button class="row-more" data-pathrm="${key}" data-path="${esc(p)}" title="${t("Remover da lista")}">×</button></div>`).join("");
}

function pathMsg(key) {
  const m = S.pathsMsg;
  return m?.key === key ? `<div class="sched-msg ${m.error ? "off" : ""}">${esc(m.text)}</div>` : "";
}

/** Exclusoes (nunca apagar) e pastas extras (limpar tambem). */
function pathsSection() {
  return `
    <div class="dh">${t("Nunca apagar")}</div>
    <div class="sub-s">${t("Arquivos e pastas desta lista ficam, mesmo se estiverem dentro de uma área de limpeza.")}</div>
    <div class="list">${pathRows("exclude", t("Nenhuma exclusão."))}</div>
    <div class="sched" style="margin-top:8px">
      <button class="btn" data-pathadd="exclude:folder">+ ${t("Pasta")}</button><button class="btn" data-pathadd="exclude:file">+ ${t("Arquivo")}</button>
    </div>
    ${pathMsg("exclude")}
    <div class="dh">${t("Pastas extras para limpar")}</div>
    <div class="sub-s">${t("Todo o conteúdo delas é apagado junto com o Sistema; a pasta em si fica. Pastas do Windows, de programas e pessoais (Documentos, Área de Trabalho…) não são aceitas.")}</div>
    <div class="list">${pathRows("custom", t("Nenhuma pasta extra."))}</div>
    <div class="sched" style="margin-top:8px"><button class="btn" data-pathadd="custom:folder">+ ${t("Pasta")}</button></div>
    ${pathMsg("custom")}`;
}

function categoriesSection() {
  return CHANNELS.filter((c) => c.group).map((ch) => `
    <div class="dh">${ch.code} · ${t(ch.t)}</div>
    ${catsOf(ch.group).map((c) => switchRow({ on: S.selected.has(c.id), attrs: `data-toggle="${c.id}"`, name: catName(c) })).join("")}`).join("");
}

export function viewSettings() {
  const behavior = BEHAVIOR.map(([key, name, desc]) => switchRow({ on: !!S.settings[key], attrs: `data-setting="${key}"`, name: t(name), desc: t(desc) })).join("");
  return `
    <section class="panel">
      ${panelHeader("settings", t("Ajustes"))}
      <div class="scroll settings">
        ${appearanceSection()}
        <div class="dh">${t("Comportamento")}</div>
        <div class="list">${behavior}${adminRow()}</div>
        ${pathsSection()}
        ${scheduleSection()}
        ${updatesSection()}
        <div class="dh">${t("Categorias incluídas na limpeza")}</div>
        <div class="list">${categoriesSection()}</div>
        <div class="about">
          <div class="dh">${t("Sobre")}</div>
          <p>${t("O <b>Axios Cleaner</b> remove arquivos temporários, caches e logs que o Windows e os programas recriam sozinhos quando precisam.")}</p>
          <p>${t("Histórico, senhas, cookies, favoritos e documentos nunca são tocados. Atalhos de pasta (junctions) não são seguidos, e arquivos em uso são pulados.")}</p>
          <p>${t("Versão {v}.", { v: VERSION })}</p>
        </div>
      </div>
    </section>`;
}

/** Textos de BEHAVIOR (para o teste de traducoes). */
export const BEHAVIOR_TEXTS = BEHAVIOR.flatMap(([, name, desc]) => [name, desc]);
