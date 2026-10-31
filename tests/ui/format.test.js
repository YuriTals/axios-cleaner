import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, appNames, asciiBar, asciiChart, esc, fmt, parentOf, remaining, sizeParts } from "../../ui/js/format.js";

const KB = 1024, MB = KB ** 2, GB = KB ** 3;

test("sizeParts escolhe a unidade e as casas decimais", () => {
  assert.deepEqual(sizeParts(500), { value: 500 / KB, decimals: 0, unit: "KB" });
  assert.equal(sizeParts(5 * MB).unit, "MB");
  assert.equal(sizeParts(5 * MB).decimals, 2);
  assert.equal(sizeParts(50 * MB).decimals, 1);
  assert.equal(sizeParts(500 * MB).decimals, 0);
  assert.equal(sizeParts(2 * GB).unit, "GB");
});

test("fmt usa formato brasileiro", () => {
  assert.equal(fmt(2.47 * GB), "2,47 GB");
  assert.equal(fmt(0), "0 KB");
});

test("asciiBar preenche proporcionalmente e limita a 0..1", () => {
  assert.equal(asciiBar(0.5, 10), "[<b>=====</b>-----]");
  assert.equal(asciiBar(2, 4), "[<b>====</b>]");
  assert.equal(asciiBar(-1, 4), "[<b></b>----]");
});

test("asciiChart tem uma linha por nivel e marca a amostra atual", () => {
  const out = asciiChart([100], 3, 2);
  assert.equal(out.split("\n").length, 2);
  assert.match(out, /class="now"/);
});

test("parentOf sobe uma pasta e para na raiz do disco", () => {
  assert.equal(parentOf("C:\\Users\\Yuri"), "C:\\Users");
  assert.equal(parentOf("C:\\Users"), "C:\\");
  assert.equal(parentOf("C:\\"), null);
});

test("ago descreve o tempo em portugues", () => {
  const now = Date.UTC(2026, 9, 30);
  const daysAgo = (d) => now / 1000 - d * 86400;
  assert.equal(ago(daysAgo(0.5), now), "hoje");
  assert.equal(ago(daysAgo(1.5), now), "ontem");
  assert.equal(ago(daysAgo(10), now), "há 10 dias");
  assert.equal(ago(daysAgo(40), now), "há 1 mês");
  assert.equal(ago(daysAgo(800), now), "há 2 anos");
  assert.equal(ago(0, now), "");
});

test("remaining arredonda para cima em segundos e para minutos depois de 1 min", () => {
  assert.equal(remaining(0.2), "restam ~1 s");
  assert.equal(remaining(19.1), "restam ~20 s");
  assert.equal(remaining(150), "restam ~3 min");
});

test("esc neutraliza HTML", () => {
  assert.equal(esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("appNames traduz executaveis conhecidos e limpa os demais", () => {
  assert.deepEqual(appNames(["chrome.exe", "foo.exe"]), ["Chrome", "foo"]);
});
