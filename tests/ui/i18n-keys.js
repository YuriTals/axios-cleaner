// Todos os textos traduziveis da interface: os t("...") e plural(...) do
// codigo e os textos guardados em dados (catalogo, avisos, ajustes).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../../ui/js/", import.meta.url));
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const PATTERNS = [
  new RegExp(String.raw`\bt\(\s*` + STR, "g"), // t("texto")
  new RegExp(String.raw`\bt\(\s*(?:[^()"]|\([^()]*\))*?\?\s*` + STR + String.raw`\s*:\s*` + STR, "g"), // t(x ? "a" : "b"), t(f() ? ...)
  new RegExp(String.raw`\bplural\([^"]*?,\s*` + STR + String.raw`,\s*` + STR + String.raw`\)`, "g"), // plural(n, "a", "b")
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "lang" ? [] : files(path);
    return name.endsWith(".js") ? [path] : [];
  });
}

/** Textos encontrados no codigo-fonte. */
export function codeKeys() {
  const keys = new Set();
  for (const file of files(UI)) {
    const src = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join("\n"); // sem comentarios
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) m.slice(1).forEach((s) => s && keys.add(JSON.parse(`"${s}"`)));
    }
  }
  return keys;
}

/** Textos que vem de dados: a interface passa cada um por t() na hora de mostrar. */
export async function dataKeys() {
  const catalog = await import("../../ui/js/catalog.js");
  const { KIND_LABEL } = await import("../../ui/js/run.js");
  const { RUN_WARNINGS } = await import("../../ui/js/views/dialogs.js");
  const { BEHAVIOR_TEXTS } = await import("../../ui/js/views/app.js");
  const { LANGS } = await import("../../ui/js/i18n.js");
  return new Set([
    ...catalog.CHANNELS.flatMap((c) => [c.t, c.sub].filter(Boolean)),
    ...catalog.TASKS.flatMap((x) => [x.name, x.desc, x.time]),
    ...catalog.WEEKDAYS.map(([, l]) => l),
    ...catalog.SCHEDULE_FREQS.map(([, l]) => l),
    catalog.BIG_CACHE_TIP, ...Object.values(catalog.BIG_CACHE_TIPS),
    ...Object.values(KIND_LABEL), ...Object.values(RUN_WARNINGS), ...BEHAVIOR_TEXTS, ...LANGS.map(([, l]) => l),
    "Lixeira", "Outros",
  ]);
}

/** Textos que o backend manda prontos (fases, erros, origens) e a tela traduz com tb(). */
export const BACKEND_KEYS = [
  "Criando ponto de restauração…", "Fechando apps abertos…", "Pausando serviços do Windows…", "Limpando…", "Religando serviços…",
  "Listando", "Comparando o começo", "Comparando o conteúdo",
  "Use o caminho completo da pasta, como D:\\Downloads\\temp.", "Pasta não encontrada.", "Atalhos de pasta (junctions e links) não são aceitos.",
  "Pastas do Windows e de programas são protegidas.", "Essa pasta guarda arquivos pessoais ou do sistema. Escolha uma subpasta mais específica.",
  "Essa pasta é do sistema ou de programas e não pode ser analisada.",
  "Componentes antigos removidos", "Cache de DNS limpo", "Unidade otimizada", "Verificação concluída", "Ponto de restauração criado",
  "A Proteção do Sistema pode estar desativada nesta unidade.", "cancelada", "tarefa desconhecida",
  "Instale o app pelo instalador para usar a limpeza agendada.", "agendamento inválido", "frequência inválida", "item de inicialização desconhecido",
  "Usuário", "Todos os usuários", "Todos os usuários (32 bits)", "Pasta Inicializar", "Pasta Inicializar (todos)",
];
