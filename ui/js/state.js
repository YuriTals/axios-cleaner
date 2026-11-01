// Estado da interface e consultas sobre ele.

import { AREA_COLORS, BIG_CACHE_BYTES, CHANNELS, DEFAULT_SETTINGS, DEFAULT_TASKS, LEGACY_IDS } from "./catalog.js";
import { invoke } from "./tauri.js";

export const S = {
  route: "home",
  lastRoute: null,
  cats: [],
  scan: {},            // id -> { bytes, files, running }
  selected: new Set(),
  scanSecs: 0,
  scanAt: null,
  run: null,           // tarefa em andamento (limpeza, varredura, manutencao, lixeira)
  hoverRun: null,      // botao de execucao sob o mouse
  confirmRun: null,    // botao pedindo confirmacao de cancelamento
  working: null,       // categoria sendo limpa
  cleaned: {},         // id -> resultado da ultima limpeza
  summary: null,
  stats: null,
  hist: { cpu: [], gpu: [], mem: [], disk: [] },
  diskView: "now",     // now | after
  coreHover: -1,
  admin: true,
  config: {},
  settings: { ...DEFAULT_SETTINGS },
  history: [],
  openDetails: null,
  details: {},         // id -> dados | "loading"
  big: { min: 500, items: null, picked: new Set(), loading: false, result: null },
  dups: { min: 10, root: null, groups: null, picked: new Set(), loading: false, progress: null, result: null, error: "" },
  map: { home: null, root: null, data: null, loading: false, progress: null, hover: -1 },
  startup: null,
  tasks: { picked: new Set(DEFAULT_TASKS), status: {} },
  schedule: { active: false, msg: "" },
  update: { info: null, checking: false, error: "", checkedAt: null, open: false, later: false },
  quit: null,          // confirmacao de fechar: null | "ask" | "closing"
  askApps: null,       // { action, apps }: pergunta se pode fechar apps antes de limpar
};

/** "Pastas extras" so aparece depois que o usuario adiciona alguma em Ajustes. */
const visible = (c) => c.id !== "recycle" && (c.id !== "custom" || (S.config.custom || []).length > 0);
export const catsOf = (group) => S.cats.filter((c) => c.group === group && visible(c));
export const idsOf = (group) => catsOf(group).map((c) => c.id);
export const allIds = () => S.cats.map((c) => c.id);
export const bytesOf = (id) => S.scan[id]?.bytes || 0;
export const filesOf = (id) => S.scan[id]?.files || 0;
export const sum = (ids, f) => ids.reduce((a, id) => a + f(id), 0);
export const selIn = (ids) => ids.filter((id) => S.selected.has(id));
export const selectedBytes = (ids = allIds()) => sum(selIn(ids), bytesOf);
export const busy = () => S.run != null;
/** Grupos de duplicados com todas as copias marcadas (nao pode: nao sobraria nenhuma). */
export const dupGroupsFullyPicked = () => (S.dups.groups || []).filter((g) => g.files.every((f) => S.dups.picked.has(f.path)));
/** Categorias com cache gigante, da maior para a menor. */
export const bigCaches = () => S.cats.filter((c) => c.id !== "recycle" && bytesOf(c.id) >= BIG_CACHE_BYTES).sort((a, b) => bytesOf(b.id) - bytesOf(a.id));
export const scanning = () => S.run?.kind === "scan";

/** Areas do inicio: cada grupo de limpeza + Lixeira, com o total selecionado. */
export function areas() {
  const list = CHANNELS.filter((c) => c.group).map((c) => ({ name: c.t, route: c.id, ids: idsOf(c.group) }));
  list.push({ name: "Lixeira", route: "recycle", ids: ["recycle"] });
  return list.map((a, k) => ({ ...a, bytes: selectedBytes(a.ids), color: AREA_COLORS[k] }));
}

export function toggle(set, value) {
  set.has(value) ? set.delete(value) : set.add(value);
}

/** Grava no disco; a promessa termina quando o backend ja pode ler a configuracao nova. */
export function saveConfig() {
  S.config.selected = [...S.selected];
  S.config.known = allIds();
  S.config.settings = S.settings;
  return invoke("save_config", { config: S.config }).catch(console.error);
}

function readLegacy(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

/** Selecao inicial: padrao de cada categoria, respeitando o que a v1.0 guardou no navegador. */
function initialSelection() {
  const selected = new Set(S.cats.filter((c) => c.default_on).map((c) => c.id));
  const legacy = readLegacy("axios.selected");
  if (Array.isArray(legacy)) LEGACY_IDS.forEach((id) => { if (!legacy.includes(id)) selected.delete(id); });
  return selected;
}

/** Le a configuracao salva; categorias novas entram conforme o padrao delas. */
export function applyConfig(cfg) {
  S.config = cfg || {};
  S.settings = { ...DEFAULT_SETTINGS, ...(readLegacy("axios.settings") || {}), ...(S.config.settings || {}) };
  if (Array.isArray(S.config.selected)) {
    const known = new Set(S.config.known || []);
    const ids = allIds();
    S.selected = new Set(S.config.selected.filter((id) => ids.includes(id)));
    S.cats.forEach((c) => { if (!known.has(c.id) && c.default_on) S.selected.add(c.id); });
  } else {
    S.selected = initialSelection();
  }
  saveConfig();
}
