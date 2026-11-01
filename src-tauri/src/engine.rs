//! Motor de varredura e limpeza.
//!
//! Regras de seguranca:
//!   - so apaga arquivos que casam com as mascaras de `rules.rs`;
//!   - nunca segue junctions/symlinks (reparse points) dentro das pastas;
//!   - pastas so sao removidas quando ficam vazias e nunca a pasta raiz da regra;
//!   - arquivos em uso sao simplesmente pulados (como o `del` faz).

use crate::rules::{self, Category, Kind, Rule};
use serde::Serialize;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

pub fn all() -> &'static [Category] {
    static CATS: OnceLock<Vec<Category>> = OnceLock::new();
    CATS.get_or_init(rules::categories)
}

pub fn find(id: &str) -> Option<&'static Category> {
    all().iter().find(|c| c.id == id)
}

// ---------------------------------------------------------------------------
// Mascaras no estilo do `del` do cmd
// ---------------------------------------------------------------------------

pub fn wildcard(p: &[u8], s: &[u8]) -> bool {
    let (mut pi, mut si) = (0, 0);
    let (mut star, mut mark) = (usize::MAX, 0);
    while si < s.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = pi;
            mark = si;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            si = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

/// `*` / `*.*` = tudo; `data*.` = sem extensao; `data.*` tambem casa `data`.
pub fn matches(pattern: &str, name: &str) -> bool {
    let p = pattern.to_lowercase();
    let n = name.to_lowercase();
    if p == "*" || p == "*.*" {
        return true;
    }
    if let Some(stem) = p.strip_suffix(".*") {
        if !n.contains('.') && wildcard(stem.as_bytes(), n.as_bytes()) {
            return true;
        }
    }
    if let Some(stem) = p.strip_suffix('.') {
        return !n.contains('.') && wildcard(stem.as_bytes(), n.as_bytes());
    }
    wildcard(p.as_bytes(), n.as_bytes())
}

// ---------------------------------------------------------------------------
// Expansao de caminhos
// ---------------------------------------------------------------------------

pub fn is_reparse(md: &fs::Metadata) -> bool {
    md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn env(name: &str, fallback: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| fallback.to_string())
}

/// Equivalente ao `for /d %%F in (C:\Users\*)`, ignorando junctions
/// como "All Users" e "Default User".
pub fn user_dirs() -> Vec<PathBuf> {
    let root = PathBuf::from(format!("{}\\Users", env("SystemDrive", "C:")));
    let Ok(rd) = fs::read_dir(root) else { return vec![] };
    rd.flatten()
        .filter(|e| e.metadata().map(|m| m.is_dir() && !is_reparse(&m)).unwrap_or(false))
        .map(|e| e.path())
        .collect()
}

fn is_browser_profile(name: &str) -> bool {
    name == "Default" || name == "Guest Profile" || name.starts_with("Profile ")
}

/// Expande trechos com `*` e o token `{profile}`, um nivel por vez.
fn expand_glob(path: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = path.split('\\').filter(|s| !s.is_empty()).collect();
    let mut current: Vec<PathBuf> = vec![PathBuf::new()];
    for (i, part) in parts.iter().enumerate() {
        let is_glob = part.contains('*') || *part == "{profile}";
        let mut next = Vec::new();
        for base in &current {
            if i == 0 {
                next.push(PathBuf::from(format!("{part}\\")));
            } else if !is_glob {
                next.push(base.join(part));
            } else if let Ok(rd) = fs::read_dir(base) {
                let pat = part.to_lowercase();
                for e in rd.flatten() {
                    let Ok(md) = e.metadata() else { continue };
                    if !md.is_dir() || is_reparse(&md) {
                        continue;
                    }
                    let name = e.file_name().to_string_lossy().into_owned();
                    let ok = if *part == "{profile}" {
                        is_browser_profile(&name)
                    } else {
                        wildcard(pat.as_bytes(), name.to_lowercase().as_bytes())
                    };
                    if ok {
                        next.push(e.path());
                    }
                }
            }
        }
        current = next;
    }
    current
}

/// Caminho real (resolvendo junctions/symlinks), sem o prefixo \\?\ e em minusculas.
fn real_path(p: &Path) -> Option<String> {
    let real = fs::canonicalize(p).ok()?;
    Some(real.to_string_lossy().trim_start_matches(r"\\?\").trim_end_matches('\\').to_lowercase())
}

/// Seguranca: uma pasta-alvo so vale se nenhum trecho do caminho for junction
/// ou symlink. Sem isso, um usuario comum poderia trocar a propria pasta Temp
/// por um atalho para C:\Windows e o app (como admin) apagaria arquivos la.
fn is_direct_path(p: &Path) -> bool {
    let requested = p.to_string_lossy().trim_end_matches('\\').to_lowercase();
    real_path(p).is_some_and(|real| real == requested)
}

/// Confere, logo antes de apagar, se o arquivo ainda esta dentro da pasta-alvo
/// (protege contra uma subpasta trocada por junction durante a limpeza).
struct Containment {
    base_real: String,
    last_parent: Option<(PathBuf, bool)>,
}

impl Containment {
    fn new(base: &Path) -> Option<Self> {
        Some(Containment { base_real: real_path(base)?, last_parent: None })
    }

    fn allows(&mut self, file: &Path) -> bool {
        let Some(parent) = file.parent() else { return false };
        if let Some((cached, ok)) = &self.last_parent {
            if cached == parent {
                return *ok;
            }
        }
        let ok = real_path(parent).is_some_and(|real| real == self.base_real || real.starts_with(&format!("{}\\", self.base_real)));
        self.last_parent = Some((parent.to_path_buf(), ok));
        ok
    }
}

pub fn expand(base: &str, users: &[PathBuf]) -> Vec<PathBuf> {
    let b = base
        .replace("{windir}", &env("SystemRoot", "C:\\Windows"))
        .replace("{programfilesx86}", &env("ProgramFiles(x86)", "C:\\Program Files (x86)"))
        .replace("{programfiles}", &env("ProgramFiles", "C:\\Program Files"))
        .replace("{programdata}", &env("ProgramData", "C:\\ProgramData"));
    let paths: Vec<String> = if b.contains("{user}") {
        users.iter().map(|u| b.replace("{user}", &u.to_string_lossy())).collect()
    } else {
        vec![b]
    };
    let mut out: Vec<PathBuf> = paths.iter().flat_map(|p| expand_glob(p)).filter(|p| p.is_dir() && is_direct_path(p)).collect();
    out.sort();
    out.dedup();
    out
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

fn walk(dir: &Path, recursive: bool, stop: &AtomicBool, f: &mut dyn FnMut(PathBuf, &fs::Metadata)) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let Ok(md) = entry.metadata() else { continue };
        if is_reparse(&md) {
            continue;
        }
        if md.is_dir() {
            if recursive {
                walk(&entry.path(), true, stop, f);
            }
        } else {
            f(entry.path(), &md);
        }
    }
}

// ---------------------------------------------------------------------------
// Politica: o que o usuario pediu para nunca apagar
// ---------------------------------------------------------------------------

/// Idade minima dos arquivos das pastas Temp quando "proteger recentes" esta ligado.
pub const RECENT_TEMP_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Filtros aplicados na varredura e na limpeza, lidos da configuracao.
#[derive(Default)]
pub struct Policy {
    /// Arquivos das pastas Temp mais novos que isso ficam.
    pub min_temp_age: Option<Duration>,
    /// Pastas e arquivos que nunca sao apagados (minusculas, sem `\` no fim).
    pub exclude: Vec<String>,
    /// Pastas extras para limpar, ja validadas por `check_custom_folder`.
    pub custom: Vec<String>,
}

pub fn normalize_path(p: &str) -> String {
    p.trim().trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase()
}

impl Policy {
    pub fn from_config(cfg: &serde_json::Value) -> Self {
        let protect = cfg["settings"]["protectRecent"].as_bool().unwrap_or(true);
        let exclude = cfg["exclude"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).map(normalize_path).filter(|p| !p.is_empty()).collect())
            .unwrap_or_default();
        let custom = cfg["custom"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).filter_map(|p| check_custom_folder(p).ok()).collect())
            .unwrap_or_default();
        Policy { min_temp_age: protect.then_some(RECENT_TEMP_AGE), exclude, custom }
    }

    pub fn load() -> Self {
        Self::from_config(&crate::store::load_config())
    }

    pub fn is_excluded(&self, path: &Path) -> bool {
        if self.exclude.is_empty() {
            return false;
        }
        let p = path.to_string_lossy().to_lowercase();
        self.exclude.iter().any(|ex| p == *ex || (p.starts_with(ex.as_str()) && p.as_bytes().get(ex.len()) == Some(&b'\\')))
    }

    /// O arquivo fica de fora desta categoria?
    fn keeps(&self, cat: &Category, path: &Path, md: &fs::Metadata) -> bool {
        if let Some(min) = self.min_temp_age.filter(|_| cat.holds_temp_files()) {
            if is_newer_than(md, min) {
                return true;
            }
        }
        self.is_excluded(path)
    }
}

/// Regras de uma categoria; as das "Pastas extras" vem da configuracao.
fn rules_for<'a>(cat: &'a Category, policy: &Policy) -> Cow<'a, [Rule]> {
    match cat.kind {
        Kind::Custom => Cow::Owned(policy.custom.iter().map(|p| Rule { base: intern(p), pattern: "*", recursive: true, prune: true }).collect()),
        _ => Cow::Borrowed(&cat.rules),
    }
}

/// `Rule` guarda `&'static str`: cada pasta extra e alocada uma vez so.
fn intern(s: &str) -> &'static str {
    static SEEN: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    let mut seen = SEEN.get_or_init(Default::default).lock().unwrap();
    if let Some(found) = seen.get(s) {
        return found;
    }
    let leaked: &'static str = Box::leak(s.to_string().into_boxed_str());
    seen.insert(leaked);
    leaked
}

/// Pastas pessoais e do sistema: nem elas nem uma pasta acima delas viram "pasta extra".
fn protected_folders() -> Vec<String> {
    const PERSONAL: [&str; 12] = [
        "", "Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive",
        "AppData", "AppData\\Local", "AppData\\Roaming", "AppData\\LocalLow",
    ];
    let mut list = vec![env("ProgramData", "C:\\ProgramData"), format!("{}\\Users", env("SystemDrive", "C:"))];
    for user in user_dirs() {
        list.extend(PERSONAL.iter().map(|sub| user.join(sub).to_string_lossy().into_owned()));
    }
    list.iter().map(|p| normalize_path(p)).collect()
}

/// Valida uma pasta extra. O app roda como admin, entao so aceita pastas
/// especificas: nada do Windows, de programas, raiz de disco ou pastas pessoais.
pub fn check_custom_folder(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_end_matches(['\\', '/']);
    let p = PathBuf::from(trimmed);
    if !p.is_absolute() {
        return Err("Use o caminho completo da pasta, como D:\\Downloads\\temp.".into());
    }
    if !p.is_dir() {
        return Err("Pasta não encontrada.".into());
    }
    if !is_direct_path(&p) {
        return Err("Atalhos de pasta (junctions e links) não são aceitos.".into());
    }
    let n = normalize_path(trimmed);
    let inside = |root: &str| n == root || n.starts_with(&format!("{root}\\"));
    let system = [env("SystemRoot", "C:\\Windows"), env("ProgramFiles", "C:\\Program Files"), env("ProgramFiles(x86)", "C:\\Program Files (x86)")];
    if system.iter().any(|t| inside(&normalize_path(t))) {
        return Err("Pastas do Windows e de programas são protegidas.".into());
    }
    let above = |q: &String| *q == n || q.starts_with(&format!("{n}\\"));
    if p.parent().is_none() || protected_folders().iter().any(above) {
        return Err("Essa pasta guarda arquivos pessoais ou do sistema. Escolha uma subpasta mais específica.".into());
    }
    Ok(trimmed.to_string())
}

/// Criado ou alterado ha menos de `age` (datas ilegiveis contam como antigas).
fn is_newer_than(md: &fs::Metadata, age: Duration) -> bool {
    let newest = [md.modified().ok(), md.created().ok()].into_iter().flatten().max();
    newest.and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|elapsed| elapsed < age)
}

/// Chama `f(base, arquivo, tamanho)` para cada arquivo que a regra cobre e a politica permite.
fn for_each_match(
    cat: &Category,
    rule: &Rule,
    users: &[PathBuf],
    policy: &Policy,
    stop: &AtomicBool,
    f: &mut dyn FnMut(&Path, PathBuf, &fs::Metadata),
) {
    for base in expand(rule.base, users) {
        walk(&base, rule.recursive, stop, &mut |path, md| {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if matches(rule.pattern, &name) && !policy.keeps(cat, &path, md) {
                f(&base, path, md);
            }
        });
    }
}

static NEVER: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
pub struct ScanItem {
    pub id: String,
    pub bytes: u64,
    pub files: u64,
    pub running: Vec<String>,
}

pub fn recycle_bin_info() -> (u64, u64) {
    use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut info: SHQUERYRBINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
    let hr = unsafe { SHQueryRecycleBinW(std::ptr::null(), &mut info) };
    if hr == 0 {
        (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64)
    } else {
        (0, 0)
    }
}

/// Varre todas as categorias. Um arquivo coberto por mais de uma categoria
/// e contado so na primeira, para o total nao ficar inflado.
pub fn scan(policy: &Policy, running: &dyn Fn(&[&str]) -> Vec<String>, mut on_item: impl FnMut(&ScanItem)) -> Vec<ScanItem> {
    let users = user_dirs();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out = Vec::new();
    for cat in all() {
        let (mut bytes, mut files) = (0u64, 0u64);
        match cat.kind {
            Kind::RecycleBin => (bytes, files) = recycle_bin_info(),
            Kind::Files | Kind::Custom => {
                for rule in rules_for(cat, policy).iter() {
                    for_each_match(cat, rule, &users, policy, &NEVER, &mut |_, path, md| {
                        if seen.insert(path) {
                            bytes += md.len();
                            files += 1;
                        }
                    });
                }
            }
        }
        let item = ScanItem { id: cat.id.into(), bytes, files, running: running(cat.processes) };
        on_item(&item);
        out.push(item);
    }
    out
}

// ---------------------------------------------------------------------------
// Detalhes de uma categoria
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Location {
    pub path: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize)]
pub struct BigFile {
    pub path: String,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct Details {
    pub locations: Vec<Location>,
    pub largest: Vec<BigFile>,
}

/// Quantos "maiores arquivos" os detalhes mostram.
const LARGEST_SHOWN: usize = 15;
/// A lista parcial e podada quando passa deste tamanho (evita guardar milhares).
const LARGEST_BUFFER: usize = 400;

pub fn details(cat: &Category, policy: &Policy) -> Details {
    let users = user_dirs();
    let mut locs: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    let mut largest: Vec<BigFile> = Vec::new();
    for rule in rules_for(cat, policy).iter() {
        for_each_match(cat, rule, &users, policy, &NEVER, &mut |base, path, md| {
            let e = locs.entry(base.to_path_buf()).or_default();
            e.0 += md.len();
            e.1 += 1;
            largest.push(BigFile { path: path.to_string_lossy().into_owned(), bytes: md.len() });
            if largest.len() > LARGEST_BUFFER {
                largest.sort_by(|a, b| b.bytes.cmp(&a.bytes));
                largest.truncate(LARGEST_SHOWN);
            }
        });
    }
    largest.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    largest.dedup_by(|a, b| a.path == b.path);
    largest.truncate(LARGEST_SHOWN);
    let mut locations: Vec<Location> = locs
        .into_iter()
        .map(|(p, (bytes, files))| Location { path: p.to_string_lossy().into_owned(), bytes, files })
        .collect();
    locations.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    Details { locations, largest }
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Default)]
pub struct CleanItem {
    pub id: String,
    pub freed: u64,
    pub files: u64,
    pub skipped: u64,
    /// Arquivos que nao puderam ser apagados (para o log; limitado).
    #[serde(skip)]
    pub skipped_paths: Vec<String>,
}

fn delete_file(path: &Path) -> bool {
    match fs::remove_file(path) {
        Ok(()) => true,
        Err(_) => {
            // Arquivo somente leitura: tira o atributo e tenta de novo.
            if let Ok(md) = fs::metadata(path) {
                let mut perm = md.permissions();
                if perm.readonly() {
                    #[allow(clippy::permissions_set_readonly_false)]
                    perm.set_readonly(false);
                    if fs::set_permissions(path, perm).is_ok() {
                        return fs::remove_file(path).is_ok();
                    }
                }
            }
            false
        }
    }
}

/// Remove subpastas vazias (de baixo para cima), mantendo `dir` e as pastas excluidas.
fn prune_empty(dir: &Path, policy: &Policy) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let Ok(md) = entry.metadata() else { continue };
        if md.is_dir() && !is_reparse(&md) {
            let p = entry.path();
            if policy.is_excluded(&p) {
                continue;
            }
            prune_empty(&p, policy);
            let _ = fs::remove_dir(&p); // so funciona se estiver vazia
        }
    }
}

pub fn empty_recycle_bin() -> bool {
    use windows_sys::Win32::UI::Shell::SHEmptyRecycleBinW;
    const FLAGS: u32 = 0x1 | 0x2 | 0x4; // SHERB_NOCONFIRMATION | NOPROGRESSUI | NOSOUND
    unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), FLAGS) == 0 }
}

/// O que a limpeza de uma categoria apagaria: arquivos e tamanho, sem tocar em nada.
/// `seen` evita contar duas vezes um arquivo coberto por mais de uma categoria.
pub fn simulate_category(cat: &Category, policy: &Policy, seen: &mut HashSet<PathBuf>, stop: &AtomicBool) -> Vec<BigFile> {
    let users = user_dirs();
    let mut out = Vec::new();
    for rule in rules_for(cat, policy).iter() {
        for_each_match(cat, rule, &users, policy, stop, &mut |_, path, md| {
            if seen.insert(path.clone()) {
                out.push(BigFile { path: path.to_string_lossy().into_owned(), bytes: md.len() });
            }
        });
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

/// Quantos arquivos pulados entram no log de cada categoria.
const MAX_SKIPPED_LOG: usize = 300;

/// Limpa uma categoria. `progress(processados, bytes)` e chamado no maximo
/// a cada 150 ms; `stop` interrompe no proximo arquivo.
pub fn clean_category(cat: &Category, policy: &Policy, stop: &AtomicBool, progress: &dyn Fn(u64, u64)) -> CleanItem {
    let mut res = CleanItem { id: cat.id.into(), ..Default::default() };
    match cat.kind {
        Kind::RecycleBin => {
            let (bytes, files) = recycle_bin_info();
            if files > 0 && empty_recycle_bin() {
                res.freed = bytes;
                res.files = files;
            }
        }
        Kind::Files | Kind::Custom => {
            let users = user_dirs();
            let mut last = Instant::now();
            let mut guards: HashMap<PathBuf, Option<Containment>> = HashMap::new();
            for rule in rules_for(cat, policy).iter() {
                for_each_match(cat, rule, &users, policy, stop, &mut |base, path, md| {
                    let guard = guards.entry(base.to_path_buf()).or_insert_with(|| Containment::new(base));
                    let allowed = guard.as_mut().is_some_and(|g| g.allows(&path));
                    if allowed && delete_file(&path) {
                        res.freed += md.len();
                        res.files += 1;
                    } else {
                        res.skipped += 1;
                        if res.skipped_paths.len() < MAX_SKIPPED_LOG {
                            res.skipped_paths.push(path.to_string_lossy().into_owned());
                        }
                    }
                    if last.elapsed().as_millis() >= 150 {
                        last = Instant::now();
                        progress(res.files + res.skipped, res.freed);
                    }
                });
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                if rule.prune {
                    for base in expand(rule.base, &users) {
                        prune_empty(&base, policy);
                    }
                }
            }
        }
    }
    progress(res.files + res.skipped, res.freed);
    res
}

#[cfg(test)]
mod tests {
    use super::matches;

    #[test]
    fn del_masks() {
        assert!(matches("*.log", "CBS.log"));
        assert!(!matches("*.log", "CBS.log.bak"));
        assert!(matches("data*.", "data_0"));
        assert!(!matches("data*.", "data_0.txt"));
        assert!(matches("f*.", "f_00012a"));
        assert!(matches("index.", "index"));
        assert!(!matches("index.", "index.txt"));
        assert!(matches("*.", "LOCK"));
        assert!(matches("*.*", "qualquer"));
        assert!(matches("data.*", "data"));
        assert!(matches("data.*", "data.1"));
        assert!(matches("*_0", "abc_0"));
        assert!(!matches("*_0", "abc_10x"));
        assert!(matches("History-journal*.", "History-journal"));
        assert!(matches("BrowserMetrics*.pma", "BrowserMetrics-6650A1B2-1234.pma"));
        assert!(matches("MpCmdRun.log", "mpcmdrun.LOG"));
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("axios_test_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("alvo/a/b")).unwrap();
        std::fs::create_dir_all(root.join("fora")).unwrap();
        std::fs::write(root.join("alvo/x.log"), b"12345").unwrap();
        std::fs::write(root.join("alvo/a/b/y.tmp"), b"123").unwrap();
        std::fs::write(root.join("fora/importante.txt"), b"nao apagar").unwrap();
        // junction dentro do alvo apontando para fora
        let link = root.join("alvo/atalho");
        let out = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J", &link.to_string_lossy().replace('/', "\\"), &root.join("fora").to_string_lossy().replace('/', "\\")])
            .output()
            .unwrap();
        assert!(out.status.success(), "mklink falhou");
        root
    }

    fn test_cat(base: &str) -> crate::rules::Category {
        let base: &'static str = Box::leak(base.to_string().into_boxed_str());
        crate::rules::Category {
            id: "teste", group: "t", name: "t", desc: "t", processes: &[], services: &[],
            kind: crate::rules::Kind::Files,
            rules: vec![crate::rules::Rule { base, pattern: "*", recursive: true, prune: true }],
            default_on: true,
        }
    }

    #[test]
    fn clean_is_safe() {
        use std::sync::atomic::AtomicBool;
        let root = fixture("safe");
        let cat = test_cat(&root.join("alvo").to_string_lossy());
        let stop = AtomicBool::new(false);
        let res = super::clean_category(&cat, &super::Policy::default(), &stop, &|_, _| {});
        assert_eq!(res.files, 2, "deveria apagar os 2 arquivos do alvo");
        assert_eq!(res.freed, 8);
        assert!(root.join("alvo").is_dir(), "a pasta raiz da regra deve ficar");
        assert!(!root.join("alvo/a").exists(), "subpastas vazias devem sumir");
        assert!(root.join("fora/importante.txt").exists(), "nao pode seguir a junction");
        assert!(root.join("alvo/atalho").exists(), "a junction em si nao e apagada");
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn junction_as_target_folder_is_ignored() {
        use std::sync::atomic::AtomicBool;
        let root = fixture("junction_base");
        // a propria pasta-alvo e uma junction apontando para "fora"
        let cat = test_cat(&root.join("alvo/atalho").to_string_lossy().replace('/', "\\"));
        let stop = AtomicBool::new(false);
        let res = super::clean_category(&cat, &super::Policy::default(), &stop, &|_, _| {});
        assert_eq!(res.files, 0, "nao pode apagar nada atraves de uma junction");
        assert!(root.join("fora/importante.txt").exists());
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn clean_respects_cancel() {
        use std::sync::atomic::AtomicBool;
        let root = fixture("cancel");
        let cat = test_cat(&root.join("alvo").to_string_lossy());
        let stop = AtomicBool::new(true);
        let res = super::clean_category(&cat, &super::Policy::default(), &stop, &|_, _| {});
        assert_eq!(res.files, 0, "cancelado antes de comecar nao apaga nada");
        assert!(root.join("alvo/x.log").exists());
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn recent_temp_files_are_kept() {
        use std::sync::atomic::AtomicBool;
        let root = fixture("recent");
        let mut cat = test_cat(&root.join("alvo").to_string_lossy());
        cat.id = "usertemp"; // so as pastas Temp protegem os recentes
        let policy = super::Policy { min_temp_age: Some(super::RECENT_TEMP_AGE), ..Default::default() };
        let stop = AtomicBool::new(false);
        let res = super::clean_category(&cat, &policy, &stop, &|_, _| {});
        assert_eq!(res.files, 0, "arquivos recem-criados ficam");
        assert!(root.join("alvo/x.log").exists());

        cat.id = "teste"; // fora das pastas Temp a idade nao importa
        let res = super::clean_category(&cat, &policy, &stop, &|_, _| {});
        assert_eq!(res.files, 2);
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn excluded_paths_are_kept() {
        use std::sync::atomic::AtomicBool;
        let root = fixture("exclude");
        let cat = test_cat(&root.join("alvo").to_string_lossy());
        let excluded = super::normalize_path(&root.join("alvo/a").to_string_lossy());
        let policy = super::Policy { exclude: vec![excluded], ..Default::default() };
        assert!(!policy.is_excluded(&root.join("alvo/ab")), "prefixo de nome nao e a mesma pasta");
        let stop = AtomicBool::new(false);
        let res = super::clean_category(&cat, &policy, &stop, &|_, _| {});
        assert_eq!(res.files, 1, "so o x.log, fora da pasta excluida");
        assert!(root.join("alvo/a/b/y.tmp").exists(), "arquivo dentro da pasta excluida fica");
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn custom_folders_must_be_specific() {
        let home = std::env::var("USERPROFILE").unwrap();
        let win = std::env::var("SystemRoot").unwrap();
        for bad in ["C:\\", "relativa\\pasta", &win, &format!("{win}\\Temp"), "C:\\Program Files\\Algo", "C:\\Users", &home, &format!("{home}\\Documents"), &format!("{home}\\AppData")] {
            assert!(super::check_custom_folder(bad).is_err(), "deveria recusar {bad}");
        }
        let root = fixture("custom");
        let ok = root.join("alvo").to_string_lossy().replace('/', "\\");
        assert_eq!(super::check_custom_folder(&format!("{ok}\\")), Ok(ok.clone()), "aceita subpasta comum e tira a barra do fim");
        assert!(super::check_custom_folder(&root.join("alvo/atalho").to_string_lossy().replace('/', "\\")).is_err(), "recusa junction");
        assert!(super::check_custom_folder(&root.join("nao-existe").to_string_lossy()).is_err());

        // a categoria "Pastas extras" limpa so o que a politica traz
        let custom = super::find("custom").unwrap();
        let policy = super::Policy { custom: vec![ok], ..Default::default() };
        let stop = std::sync::atomic::AtomicBool::new(false);
        let res = super::clean_category(custom, &policy, &stop, &|_, _| {});
        assert_eq!(res.files, 2);
        assert!(root.join("alvo").is_dir() && root.join("fora/importante.txt").exists());
        assert_eq!(super::clean_category(custom, &super::Policy::default(), &stop, &|_, _| {}).files, 0, "sem pastas, nada");
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn simulation_lists_without_deleting() {
        use std::sync::atomic::AtomicBool;
        let root = fixture("simulate");
        let cat = test_cat(&root.join("alvo").to_string_lossy());
        let mut seen = std::collections::HashSet::new();
        let stop = AtomicBool::new(false);
        let files = super::simulate_category(&cat, &super::Policy::default(), &mut seen, &stop);
        assert_eq!(files.iter().map(|f| f.bytes).collect::<Vec<_>>(), vec![5, 3], "do maior para o menor");
        assert!(root.join("alvo/x.log").exists() && root.join("alvo/a/b/y.tmp").exists(), "nada e apagado");
        assert!(super::simulate_category(&cat, &super::Policy::default(), &mut seen, &stop).is_empty(), "arquivo ja contado nao repete");
        let _ = std::fs::remove_dir(root.join("alvo/atalho"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn policy_reads_the_config() {
        let cfg = serde_json::json!({ "settings": { "protectRecent": false }, "exclude": ["C:\\Dados\\", " ", "d:/jogos"] });
        let p = super::Policy::from_config(&cfg);
        assert_eq!(p.min_temp_age, None);
        assert_eq!(p.exclude, vec!["c:\\dados", "d:\\jogos"]);
        assert_eq!(super::Policy::from_config(&serde_json::json!({})).min_temp_age, Some(super::RECENT_TEMP_AGE), "ligado por padrao");
    }

    #[test]
    fn glob_paths() {
        let win = std::env::var("SystemRoot").unwrap();
        let found = super::expand("{windir}\\Sys*32", &[]);
        assert!(found.iter().any(|p| p.to_string_lossy().eq_ignore_ascii_case(&format!("{win}\\System32"))));
    }
}
