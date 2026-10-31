//! Comandos chamados pela interface (invoke).

use crate::pipeline::{self, CleanOpts, CleanSummary};
use crate::{engine, files, perf, shell, startup, store, system};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter, State};

pub struct SysState(pub Mutex<System>);
pub struct PerfState(pub Mutex<perf::Perf>);

/// Arquivos encontrados pela ultima busca de "grandes": so eles podem ir
/// para a Lixeira (a interface nao consegue mandar caminhos arbitrarios).
#[derive(Default)]
pub struct LargeFilesState(pub Mutex<HashSet<String>>);

/// Tarefas longas que a interface pode cancelar.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Job {
    Clean,
    Map,
    Large,
    Tasks,
    Recycle,
}

/// Um sinal de cancelamento por tarefa.
#[derive(Default)]
pub struct CancelFlags {
    clean: AtomicBool,
    map: AtomicBool,
    large: AtomicBool,
    tasks: AtomicBool,
    recycle: AtomicBool,
}

impl CancelFlags {
    fn flag(&self, job: Job) -> &AtomicBool {
        match job {
            Job::Clean => &self.clean,
            Job::Map => &self.map,
            Job::Large => &self.large,
            Job::Tasks => &self.tasks,
            Job::Recycle => &self.recycle,
        }
    }

    /// Zera o sinal no inicio de uma tarefa e devolve o sinal dela.
    fn begin(&self, job: Job) -> &AtomicBool {
        let flag = self.flag(job);
        flag.store(false, Ordering::Relaxed);
        flag
    }
}

type Flags<'a> = State<'a, Arc<CancelFlags>>;

/// Roda trabalho pesado fora da thread da interface.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Categorias, varredura e limpeza
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct CategoryInfo {
    id: &'static str,
    group: &'static str,
    name: &'static str,
    desc: &'static str,
    processes: &'static [&'static str],
    services: &'static [&'static str],
    default_on: bool,
}

#[tauri::command]
pub fn categories() -> Vec<CategoryInfo> {
    engine::all()
        .iter()
        .map(|c| CategoryInfo {
            id: c.id,
            group: c.group,
            name: c.name,
            desc: c.desc,
            processes: c.processes,
            services: c.services,
            default_on: c.default_on,
        })
        .collect()
}

#[tauri::command]
pub async fn scan(app: AppHandle) -> Result<Vec<engine::ScanItem>, String> {
    blocking(move || {
        let procs = system::process_list();
        let running = |names: &[&str]| -> Vec<String> {
            names.iter().filter(|n| procs.processes_by_exact_name(n.as_ref()).next().is_some()).map(|n| n.to_string()).collect()
        };
        engine::scan(&running, |item| {
            let _ = app.emit("scan-progress", item.clone());
        })
    })
    .await
}

#[tauri::command]
pub async fn details(id: String) -> Result<engine::Details, String> {
    blocking(move || engine::find(&id).map(engine::details).ok_or_else(|| "categoria desconhecida".to_string())).await?
}

#[tauri::command]
pub async fn clean(app: AppHandle, flags: Flags<'_>, opts: CleanOpts) -> Result<CleanSummary, String> {
    let flags = flags.inner().clone();
    blocking(move || {
        let stop = flags.begin(Job::Clean);
        pipeline::run_clean(&opts, false, stop, &|event, payload| {
            let _ = app.emit(event, payload);
        })
    })
    .await
}

#[tauri::command]
pub fn cancel(flags: Flags<'_>, job: Job) {
    flags.flag(job).store(true, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Sistema e telemetria
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DiskInfo {
    mount: String,
    label: String,
    used: u64,
    total: u64,
    system: bool,
}

#[derive(Serialize)]
pub struct Stats {
    cpu: f32,
    gpu: Option<f32>,
    disk_activity: Option<f32>,
    mem_used: u64,
    mem_total: u64,
    disks: Vec<DiskInfo>,
}

fn fixed_disks() -> Vec<DiskInfo> {
    let system_drive = format!("{}\\", std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()));
    let mut disks: Vec<DiskInfo> = Disks::new_with_refreshed_list()
        .iter()
        .filter(|d| !d.is_removable() && d.total_space() > 0)
        .map(|d| {
            let mount = d.mount_point().to_string_lossy().into_owned();
            DiskInfo {
                system: mount.eq_ignore_ascii_case(&system_drive),
                label: d.name().to_string_lossy().into_owned(),
                used: d.total_space() - d.available_space(),
                total: d.total_space(),
                mount,
            }
        })
        .collect();
    disks.sort_by(|a, b| b.system.cmp(&a.system).then(a.mount.cmp(&b.mount)));
    disks.dedup_by(|a, b| a.mount == b.mount);
    disks
}

#[tauri::command]
pub fn system_stats(sys: State<SysState>, perf: State<PerfState>) -> Stats {
    let mut s = sys.0.lock().unwrap();
    s.refresh_cpu_usage();
    s.refresh_memory();
    let (gpu, disk_activity) = perf.0.lock().unwrap().sample();
    Stats { cpu: s.global_cpu_usage(), gpu, disk_activity, mem_used: s.used_memory(), mem_total: s.total_memory(), disks: fixed_disks() }
}

#[tauri::command]
pub fn is_admin() -> bool {
    unsafe { windows_sys::Win32::UI::Shell::IsUserAnAdmin() != 0 }
}

/// Tela inicial opcional (AXIOS_ROUTE), usada para capturas no desenvolvimento.
#[tauri::command]
pub fn start_route() -> Option<String> {
    std::env::var("AXIOS_ROUTE").ok()
}

#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("USERPROFILE").unwrap_or_default()
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    system::open_folder(&path)
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    system::reveal(&path)
}

#[tauri::command]
pub fn open_log(path: String) -> Result<(), String> {
    system::open_log(&path, &store::logs_dir())
}

#[tauri::command]
pub fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id(shell::TRAY_ID) {
        let _ = tray.set_tooltip(Some(text));
    }
}

// ---------------------------------------------------------------------------
// Configuracao, historico e logs
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_config() -> Value {
    store::load_config()
}

#[tauri::command]
pub fn save_config(config: Value) -> Result<(), String> {
    store::save_config(&config)
}

#[tauri::command]
pub fn get_history() -> Value {
    store::load_history()
}

#[tauri::command]
pub fn clear_history() {
    store::clear_history()
}

#[tauri::command]
pub fn open_logs_folder() -> Result<(), String> {
    system::open_folder(&store::logs_dir().to_string_lossy())
}

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn large_files(flags: Flags<'_>, found: State<'_, LargeFilesState>, min_mb: u64) -> Result<Vec<files::BigFile>, String> {
    let flags = flags.inner().clone();
    let list = blocking(move || files::large_files(min_mb * 1024 * 1024, flags.begin(Job::Large))).await?;
    *found.0.lock().unwrap() = list.iter().map(|f| f.path.clone()).collect();
    Ok(list)
}

#[tauri::command]
pub async fn recycle_files(app: AppHandle, flags: Flags<'_>, found: State<'_, LargeFilesState>, paths: Vec<String>) -> Result<(u64, u64), String> {
    let allowed = found.0.lock().unwrap().clone();
    let paths: Vec<String> = paths.into_iter().filter(|p| allowed.contains(p)).collect();
    let flags = flags.inner().clone();
    blocking(move || {
        files::recycle(&paths, flags.begin(Job::Recycle), &|done, total| {
            let _ = app.emit("recycle-progress", json!({ "done": done, "total": total }));
        })
    })
    .await
}

#[tauri::command]
pub async fn map_folder(app: AppHandle, flags: Flags<'_>, path: String) -> Result<files::MapResult, String> {
    let flags = flags.inner().clone();
    blocking(move || {
        files::map_folder(&path, flags.begin(Job::Map), &|done, total, current, bytes| {
            let _ = app.emit("map-progress", json!({ "done": done, "total": total, "current": current, "bytes": bytes }));
        })
    })
    .await
}

#[tauri::command]
pub fn startup_list() -> Vec<startup::StartupItem> {
    startup::list()
}

#[tauri::command]
pub fn startup_set(id: String, enabled: bool) -> Result<(), String> {
    startup::set_enabled(&id, enabled)
}

#[tauri::command]
pub async fn maintenance(app: AppHandle, flags: Flags<'_>, ids: Vec<String>) -> Result<Vec<system::TaskResult>, String> {
    let flags = flags.inner().clone();
    blocking(move || {
        let stop = flags.begin(Job::Tasks);
        let mut results = Vec::new();
        for id in &ids {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let _ = app.emit("task-start", id);
            let result = system::run_task(id, stop);
            let _ = app.emit("task-done", result.clone());
            results.push(result);
        }
        results
    })
    .await
}

#[tauri::command]
pub fn schedule_status() -> bool {
    system::schedule_exists()
}

#[tauri::command]
pub fn schedule_set(freq: String, day: String, time: String) -> Result<(), String> {
    system::schedule_set(&freq, &day, &time)
}

#[tauri::command]
pub fn schedule_clear() {
    system::schedule_clear()
}
