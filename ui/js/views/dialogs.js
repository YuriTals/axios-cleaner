// Perguntas em janela: fechar o app e fechar apps abertos antes de limpar.

import { esc } from "../format.js";
import { t } from "../i18n.js";
import { S } from "../state.js";
import { switchRow } from "../widgets.js";

const FRAME_RULE = 18;

function dialog(title, label, body) {
  const frame = "+" + "-".repeat(FRAME_RULE) + ` ${title} ` + "-".repeat(FRAME_RULE) + "+";
  return `
    <div class="upd-backdrop">
      <section class="upd ask panel" role="alertdialog" aria-label="${label}">
        <div class="ov-frame">${frame}</div>
        ${body}
        <div class="ov-frame">+${"-".repeat(frame.length - 2)}+</div>
      </section>
    </div>`;
}

// ---------------------------------------------------------------------------
// Fechar o app
// ---------------------------------------------------------------------------

/** Aviso extra quando ha algo rodando que o fechamento interrompe. */
export const RUN_WARNINGS = {
  clean: "Há uma limpeza em andamento. Ela será cancelada antes, e os serviços pausados voltam a rodar.",
  simulate: "Há uma simulação em andamento. Ela será cancelada antes de fechar.",
  tasks: "Há uma manutenção em andamento. Ela será cancelada antes de fechar.",
  recycle: "Arquivos estão indo para a Lixeira. O envio será interrompido antes de fechar.",
  update: "A atualização está sendo baixada. Fechar agora interrompe a instalação.",
};

export function quitModalHtml() {
  if (!S.quit) return "";
  const warning = RUN_WARNINGS[S.run?.kind];
  const actions = S.quit === "closing"
    ? `<div class="hint"><span class="spinner"></span> ${t(S.run?.cancel ? "Cancelando a tarefa e fechando" : "Fechando")}</div>`
    : `<div class="ask-btns">
        <button class="btn" data-quit="no" data-autofocus>${t("Ficar")}</button>
        <button class="btn yes" data-quit="yes">${t("Fechar")}</button>
      </div>
      <div class="hint">${t("Esc para ficar · desative em Ajustes")}</div>`;
  return dialog(t("SAIR"), t("Fechar o Axios Cleaner"), `
    <div class="ask-q">${t("Fechar o Axios Cleaner?")}</div>
    ${warning ? `<p class="ask-warn">${t(warning)}</p>` : ""}
    <div class="upd-act">${actions}</div>`);
}

// ---------------------------------------------------------------------------
// Fechar apps abertos antes de limpar
// ---------------------------------------------------------------------------

export function appsModalHtml() {
  const ask = S.askApps;
  if (!ask) return "";
  const rows = ask.apps.map((a) => switchRow({ on: ask.picked.has(a.name), attrs: `data-apppick="${esc(a.name)}"`, name: a.name })).join("");
  const n = ask.picked.size;
  const go = !n ? t("Limpar sem fechar")
    : n === 1 ? t("Fechar {app} e limpar", { app: esc([...ask.picked][0]) })
      : n === ask.apps.length ? t("Fechar todos e limpar") : t("Fechar {n} apps e limpar", { n });
  return dialog(t("LIMPAR"), t("Fechar apps abertos"), `
    <div class="ask-q">${t("Fechar apps abertos?")}</div>
    <p class="ask-p">${t("Para limpar o cache, estes apps precisam fechar. Escolha quais podem ser fechados:")}</p>
    <div class="list ask-list">${rows}</div>
    <p class="ask-warn">${t(n ? "Salve o que estiver fazendo nos apps marcados antes de continuar." : "Nenhum app será fechado.")}</p>
    <p class="ask-p muted">${t("Eles recebem o pedido de fechar como se você clicasse no X, e só são forçados se não fecharem em 8 s. O OneDrive é reaberto no final.")}</p>
    <div class="upd-act">
      <div class="ask-btns">
        <button class="btn" data-apps="cancel" data-autofocus>${t("Cancelar")}</button>
        <button class="btn yes" data-apps="go">${go}</button>
      </div>
      <div class="hint">${t("Nos apps que ficarem abertos, os arquivos em uso são pulados · Esc cancela")}</div>
    </div>`);
}
