import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../ui/js/state.js";
import { runFor, runFraction } from "../../ui/js/run.js";

beforeEach(() => { S.run = null; });

test("limpeza: % vem dos arquivos processados sobre o total da varredura", () => {
  const r = { kind: "clean", done: 30, cur: 20, total: 200 };
  assert.equal(runFraction(r), 0.25);
});

test("% nunca chega a 100 antes de terminar, e e 100 quando termina", () => {
  assert.equal(runFraction({ kind: "scan", done: 10, total: 10 }), 0.99);
  assert.equal(runFraction({ kind: "scan", done: 10, total: 10, finished: true }), 1);
});

test("manutencao: tarefas concluidas contam pelo peso estimado", () => {
  // dns (2 s) concluida de um total dns + trim (92 s)
  const r = { kind: "tasks", doneW: 2, totalW: 92, curId: null, curStart: 0 };
  assert.ok(Math.abs(runFraction(r) - 2 / 92) < 1e-9);
});

test("uma limpeza aparece em todos os botoes de limpeza, mas nao na manutencao", () => {
  S.run = { kind: "clean", action: "group:Sistema" };
  assert.equal(runFor("all"), S.run);
  assert.equal(runFor("recycle"), S.run);
  assert.equal(runFor("group:Navegadores"), S.run);
  assert.equal(runFor("tasks"), null);
});

test("a manutencao so aparece no proprio botao", () => {
  S.run = { kind: "tasks", action: "tasks" };
  assert.equal(runFor("tasks"), S.run);
  assert.equal(runFor("all"), null);
});
