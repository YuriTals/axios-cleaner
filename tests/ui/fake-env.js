// Navegador e Tauri de mentira, para testar actions.js no Node.
// Importe ANTES dos modulos da interface.

function fakeElement() {
  return {
    innerHTML: "", textContent: "", className: "", hidden: false, dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, insertAdjacentHTML() {}, focus() {},
    getContext: () => null,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
  };
}

/** Comandos recebidos pelo "backend": [nome, argumentos]. */
export const calls = [];
/** Resposta de cada comando: valor fixo ou funcao(args). */
export const replies = {};

globalThis.window = globalThis;
globalThis.innerWidth = 1200;
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.document = {
  hidden: false,
  activeElement: null,
  body: fakeElement(),
  documentElement: fakeElement(),
  querySelector: () => fakeElement(),
  querySelectorAll: () => [],
  createElement: () => fakeElement(),
  addEventListener() {}, removeEventListener() {},
};
globalThis.__TAURI__ = {
  core: {
    invoke(cmd, args) {
      calls.push([cmd, args]);
      const r = replies[cmd];
      return Promise.resolve(typeof r === "function" ? r(args) : r);
    },
  },
  event: { listen: async () => () => {} },
  window: { getCurrentWindow: () => ({}) },
  webview: { getCurrentWebview: () => ({ setZoom: async () => {} }) },
};

export const called = (cmd) => calls.filter(([c]) => c === cmd);

/** Espera ate a condicao valer (ou falha depois de `ms`). */
export async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("tempo esgotado esperando a condição");
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function reset() {
  calls.length = 0;
  for (const k of Object.keys(replies)) delete replies[k];
}
