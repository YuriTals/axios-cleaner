import "./fake-env.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EN } from "../../ui/js/lang/en.js";
import { setLang, t, tb } from "../../ui/js/i18n.js";
import { plural } from "../../ui/js/format.js";
import { BACKEND_KEYS, codeKeys, dataKeys } from "./i18n-keys.js";

after(() => setLang("pt"));

/** Textos fixos do index.html marcados com data-i18n e data-i18n-title. */
function htmlKeys() {
  const html = readFileSync(new URL("../../ui/index.html", import.meta.url), "utf8");
  return [
    ...[...html.matchAll(/data-i18n>([^<]+)</g)].map((m) => m[1]),
    ...[...html.matchAll(/data-i18n-title="([^"]+)"/g)].map((m) => m[1]),
  ];
}

const allKeys = async () => new Set([...codeKeys(), ...(await dataKeys()), ...BACKEND_KEYS, ...htmlKeys()]);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("todo texto da interface tem traducao para o ingles", async () => {
  const missing = [...(await allKeys())].filter((k) => !(k in EN));
  assert.deepEqual(missing, [], "faltam traduções em ui/js/lang/en.js");
});

test("as traducoes mantem os mesmos {marcadores}", () => {
  const wrong = Object.entries(EN).filter(([pt, en]) => placeholders(pt).join() !== placeholders(en).join());
  assert.deepEqual(wrong, []);
});

test("o dicionario nao guarda traducoes que nao sao mais usadas", async () => {
  const keys = await allKeys();
  assert.deepEqual(Object.keys(EN).filter((k) => !keys.has(k)), []);
});

test("t troca o idioma, os marcadores e o plural", () => {
  setLang("en");
  assert.equal(t("Fechar {app} e limpar", { app: "Chrome" }), "Close Chrome and clean");
  assert.equal(plural(1, "arquivo", "arquivos"), "1 file");
  assert.equal(plural(3, "arquivo", "arquivos"), "3 files");
  assert.equal(t("texto sem tradução"), "texto sem tradução", "sem tradução fica o português");
  setLang("pt");
  assert.equal(t("Fechar {app} e limpar", { app: "Chrome" }), "Fechar Chrome e limpar");
});

test("textos do backend com numeros sao traduzidos por padrao", () => {
  setLang("en");
  assert.equal(tb("12 arquivos de cache removidos"), "12 cache files removed");
  assert.equal(tb("terminou com código 5"), "exited with code 5");
  assert.equal(tb("Pasta não encontrada."), "Folder not found.");
  setLang("pt");
  assert.equal(tb("Pasta não encontrada."), "Pasta não encontrada.");
});
