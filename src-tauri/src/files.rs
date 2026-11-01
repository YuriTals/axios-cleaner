//! Arquivos grandes, duplicados, envio para a Lixeira e mapa de espaco.

use crate::engine::is_reparse;
use serde::Serialize;
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs;
use std::hash::{BuildHasher, Hasher};
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

/// Pastas de sistema, de programas e de jogos: nunca entram nas buscas de
/// arquivos grandes e duplicados (mandar uma DLL "duplicada" para a Lixeira
/// quebraria o Windows ou um jogo).
const SKIPPED_DIRS: [&str; 9] = [
    "AppData", "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "$Recycle.Bin", "System Volume Information", "steamapps", "WindowsApps",
];

/// Uma raiz de busca de duplicados nao pode ficar dentro de pastas do sistema.
pub fn allowed_search_root(root: &str) -> bool {
    let p = Path::new(root);
    let n = crate::engine::normalize_path(root);
    let inside = |var: &str, fallback: &str| {
        let base = crate::engine::normalize_path(&std::env::var(var).unwrap_or_else(|_| fallback.into()));
        n == base || n.starts_with(&format!("{base}\\"))
    };
    p.is_absolute()
        && p.is_dir()
        && !inside("SystemRoot", "C:\\Windows")
        && !inside("ProgramFiles", "C:\\Program Files")
        && !inside("ProgramFiles(x86)", "C:\\Program Files (x86)")
        && !inside("ProgramData", "C:\\ProgramData")
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
            if name.starts_with('.') || SKIPPED_DIRS.iter().any(|s| name.eq_ignore_ascii_case(s)) {
                continue;
            }
            walk_big(&e.path(), home, min, stop, out);
        } else if md.len() >= min {
            let path = e.path();
            // Relativo a pasta do usuario; fora dela, o caminho completo.
            let folder = path.parent().map(|p| p.strip_prefix(home).unwrap_or(p).to_string_lossy().into_owned()).unwrap_or_default();
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
// Arquivos duplicados
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct DupGroup {
    /// Tamanho de cada copia.
    pub bytes: u64,
    /// Copias identicas, da mais antiga para a mais nova.
    pub files: Vec<BigFile>,
}

/// Quantos grupos a tela mostra (os que mais liberam espaco).
const DUP_GROUPS_MAX: usize = 500;
/// Bytes lidos do comeco de cada arquivo na primeira comparacao.
const DUP_HEAD: usize = 64 * 1024;

/// Hash de 128 bits (dois SipHash com chaves diferentes) do comeco ou do arquivo todo.
fn content_hash(path: &Path, keys: &(RandomState, RandomState), head_only: bool, stop: &AtomicBool) -> Option<(u64, u64)> {
    use std::io::Read;
    let mut f = fs::File::open(path).ok()?;
    let (mut a, mut b) = (keys.0.build_hasher(), keys.1.build_hasher());
    let mut buf = vec![0u8; DUP_HEAD];
    loop {
        if stop.load(Ordering::Relaxed) {
            return None;
        }
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        a.write(&buf[..n]);
        b.write(&buf[..n]);
        if head_only {
            break;
        }
    }
    Some((a.finish(), b.finish()))
}

/// Separa os candidatos pelo hash e mantem so os grupos com 2 ou mais arquivos.
fn split_by_hash(
    groups: Vec<Vec<BigFile>>,
    keys: &(RandomState, RandomState),
    head_only: bool,
    stop: &AtomicBool,
    progress: &mut dyn FnMut(usize, usize, &str),
) -> Vec<Vec<BigFile>> {
    let total = groups.iter().map(Vec::len).sum();
    let mut done = 0;
    let mut out = Vec::new();
    for group in groups {
        let mut by_hash: HashMap<(u64, u64), Vec<BigFile>> = HashMap::new();
        for f in group {
            done += 1;
            progress(done, total, &f.name);
            if let Some(h) = content_hash(Path::new(&f.path), keys, head_only, stop) {
                by_hash.entry(h).or_default().push(f);
            }
        }
        out.extend(by_hash.into_values().filter(|g| g.len() > 1));
    }
    out
}

/// Procura arquivos identicos >= `min_bytes` em `root` (ignorando AppData,
/// pastas ocultas e atalhos de pasta). `progress(fase, feito, total, atual)`.
pub fn duplicates(root: &str, min_bytes: u64, stop: &AtomicBool, progress: &dyn Fn(&str, usize, usize, &str)) -> Vec<DupGroup> {
    if !allowed_search_root(root) {
        return vec![];
    }
    let home = PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default());
    let mut all = Vec::new();
    walk_big(Path::new(root), &home, min_bytes.max(1), stop, &mut all);
    progress("Listando", all.len(), all.len(), "");

    let mut by_size: HashMap<u64, Vec<BigFile>> = HashMap::new();
    for f in all {
        by_size.entry(f.bytes).or_default().push(f);
    }
    let candidates: Vec<Vec<BigFile>> = by_size.into_values().filter(|g| g.len() > 1).collect();

    let keys = (RandomState::new(), RandomState::new());
    let mut last = Instant::now();
    let mut report = |phase: &str, done: usize, total: usize, name: &str| {
        if last.elapsed().as_millis() > 150 || done == total {
            last = Instant::now();
            progress(phase, done, total, name);
        }
    };
    let same_head = split_by_hash(candidates, &keys, true, stop, &mut |d, t, n| report("Comparando o começo", d, t, n));
    let same = split_by_hash(same_head, &keys, false, stop, &mut |d, t, n| report("Comparando o conteúdo", d, t, n));

    let mut groups: Vec<DupGroup> = same
        .into_iter()
        .map(|mut files| {
            files.sort_by_key(|f| f.modified);
            DupGroup { bytes: files[0].bytes, files }
        })
        .collect();
    groups.sort_by_key(|g| std::cmp::Reverse(g.bytes * (g.files.len() as u64 - 1)));
    groups.truncate(DUP_GROUPS_MAX);
    groups
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_identical_files() {
        let root = std::env::temp_dir().join(format!("axios_test_dups_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("a")).unwrap();
        fs::create_dir_all(root.join("b")).unwrap();
        fs::create_dir_all(root.join("Windows")).unwrap();
        let same = vec![7u8; 100_000]; // maior que o trecho inicial comparado
        let mut differs_at_end = same.clone();
        *differs_at_end.last_mut().unwrap() = 8;
        fs::write(root.join("a/foto.jpg"), &same).unwrap();
        fs::write(root.join("b/foto (1).jpg"), &same).unwrap();
        fs::write(root.join("b/parecida.jpg"), &differs_at_end).unwrap(); // mesmo tamanho e mesmo comeco
        fs::write(root.join("Windows/sistema.dll"), &same).unwrap(); // pasta de sistema e pulada
        fs::write(root.join("a/pequeno.txt"), b"x").unwrap();

        let stop = AtomicBool::new(false);
        let groups = duplicates(&root.to_string_lossy(), 1000, &stop, &|_, _, _, _| {});
        assert_eq!(groups.len(), 1);
        let mut names: Vec<_> = groups[0].files.iter().map(|f| f.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["foto (1).jpg", "foto.jpg"]);
        assert_eq!(groups[0].bytes, 100_000);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn system_folders_are_not_search_roots() {
        let win = std::env::var("SystemRoot").unwrap();
        assert!(!allowed_search_root(&win));
        assert!(!allowed_search_root(&format!("{win}\\System32")));
        assert!(!allowed_search_root("relativa"));
        assert!(allowed_search_root(&std::env::var("USERPROFILE").unwrap()));
    }
}

#[cfg(test)]
mod real_tests {
    /// So leitura, na pasta do usuario de verdade: `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn duplicates_in_user_folder() {
        let home = std::env::var("USERPROFILE").unwrap();
        let stop = std::sync::atomic::AtomicBool::new(false);
        let t = std::time::Instant::now();
        let groups = super::duplicates(&home, 10 * 1024 * 1024, &stop, &|_, _, _, _| {});
        let wasted: u64 = groups.iter().map(|g| g.bytes * (g.files.len() as u64 - 1)).sum();
        println!("{} grupos, {:.1} MB em copias, {:.1} s", groups.len(), wasted as f64 / 1048576.0, t.elapsed().as_secs_f64());
        for g in groups.iter().take(3) {
            println!("  {} copias de {:.1} MB: {}", g.files.len(), g.bytes as f64 / 1048576.0, g.files[0].name);
        }
    }
}
