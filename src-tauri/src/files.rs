//! Arquivos grandes, envio para a Lixeira e mapa de espaco.

use crate::engine::is_reparse;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, UNIX_EPOCH};

// ---------------------------------------------------------------------------
// Arquivos grandes
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct BigFile {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub bytes: u64,
    /// Ultima modificacao, em segundos desde 1970.
    pub modified: u64,
}

/// Procura arquivos >= `min_bytes` na pasta do usuario, ignorando AppData,
/// pastas ocultas (.cargo, .gradle...) e atalhos de pasta.
pub fn large_files(min_bytes: u64, stop: &AtomicBool) -> Vec<BigFile> {
    let Ok(home) = std::env::var("USERPROFILE") else { return vec![] };
    let home = PathBuf::from(home);
    let mut out = Vec::new();
    walk_big(&home, &home, min_bytes, stop, &mut out);
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out.truncate(300);
    out
}

fn walk_big(dir: &Path, home: &Path, min: u64, stop: &AtomicBool, out: &mut Vec<BigFile>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let Ok(md) = e.metadata() else { continue };
        if is_reparse(&md) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if md.is_dir() {
            if name.starts_with('.') || (dir == home && name.eq_ignore_ascii_case("AppData")) {
                continue;
            }
            walk_big(&e.path(), home, min, stop, out);
        } else if md.len() >= min {
            let path = e.path();
            let folder = path
                .parent()
                .and_then(|p| p.strip_prefix(home).ok())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let modified = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.push(BigFile { path: path.to_string_lossy().into_owned(), name, folder, bytes: md.len(), modified });
        }
    }
}

fn recycle_one(path: &str) -> bool {
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, SHFILEOPSTRUCTW};
    const FO_DELETE: u32 = 3;
    const FLAGS: u16 = 0x40 | 0x10 | 0x4 | 0x400; // ALLOWUNDO | NOCONFIRMATION | SILENT | NOERRORUI

    // Caminho terminado em dois nulos, como a API exige.
    let list: Vec<u16> = path.encode_utf16().chain([0, 0]).collect();
    let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    op.wFunc = FO_DELETE;
    op.pFrom = list.as_ptr();
    op.fFlags = FLAGS;
    unsafe { SHFileOperationW(&mut op) };
    !Path::new(path).exists()
}

/// Envia arquivos para a Lixeira (pode desfazer). Devolve (enviados, bytes).
pub fn recycle(paths: &[String], stop: &AtomicBool, progress: &dyn Fn(usize, usize)) -> (u64, u64) {
    let (mut n, mut bytes) = (0u64, 0u64);
    for (i, p) in paths.iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let size = fs::metadata(p).ok().filter(|m| m.is_file()).map(|m| m.len());
        if let Some(size) = size {
            if recycle_one(p) {
                n += 1;
                bytes += size;
            }
        }
        progress(i + 1, paths.len());
    }
    (n, bytes)
}

// ---------------------------------------------------------------------------
// Mapa de espaco
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct MapItem {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub dir: bool,
}

#[derive(Serialize)]
pub struct MapResult {
    pub path: String,
    pub total: u64,
    pub items: Vec<MapItem>,
    pub partial: bool,
}

fn dir_size(dir: &Path, stop: &AtomicBool, tick: &mut dyn FnMut(u64)) -> u64 {
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    let mut total = 0;
    for e in rd.flatten() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let Ok(md) = e.metadata() else { continue };
        if is_reparse(&md) {
            continue;
        }
        if md.is_dir() {
            total += dir_size(&e.path(), stop, tick);
        } else {
            total += md.len();
            tick(md.len());
        }
    }
    total
}

/// Tamanho de cada item dentro de `path`. `progress(feito, total, atual, bytes)`.
pub fn map_folder(path: &str, stop: &AtomicBool, progress: &dyn Fn(usize, usize, &str, u64)) -> MapResult {
    let root = PathBuf::from(path);
    let entries: Vec<_> = fs::read_dir(&root).map(|rd| rd.flatten().collect()).unwrap_or_default();
    let n = entries.len();
    let mut items = Vec::new();
    let mut seen_bytes = 0u64;
    let mut last = Instant::now();
    for (i, e) in entries.iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let Ok(md) = e.metadata() else { continue };
        if is_reparse(&md) {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        progress(i, n, &name, seen_bytes);
        let bytes = if md.is_dir() {
            dir_size(&e.path(), stop, &mut |b| {
                seen_bytes += b;
                if last.elapsed().as_millis() > 200 {
                    last = Instant::now();
                    progress(i, n, &name, seen_bytes);
                }
            })
        } else {
            seen_bytes += md.len();
            md.len()
        };
        items.push(MapItem { name, path: e.path().to_string_lossy().into_owned(), bytes, dir: md.is_dir() });
    }
    items.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    MapResult {
        path: root.to_string_lossy().into_owned(),
        total: items.iter().map(|i| i.bytes).sum(),
        items,
        partial: stop.load(Ordering::Relaxed),
    }
}
