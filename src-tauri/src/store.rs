//! Configuracao, historico e logs em %APPDATA%\Axios Cleaner.
//! Ficam no disco (e nao no navegador) para a limpeza agendada tambem ler.

use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub fn dir() -> PathBuf {
    let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    let d = base.join("Axios Cleaner");
    let _ = fs::create_dir_all(&d);
    d
}

/// Le um JSON salvo; arquivos editados a mao podem vir com BOM do UTF-8.
fn read_json(name: &str, fallback: Value) -> Value {
    fs::read_to_string(dir().join(name))
        .ok()
        .and_then(|s| serde_json::from_str(s.trim_start_matches('﻿')).ok())
        .unwrap_or(fallback)
}

fn write_json(name: &str, v: &Value) -> Result<(), String> {
    let tmp = dir().join(format!("{name}.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir().join(name)).map_err(|e| e.to_string())
}

pub fn load_config() -> Value {
    read_json("config.json", json!({}))
}

pub fn save_config(v: &Value) -> Result<(), String> {
    write_json("config.json", v)
}

/// Interface em ingles? Vale para o que o backend escreve sozinho (bandeja, avisos, logs).
pub fn english() -> bool {
    load_config()["settings"]["lang"].as_str() == Some("en")
}

pub fn load_history() -> Value {
    read_json("history.json", json!([]))
}

pub fn push_history(entry: Value) {
    let mut h = load_history();
    if let Some(arr) = h.as_array_mut() {
        arr.push(entry);
        let excess = arr.len().saturating_sub(300);
        arr.drain(0..excess);
    }
    let _ = write_json("history.json", &h);
}

pub fn clear_history() {
    let _ = write_json("history.json", &json!([]));
}

pub fn logs_dir() -> PathBuf {
    let logs = dir().join("logs");
    let _ = fs::create_dir_all(&logs);
    logs
}

/// Grava um log (`kind`: "limpeza" ou "simulacao") e devolve o caminho.
pub fn write_log(kind: &str, stamp: &str, lines: &[String]) -> Option<String> {
    let path = logs_dir().join(format!("{kind}_{stamp}.txt"));
    let mut f = fs::File::create(&path).ok()?;
    // BOM para o Bloco de Notas reconhecer UTF-8 com acentos.
    f.write_all(b"\xEF\xBB\xBF").ok()?;
    for l in lines {
        writeln!(f, "{l}").ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}
