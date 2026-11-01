// Publica uma versao nova: build assinado + latest.json + releases no GitHub.
//
//   npm run release -- caminho/das/notas.md
//
// O app instalado consulta o latest.json da ultima release deste repositorio
// e so instala o arquivo se a assinatura bater com a chave do projeto.
//
// Variaveis de ambiente (opcionais):
//   TAURI_SIGNING_PRIVATE_KEY           caminho da chave privada (padrao: ~/.tauri/axios-cleaner-updater.key)
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  senha da chave (padrao: vazia)

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { currentVersion } from "./bump.mjs";

const REPO = "YuriTals/axios-cleaner";
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NSIS_DIR = join(ROOT, "src-tauri/target/release/bundle/nsis");
const DIST = join(ROOT, "dist");
const STEPS = 5;

function fail(message) {
  console.error(`\n[release] ${message}`);
  process.exit(1);
}

let stepNo = 0;
const step = (message) => console.log(`\n[release] ${++stepNo}/${STEPS} ${message}`);

// git e gh sao executaveis de verdade: rodam sem shell, sem o aviso DEP0190.
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

function ensureCleanAndPushed() {
  if (run("git", ["status", "--porcelain"])) fail("Há mudanças não commitadas. Faça commit e push antes de publicar.");
  run("git", ["fetch", "-q", "origin"]);
  if (run("git", ["rev-parse", "HEAD"]) !== run("git", ["rev-parse", "origin/main"])) fail("O commit local não está no GitHub. Rode git push antes de publicar.");
}

function ensureNewVersion(tag) {
  const exists = spawnSync("gh", ["release", "view", tag, "-R", REPO], { cwd: ROOT, stdio: "ignore" }).status === 0;
  if (exists) fail(`A versão ${tag} já foi publicada. Aumente a versão com: npm run bump -- <versão nova>`);
}

function buildSigned() {
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY || join(homedir(), ".tauri", "axios-cleaner-updater.key"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  };
  if (!existsSync(env.TAURI_SIGNING_PRIVATE_KEY)) fail(`Chave privada não encontrada em ${env.TAURI_SIGNING_PRIVATE_KEY}.`);
  // npx e um .cmd no Windows e precisa do shell; o comando vai inteiro numa string.
  const result = spawnSync("npx tauri build", { cwd: ROOT, env, stdio: "inherit", shell: true });
  if (result.status !== 0) fail(result.signal || result.status === null ? "O build foi interrompido. Nada foi publicado." : "O build falhou. Nada foi publicado.");
}

/** Copia o instalador com um nome sem espacos (o GitHub troca espaco por ponto). */
function collectArtifacts(version, builtAfter) {
  const installer = join(NSIS_DIR, `Axios Cleaner_${version}_x64-setup.exe`);
  const signature = `${installer}.sig`;
  if (!existsSync(installer) || !existsSync(signature)) fail("Instalador ou assinatura (.sig) não encontrados após o build.");
  // Um instalador mais velho que este build seria de uma tentativa anterior.
  if (statSync(installer).mtimeMs < builtAfter || statSync(signature).mtimeMs < builtAfter) fail("O instalador encontrado é de um build anterior. Rode a release de novo.");
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
        url: `https://github.com/${REPO}/releases/download/v${version}/${artifact.name}`,
      },
    },
  };
  const path = join(DIST, "latest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return path;
}

function publish(tag, title, notesFile, files) {
  run("gh", ["release", "create", tag, "-R", REPO, ...files, "--target", "main", "--title", title, "--notes-file", notesFile, "--latest"]);
}

const notesFile = process.argv[2];
if (!notesFile || !existsSync(notesFile)) fail("Informe o arquivo de notas: npm run release -- notas.md");
const notes = readFileSync(notesFile, "utf8").trim();
if (!notes) fail(`O arquivo de notas ${notesFile} está vazio.`);

let version;
try {
  version = currentVersion();
} catch (e) {
  fail(`${e.message}\nAcerte com: npm run bump -- <versão>`);
}
const tag = `v${version}`;

step(`Conferindo git e versão (${tag})`);
ensureCleanAndPushed();
ensureNewVersion(tag);

step("Compilando e assinando (leva alguns minutos)");
const builtAfter = Date.now();
buildSigned();

step("Conferindo o instalador");
const artifact = collectArtifacts(version, builtAfter);

step("Gerando latest.json");
const manifest = writeManifest(version, notes, artifact);

step("Publicando no GitHub");
publish(tag, `Axios Cleaner ${version}`, notesFile, [artifact.path, manifest]);
console.log(`\n[release] ${tag} publicada. Apps com verificação ligada vão oferecer a atualização.`);
