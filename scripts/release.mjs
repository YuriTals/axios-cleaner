// Publica uma versao nova: build assinado + latest.json + releases no GitHub.
//
//   npm run release -- caminho/das/notas.md
//
// O app instalado consulta o latest.json do repositorio publico de releases
// e so instala o arquivo se a assinatura bater com a chave do projeto.
//
// Variaveis de ambiente (opcionais):
//   TAURI_SIGNING_PRIVATE_KEY           caminho da chave privada (padrao: ~/.tauri/axios-cleaner-updater.key)
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  senha da chave (padrao: vazia)

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PUBLIC_REPO = "YuriTals/axios-cleaner-releases";
const SOURCE_REPO = "YuriTals/axios-cleaner";
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NSIS_DIR = join(ROOT, "src-tauri/target/release/bundle/nsis");
const DIST = join(ROOT, "dist");

function fail(message) {
  console.error(`\n[release] ${message}`);
  process.exit(1);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32", ...opts }).trim();

function ensureCleanAndPushed() {
  if (run("git", ["status", "--porcelain"])) fail("Há mudanças não commitadas. Faça commit e push antes de publicar.");
  run("git", ["fetch", "-q", "origin"]);
  if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) fail("O commit local não está no GitHub. Rode git push antes de publicar.");
}

function ensureNewVersion(tag) {
  const exists = spawnSync("gh", ["release", "view", tag, "-R", PUBLIC_REPO], { cwd: ROOT, shell: true, stdio: "ignore" }).status === 0;
  if (exists) fail(`A versão ${tag} já foi publicada. Aumente a versão em src-tauri/tauri.conf.json, Cargo.toml, package.json e ui/js/catalog.js.`);
}

function buildSigned() {
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY || join(homedir(), ".tauri", "axios-cleaner-updater.key"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  };
  if (!existsSync(env.TAURI_SIGNING_PRIVATE_KEY)) fail(`Chave privada não encontrada em ${env.TAURI_SIGNING_PRIVATE_KEY}.`);
  const result = spawnSync("npx", ["tauri", "build"], { cwd: ROOT, env, stdio: "inherit", shell: true });
  if (result.status !== 0) fail("O build falhou.");
}

/** Copia o instalador com um nome sem espacos (o GitHub troca espaco por ponto). */
function collectArtifacts(version) {
  const installer = join(NSIS_DIR, `Axios Cleaner_${version}_x64-setup.exe`);
  const signature = `${installer}.sig`;
  if (!existsSync(installer) || !existsSync(signature)) fail("Instalador ou assinatura (.sig) não encontrados após o build.");
  mkdirSync(DIST, { recursive: true });
  const name = `AxiosCleaner_${version}_x64-setup.exe`;
  copyFileSync(installer, join(DIST, name));
  return { name, path: join(DIST, name), signature: readFileSync(signature, "utf8").trim() };
}

function writeManifest(version, notes, artifact) {
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: artifact.signature,
        url: `https://github.com/${PUBLIC_REPO}/releases/download/v${version}/${artifact.name}`,
      },
    },
  };
  const path = join(DIST, "latest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return path;
}

function publish(tag, title, notesFile, files) {
  run("gh", ["release", "create", tag, "-R", PUBLIC_REPO, ...files.map((f) => `"${f}"`), "--title", `"${title}"`, "--notes-file", `"${notesFile}"`, "--latest"]);
  run("gh", ["release", "create", tag, "-R", SOURCE_REPO, `"${files[0]}"`, "--target", "main", "--title", `"${title}"`, "--notes-file", `"${notesFile}"`, "--latest"]);
}

const notesFile = process.argv[2];
if (!notesFile || !existsSync(notesFile)) fail("Informe o arquivo de notas: npm run release -- notas.md");

const version = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")).version;
const tag = `v${version}`;
ensureCleanAndPushed();
ensureNewVersion(tag);
buildSigned();
const artifact = collectArtifacts(version);
const manifest = writeManifest(version, readFileSync(notesFile, "utf8").trim(), artifact);
publish(tag, `Axios Cleaner ${version}`, notesFile, [artifact.path, manifest]);
console.log(`\n[release] ${tag} publicada. Apps com verificação ligada vão oferecer a atualização.`);
