// Troca a versao do app em todos os arquivos de uma vez.
//
//   npm run bump -- 1.2.4
//
// Sem argumento, so mostra a versao de cada arquivo (e falha se divergirem).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Cada arquivo com a versao: como ler e como trocar. */
const FILES = [
  { path: "package.json", re: /^(\s*"version":\s*")([^"]+)(")/m },
  { path: "package-lock.json", re: /^(  "version":\s*")([^"]+)(")/m },
  { path: "package-lock.json", re: /("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")([^"]+)(")/ },
  { path: "src-tauri/tauri.conf.json", re: /^(\s*"version":\s*")([^"]+)(")/m },
  { path: "src-tauri/Cargo.toml", re: /^(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m },
  { path: "src-tauri/Cargo.lock", re: /^(name = "axios-cleaner"\r?\nversion = ")([^"]+)(")/m },
  { path: "ui/js/catalog.js", re: /^(export const VERSION = ")([^"]+)(")/m },
];

/** Versao encontrada em cada arquivo: [{ path, version }]. */
export function readVersions(root = ROOT) {
  return FILES.map(({ path, re }) => {
    const m = readFileSync(join(root, path), "utf8").match(re);
    return { path, version: m ? m[2] : null };
  });
}

/** A versao comum a todos os arquivos, ou um erro dizendo onde diverge. */
export function currentVersion(root = ROOT) {
  const found = readVersions(root);
  const versions = new Set(found.map((f) => f.version));
  if (versions.size !== 1 || versions.has(null)) {
    throw new Error("Versões diferentes entre os arquivos:\n" + found.map((f) => `  ${f.path}: ${f.version ?? "não encontrada"}`).join("\n"));
  }
  return found[0].version;
}

function bump(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versão inválida: "${version}". Use o formato 1.2.4.`);
  for (const { path, re } of FILES) {
    const file = join(ROOT, path);
    const text = readFileSync(file, "utf8");
    if (!re.test(text)) throw new Error(`Versão não encontrada em ${path}`);
    writeFileSync(file, text.replace(re, (_, a, _old, c) => a + version + c));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = process.argv[2];
    if (target) {
      const before = [...new Set(readVersions().map((f) => f.version))].join(", ");
      bump(target);
      console.log(`[bump] ${before} -> ${currentVersion()}`);
    } else {
      console.log(`[bump] versão atual: ${currentVersion()}`);
    }
  } catch (e) {
    console.error(`[bump] ${e.message}`);
    process.exit(1);
  }
}
