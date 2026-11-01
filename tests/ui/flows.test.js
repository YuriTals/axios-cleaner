import { called, replies, reset, until } from "./fake-env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S, bigCaches, catsOf, dupGroupsFullyPicked } from "../../ui/js/state.js";
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
// Exclusoes, pastas extras e simulacao
// ---------------------------------------------------------------------------

test("exclusao escolhida vai para a configuracao e a varredura roda de novo", async () => {
  replies.pick_path = "D:\\Jogos";
  await actions.addPath("exclude");
  assert.deepEqual(S.config.exclude, ["D:\\Jogos"]);
  assert.equal(called("pick_path")[0][1].folder, true);
  await until(() => called("scan").length);
  assert.ok(called("save_config").length);
});

test("o mesmo caminho nao entra duas vezes (sem diferenciar maiusculas)", async () => {
  S.config.exclude = ["D:\\Jogos"];
  replies.pick_path = "d:\\jogos\\";
  await actions.addPath("exclude");
  assert.deepEqual(S.config.exclude, ["D:\\Jogos"]);
  assert.match(S.pathsMsg.text, /já está/);
});

test("pasta extra recusada pelo backend nao e salva e mostra o motivo", async () => {
  replies.pick_path = "C:\\Windows\\Temp";
  replies.check_custom_folder = () => { throw "Pastas do Windows e de programas são protegidas."; };
  await actions.addPath("custom");
  assert.equal(S.config.custom, undefined);
  assert.equal(S.pathsMsg.error, true);
  assert.equal(called("save_config").length, 0);
});

test("remover tira o caminho da lista", async () => {
  S.config.custom = ["D:\\Temp\\Downloads", "E:\\Cache"];
  actions.removePath("custom", "d:\\temp\\downloads");
  assert.deepEqual(S.config.custom, ["E:\\Cache"]);
  await until(() => called("scan").length);
});

test("Pastas extras so aparece na tela depois de adicionar uma", () => {
  S.cats = [CHROME, { ...CHROME, id: "custom", group: "Sistema" }, { ...CHROME, id: "usertemp", group: "Sistema" }];
  assert.deepEqual(catsOf("Sistema").map((c) => c.id), ["usertemp"]);
  S.config.custom = ["D:\\Temp"];
  assert.deepEqual(catsOf("Sistema").map((c) => c.id), ["custom", "usertemp"]);
});

test("simular manda as categorias marcadas e nao limpa", async () => {
  replies.simulate = { bytes: 10, files: 1, log: "C:\\logs\\simulacao.txt", cancelled: false };
  const running = actions.simulate("all");
  assert.equal(S.run.kind, "simulate");
  await running;
  assert.deepEqual(called("simulate")[0][1], { ids: ["chrome"] });
  assert.equal(called("clean").length, 0);
  assert.equal(S.run, null);
});

// ---------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------

const file = (path, modified) => ({ path, name: path.split("\\").pop(), folder: "", bytes: 100, modified });
const twoGroups = () => [
  { bytes: 100, files: [file("C:\\a\\x.jpg", 1), file("C:\\b\\x.jpg", 2), file("C:\\c\\x.jpg", 3)] },
  { bytes: 100, files: [file("C:\\a\\y.mp4", 1), file("C:\\b\\y.mp4", 2)] },
];

test("procurar duplicados usa a pasta do usuario e o tamanho minimo", async () => {
  S.map.home = "C:\\Users\\Teste";
  Object.assign(S.dups, { root: null, min: 10, groups: null, loading: false, picked: new Set() });
  replies.duplicates = twoGroups();
  await actions.loadDups();
  assert.deepEqual(called("duplicates")[0][1], { root: "C:\\Users\\Teste", minMb: 10 });
  assert.equal(S.dups.groups.length, 2);
});

test("marcar copias deixa a mais antiga de cada grupo", () => {
  S.dups.groups = twoGroups();
  actions.markDupCopies();
  assert.deepEqual([...S.dups.picked].sort(), ["C:\\b\\x.jpg", "C:\\b\\y.mp4", "C:\\c\\x.jpg"]);
  assert.equal(dupGroupsFullyPicked().length, 0);
  S.dups.picked.add("C:\\a\\y.mp4");
  assert.equal(dupGroupsFullyPicked().length, 1, "com todas marcadas o envio fica bloqueado");
});

test("depois de enviar para a Lixeira, grupo com uma copia so some da lista", async () => {
  S.dups.groups = twoGroups();
  S.dups.picked = new Set(["C:\\b\\y.mp4", "C:\\c\\x.jpg"]);
  replies.recycle_files = () => { S.run.done = 2; return [2, 200]; };
  actions.startAction("recycle-dups");
  await until(() => S.run === null);
  assert.deepEqual(S.dups.groups.map((g) => g.files.length), [2], "x.jpg ficou com 2 copias; y.mp4 com 1 sai");
  assert.equal(S.dups.picked.size, 0);
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
