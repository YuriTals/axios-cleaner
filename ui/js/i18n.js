// Idioma da interface. O texto em portugues e a chave (como no gettext):
// t("Limpar") devolve "Clean" em ingles. Sem traducao, fica o portugues.
// tests/ui/i18n.test.js confere se todo t("...") do codigo tem traducao.

import { EN, EN_PATTERNS } from "./lang/en.js";

let lang = "pt";

export const LANGS = [["pt", "Português"], ["en", "English"]];

export const getLang = () => lang;
export const english = () => lang === "en";
export const locale = () => (lang === "en" ? "en-US" : "pt-BR");

export function setLang(value) {
  lang = value === "en" ? "en" : "pt";
  if (globalThis.document?.documentElement) document.documentElement.lang = lang === "en" ? "en" : "pt-BR";
}

/** Idioma inicial quando o usuario ainda nao escolheu: o do Windows. */
export const systemLang = () => (String(globalThis.navigator?.language || "pt").toLowerCase().startsWith("pt") ? "pt" : "en");

/** Traduz `s` e troca {nome} pelos valores de `vars`. */
export function t(s, vars) {
  let out = lang === "en" ? EN[s] ?? s : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  return out;
}

/** Texto que veio pronto do backend (fases, erros): busca exata e depois padroes com numeros. */
export function tb(s) {
  if (lang !== "en" || s == null) return s ?? "";
  const text = String(s);
  if (EN[text]) return EN[text];
  for (const [re, en] of EN_PATTERNS) if (re.test(text)) return text.replace(re, en);
  return text;
}

/** Nome e descricao da categoria no idioma atual. */
export const catName = (c) => (lang === "en" && c.name_en) || c.name;
export const catDesc = (c) => (lang === "en" && c.desc_en) || c.desc;
