//! Programas que iniciam com o Windows.
//!
//! Liga/desliga pelo mesmo mecanismo do Gerenciador de Tarefas (chaves
//! `StartupApproved`): nada e apagado, entao sempre da para religar.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_BINARY};
use winreg::{RegKey, RegValue};

const APPROVED: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved";

#[derive(Serialize)]
pub struct StartupItem {
    /// Identificador: "<origem>|<nome>".
    pub id: String,
    pub name: String,
    pub command: String,
    pub source: String,
    pub enabled: bool,
}

struct Source {
    key: &'static str,
    hive: isize,
    run: Option<&'static str>,
    folder_env: Option<(&'static str, &'static str)>,
    approved: &'static str,
    label: &'static str,
}

const SOURCES: &[Source] = &[
    Source { key: "hkcu-run", hive: 0, run: Some("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), folder_env: None, approved: "Run", label: "Usuário" },
    Source { key: "hklm-run", hive: 1, run: Some("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"), folder_env: None, approved: "Run", label: "Todos os usuários" },
    Source { key: "hklm-run32", hive: 1, run: Some("SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run"), folder_env: None, approved: "Run32", label: "Todos os usuários (32 bits)" },
    Source { key: "user-folder", hive: 0, run: None, folder_env: Some(("APPDATA", "Microsoft\\Windows\\Start Menu\\Programs\\Startup")), approved: "StartupFolder", label: "Pasta Inicializar" },
    Source { key: "common-folder", hive: 1, run: None, folder_env: Some(("ProgramData", "Microsoft\\Windows\\Start Menu\\Programs\\Startup")), approved: "StartupFolder", label: "Pasta Inicializar (todos)" },
];

fn hive(h: isize) -> RegKey {
    RegKey::predef(if h == 0 { HKEY_CURRENT_USER } else { HKEY_LOCAL_MACHINE })
}

fn is_enabled(src: &Source, name: &str) -> bool {
    hive(src.hive)
        .open_subkey_with_flags(format!("{APPROVED}\\{}", src.approved), KEY_READ)
        .and_then(|k| k.get_raw_value(name))
        .map(|v| v.bytes.first().map(|b| b % 2 == 0).unwrap_or(true))
        .unwrap_or(true)
}

pub fn list() -> Vec<StartupItem> {
    let mut out = Vec::new();
    for src in SOURCES {
        if let Some(run) = src.run {
            if let Ok(k) = hive(src.hive).open_subkey_with_flags(run, KEY_READ) {
                for (name, value) in k.enum_values().flatten() {
                    if name.is_empty() {
                        continue;
                    }
                    let command = value.to_string().trim_matches('"').to_string();
                    out.push(StartupItem {
                        id: format!("{}|{name}", src.key),
                        enabled: is_enabled(src, &name),
                        name,
                        command,
                        source: src.label.into(),
                    });
                }
            }
        }
        if let Some((env, sub)) = src.folder_env {
            let Ok(base) = std::env::var(env) else { continue };
            let dir = std::path::Path::new(&base).join(sub);
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let file = e.file_name().to_string_lossy().into_owned();
                if file.eq_ignore_ascii_case("desktop.ini") {
                    continue;
                }
                let name = file.trim_end_matches(".lnk").to_string();
                out.push(StartupItem {
                    id: format!("{}|{file}", src.key),
                    enabled: is_enabled(src, &file),
                    name,
                    command: e.path().to_string_lossy().into_owned(),
                    source: src.label.into(),
                });
            }
        }
    }
    out.sort_by_key(|i| i.name.to_lowercase());
    out
}

pub fn set_enabled(id: &str, enabled: bool) -> Result<(), String> {
    // So mexe em itens que existem de verdade na lista atual.
    if !list().iter().any(|item| item.id == id) {
        return Err("item de inicialização desconhecido".into());
    }
    let (key, name) = id.split_once('|').ok_or("id inválido")?;
    let src = SOURCES.iter().find(|s| s.key == key).ok_or("origem desconhecida")?;
    let (k, _) = hive(src.hive)
        .create_subkey_with_flags(format!("{APPROVED}\\{}", src.approved), KEY_SET_VALUE)
        .map_err(|e| e.to_string())?;
    // 12 bytes: estado (02 = ligado, 03 = desligado) + 3 zeros + FILETIME.
    let mut bytes = vec![if enabled { 2u8 } else { 3u8 }, 0, 0, 0];
    let filetime = if enabled {
        0u64
    } else {
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        (secs + 11_644_473_600) * 10_000_000
    };
    bytes.extend_from_slice(&filetime.to_le_bytes());
    k.set_raw_value(name, &RegValue { bytes, vtype: REG_BINARY }).map_err(|e| e.to_string())
}
