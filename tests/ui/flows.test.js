import { called, replies, reset, until } from "./fake-env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S, bigCaches } from "../../ui/js/state.js";
import { groupApps } from "../../ui/js/format.js";
import * as actions from "../../ui/js/actions.js";
import { updateBadge, updateSkipped } from "../../ui/js/views/update.js";

const CHROME = { id: "chrome", group: "Navegadores", name: "Chrome", desc: "", processes: ["chrome.exe"], services: [], default_on: true };

beforeEach(() => {
  reset();
  Object.assign(replies, { get_history: [], scan: [], clean: { freed: 0, files: 0, skipped: 0, items: [], closed: [] } });
  Object.assign(S, { run: null, askApps: null, quit: null, cats: [CHROME], selected: new Set(["chrome"]), scan: { chrome: { bytes: 10, files: 1 } } });
  S.settings = { ...S.settings, closeApps: true };
  S.config = {};
  S.update = { info: null, checking: false, error: "", checkedAt: null, open: false, later: false };
});

// ---------------------------------------------------------------------------
// Fechar apps antes de limpar
// ---------------------------------------------------------------------------

test("groupApps junta os executaveis do mesmo app", () => {
  assert.deepEqual(groupApps(["chrome.exe", "Teams.exe", "ms-teams.exe"]), [
    { name: "Chrome", exes: ["chrome.exe"] },
    { name: "Teams", exes: ["Teams.exe", "ms-teams.exe"] },
  ]);
});

test("com apps abertos, a limpeza pergunta antes e nao comeca", async () => {
  replies.running_apps = ["chrome.exe"];
  await actions.clean("all");
  assert.equal(S.askApps.action, "all");
  assert.deepEqual([...S.askApps.picked], ["Chrome"]);
  assert.equal(called("clean").length, 0);
});

test("sem apps abertos, limpa direto sem perguntar", async () => {
  replies.running_apps = [];
  await actions.clean("all");
  assert.equal(S.askApps, null);
  assert.equal(called("clean").length, 1);
  await until(() => S.run === null && called("scan").length);
});

test("so os apps marcados vao em closeOnly", async () => {
  S.askApps = { action: "all", apps: groupApps(["chrome.exe", "Teams.exe", "ms-teams.exe"]), picked: new Set(["Teams"]) };
  actions.answerApps("go");
  const [, { opts }] = called("clean")[0];
  assert.equal(opts.closeApps, true);
  assert.deepEqual(opts.closeOnly, ["Teams.exe", "ms-teams.exe"]);
  await until(() => S.run === null && called("scan").length);
});

test("nenhum app marcado limpa sem fechar", async () => {
  S.askApps = { action: "all", apps: groupApps(["chrome.exe"]), picked: new Set() };
  actions.answerApps("go");
  assert.equal(called("clean")[0][1].opts.closeApps, false);
  await until(() => S.run === null && called("scan").length);
});

test("cancelar a pergunta nao limpa", () => {
  S.askApps = { action: "all", apps: groupApps(["chrome.exe"]), picked: new Set(["Chrome"]) };
  actions.answerApps("cancel");
  assert.equal(S.askApps, null);
  assert.equal(called("clean").length, 0);
});

// ---------------------------------------------------------------------------
// Sair do app
// ---------------------------------------------------------------------------

test("sair sem tarefa rodando fecha na hora", async () => {
  await actions.quitApp();
  assert.equal(called("cancel").length, 0);
  assert.equal(called("quit_app").length, 1);
});

test("sair com limpeza rodando cancela e espera ela terminar", async () => {
  S.run = { kind: "clean", cancel: "clean" };
  const quitting = actions.quitApp();
  await until(() => called("cancel").length);
  assert.deepEqual(called("cancel")[0][1], { job: "clean" });
  assert.equal(called("quit_app").length, 0, "ainda nao pode fechar");
  S.run = null; // a limpeza terminou
  await quitting;
  assert.equal(called("quit_app").length, 1);
});

// ---------------------------------------------------------------------------
// Tamanho da interface e cache gigante
// ---------------------------------------------------------------------------

test("Ctrl + sobe um nivel e Ctrl 0 volta a 100%", async () => {
  replies.set_zoom = ({ zoom }) => zoom;
  S.settings.zoom = 1;
  actions.stepZoom(1);
  await until(() => S.settings.zoom === 1.15);
  actions.stepZoom(1);
  await until(() => S.settings.zoom === 1.3);
  actions.stepZoom(1); // ja esta no maximo
  actions.stepZoom(0);
  await until(() => S.settings.zoom === 1);
  assert.deepEqual(called("set_zoom").map(([, a]) => a.zoom), [1.15, 1.3, 1]);
});

test("se o monitor nao comporta o zoom, avisa o maximo", async () => {
  replies.set_zoom = 1.15;
  await actions.setZoom(1.3);
  assert.equal(S.settings.zoom, 1.15);
  assert.match(S.zoomMsg, /115%/);
});

test("cache gigante: so categorias a partir de 5 GB, da maior para a menor", () => {
  const GB = 1024 ** 3;
  S.cats = [CHROME, { ...CHROME, id: "shaders" }, { ...CHROME, id: "recycle" }, { ...CHROME, id: "npm" }];
  S.scan = { chrome: { bytes: 4 * GB }, shaders: { bytes: 25 * GB }, recycle: { bytes: 50 * GB }, npm: { bytes: 6 * GB } };
  assert.deepEqual(bigCaches().map((c) => c.id), ["shaders", "npm"]);
});

// ---------------------------------------------------------------------------
// Atualizacoes
// ---------------------------------------------------------------------------

test("pular a versao esconde o selo e salva a escolha", () => {
  S.update.info = { version: "9.9.9" };
  assert.equal(updateBadge(), "Atualização v9.9.9");
  actions.dismissUpdate(true);
  assert.equal(S.config.updateSkip, "9.9.9");
  assert.ok(updateSkipped());
  assert.equal(updateBadge(), "");
  assert.equal(called("save_config").length, 1);
});

test("versao pulada nao abre sozinha, mas abre na verificacao manual", async () => {
  S.config.updateSkip = "9.9.9";
  replies.check_update = { version: "9.9.9" };
  await actions.checkForUpdates();
  assert.equal(S.update.open, false);
  await actions.checkForUpdates({ manual: true });
  assert.equal(S.update.open, true);
});

test("uma versao mais nova que a pulada volta a perguntar", async () => {
  S.config.updateSkip = "9.9.9";
  replies.check_update = { version: "9.9.10" };
  await actions.checkForUpdates();
  assert.equal(S.update.open, true);
});

test("lembrar depois nao pergunta de novo nesta sessao", async () => {
  S.update.info = { version: "9.9.9" };
  actions.dismissUpdate(false);
  assert.equal(S.config.updateSkip, undefined);
  replies.check_update = { version: "9.9.9" };
  await actions.checkForUpdates();
  assert.equal(S.update.open, false);
});
