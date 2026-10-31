// Aviso de atualizacao: selo na barra de titulo e janela com as novidades.

import { VERSION } from "../catalog.js";
import { esc } from "../format.js";
import { runButton, runFor } from "../run.js";
import { S, busy } from "../state.js";

const FRAME_RULE = 16;

/** Texto do selo na barra de titulo, ou "" quando nao ha atualizacao. */
export const updateBadge = () => (S.update.info ? `Atualização v${S.update.info.version}` : "");

/** Notas da release em texto simples (sem markdown pesado), uma linha por item. */
function notesHtml(notes) {
  const lines = notes
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
  if (!lines.length) return `<p class="muted">Sem notas para esta versão.</p>`;
  return lines.map((l) => (l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : `<p>${esc(l)}</p>`)).join("");
}

export function updateModalHtml() {
  const info = S.update.info;
  if (!S.update.open || !info) return "";
  const installing = !!runFor("update");
  const frame = "+" + "-".repeat(FRAME_RULE) + " ATUALIZAÇÃO " + "-".repeat(FRAME_RULE) + "+";
  return `
    <div class="upd-backdrop">
      <section class="upd panel" role="dialog" aria-label="Atualização disponível">
        <div class="ov-frame">${frame}</div>
        <div class="upd-ver"><span class="mono muted">v${esc(info.current || VERSION)}</span><span class="ruby"> -&gt; </span><span class="upd-new">v${esc(info.version)}</span></div>
        <div class="dh">Novidades${info.date ? ` · ${esc(info.date)}` : ""}</div>
        <div class="upd-notes scroll">${notesHtml(info.notes)}</div>
        <div class="upd-act">
          ${runButton("update", "ATUALIZAR", busy() && !installing)}
          <div class="hint">${installing ? "O app fecha e reabre na versão nova" : "Segure até a barra encher · baixa, confere a assinatura e instala"}</div>
          ${installing ? "" : `<button class="linkbtn mono" data-closeupdate>Depois</button>`}
        </div>
        <div class="ov-frame">+${"-".repeat(frame.length - 2)}+</div>
      </section>
    </div>`;
}

/** Linha de status nos Ajustes. */
export function updateStatus() {
  const u = S.update;
  if (u.checking) return ["", "Verificando…"];
  if (u.error) return ["off", `Não deu para verificar agora (${u.error}).`];
  if (u.info) return ["on", `Versão ${u.info.version} disponível.`];
  if (u.checkedAt) {
    const at = u.checkedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return ["on", `Você está na versão mais recente (${VERSION}) · verificado às ${at}.`];
  }
  return ["", `Versão instalada: ${VERSION}.`];
}
