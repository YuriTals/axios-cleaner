// Perguntas em janela: fechar o app e fechar apps abertos antes de limpar.

import { esc } from "../format.js";
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
const RUN_WARNINGS = {
  clean: "Há uma limpeza em andamento. Ela será cancelada antes, e os serviços pausados voltam a rodar.",
  tasks: "Há uma manutenção em andamento. Ela será cancelada antes de fechar.",
  recycle: "Arquivos estão indo para a Lixeira. O envio será interrompido antes de fechar.",
  update: "A atualização está sendo baixada. Fechar agora interrompe a instalação.",
};

export function quitModalHtml() {
  if (!S.quit) return "";
  const warning = RUN_WARNINGS[S.run?.kind];
  const actions = S.quit === "closing"
    ? `<div class="hint"><span class="spinner"></span> ${S.run?.cancel ? "Cancelando a tarefa e fechando" : "Fechando"}</div>`
    : `<div class="ask-btns">
        <button class="btn" data-quit="no">Ficar</button>
        <button class="btn yes" data-quit="yes">Fechar</button>
      </div>
      <div class="hint">Esc para ficar · desative em Ajustes</div>`;
  return dialog("SAIR", "Fechar o Axios Cleaner", `
    <div class="ask-q">Fechar o Axios Cleaner?</div>
    ${warning ? `<p class="ask-warn">${warning}</p>` : ""}
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
  const which = n === 1 ? esc([...ask.picked][0]) : n === ask.apps.length ? "todos" : `${n} apps`;
  const go = n ? `Fechar ${which} e limpar` : "Limpar sem fechar";
  return dialog("LIMPAR", "Fechar apps abertos", `
    <div class="ask-q">Fechar apps abertos?</div>
    <p class="ask-p">Para limpar o cache, estes apps precisam fechar. Escolha quais podem ser fechados:</p>
    <div class="list ask-list">${rows}</div>
    <p class="ask-warn">${n ? "Salve o que estiver fazendo nos apps marcados antes de continuar." : "Nenhum app será fechado."}</p>
    <p class="ask-p muted">Eles recebem o pedido de fechar como se você clicasse no X, e só são forçados se não fecharem em 8 s. O OneDrive é reaberto no final.</p>
    <div class="upd-act">
      <div class="ask-btns">
        <button class="btn" data-apps="cancel">Cancelar</button>
        <button class="btn yes" data-apps="go">${go}</button>
      </div>
      <div class="hint">Nos apps que ficarem abertos, os arquivos em uso são pulados · Esc cancela</div>
    </div>`);
}
