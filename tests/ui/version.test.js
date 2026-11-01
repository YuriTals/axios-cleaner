import { test } from "node:test";
import assert from "node:assert/strict";
import { currentVersion } from "../../scripts/bump.mjs";

test("todos os arquivos estao na mesma versao (npm run bump -- x.y.z)", () => {
  assert.match(currentVersion(), /^\d+\.\d+\.\d+$/);
});
