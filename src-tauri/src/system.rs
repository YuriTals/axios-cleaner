//! Integracao com o Windows: fechar apps, servicos, comandos, manutencao
//! e agendamento.

use serde::Serialize;
use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Roda um programa sem abrir janela de console.
pub fn run_hidden(exe: &str, args: &[&str]) -> std::io::Result<Output> {
    Command::new(exe).args(args).creation_flags(CREATE_NO_WINDOW).output()
}

/// Roda um programa sem janela e o encerra se `stop` for ligado.
pub fn run_cancellable(exe: &str, args: &[&str], stop: &AtomicBool) -> Result<ExitStatus, String> {
    let mut child = Command::new(exe)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(status);
        }
        if stop.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cancelada".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Abre um arquivo/pasta/programa pelo explorer.exe, que entrega ao shell do
/// usuario (sem privilegios de administrador).
fn open_unelevated(target: &str) {
    let _ = Command::new("explorer.exe").arg(target).spawn();
}

/// Abre uma pasta existente no Explorer (nunca executa arquivos).
pub fn open_folder(path: &str) -> Result<(), String> {
    if !Path::new(path).is_dir() {
        return Err("pasta não encontrada".into());
    }
    open_unelevated(path);
    Ok(())
}

/// Mostra um arquivo ou pasta selecionado no Explorer, sem abri-lo.
pub fn reveal(path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("item não encontrado".into());
    }
    let _ = Command::new("explorer.exe").arg(format!("/select,{path}")).spawn();
    Ok(())
}

/// Abre um log (.txt) com o programa padrão; so aceita arquivos da pasta de logs.
pub fn open_log(path: &str, logs_dir: &Path) -> Result<(), String> {
    let file = std::fs::canonicalize(path).map_err(|_| "log não encontrado".to_string())?;
    let dir = std::fs::canonicalize(logs_dir).map_err(|e| e.to_string())?;
    let is_txt = file.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt"));
    if !is_txt || file.parent() != Some(dir.as_path()) {
        return Err("arquivo fora da pasta de logs".into());
    }
    open_unelevated(path);
    Ok(())
}

pub fn process_list() -> System {
    System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()))
}

// ---------------------------------------------------------------------------
// Fechar apps com educacao
// ---------------------------------------------------------------------------

unsafe extern "system" fn close_windows_of(hwnd: *mut core::ffi::c_void, lparam: isize) -> i32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE};
    let pids = &*(lparam as *const HashSet<u32>);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pids.contains(&pid) && IsWindowVisible(hwnd) != 0 {
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
    1
}

#[derive(Default)]
pub struct Closed {
    pub names: Vec<String>,
    /// Executaveis do OneDrive para reabrir no final.
    pub relaunch: Vec<PathBuf>,
}

/// Pede para os apps fecharem (como clicar no X) e so forca o encerramento
/// de quem nao fechar dentro de `timeout`. O OneDrive usa o proprio /shutdown.
pub fn close_apps(names: &[&str], timeout: Duration) -> Closed {
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;
    let mut sys = process_list();
    let mut out = Closed { names: vec![], relaunch: vec![] };
    let mut pids: HashSet<u32> = HashSet::new();

    for name in names {
        let procs: Vec<_> = sys.processes_by_exact_name(name.as_ref()).collect();
        if procs.is_empty() {
            continue;
        }
        out.names.push(name.to_string());
        if name.eq_ignore_ascii_case("OneDrive.exe") {
            if let Some(exe) = procs[0].exe().map(|p| p.to_path_buf()) {
                let _ = run_hidden(&exe.to_string_lossy(), &["/shutdown"]);
                out.relaunch.push(exe);
            }
        }
        pids.extend(procs.iter().map(|p| p.pid().as_u32()));
    }
    if pids.is_empty() {
        return out;
    }

    unsafe { EnumWindows(Some(close_windows_of), &pids as *const _ as isize) };

    let start = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(300));
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let alive: Vec<_> = pids.iter().filter(|p| sys.process(sysinfo::Pid::from_u32(**p)).is_some()).copied().collect();
        if alive.is_empty() {
            break;
        }
        if start.elapsed() >= timeout {
            for pid in alive {
                if let Some(p) = sys.process(sysinfo::Pid::from_u32(pid)) {
                    p.kill();
                }
            }
            std::thread::sleep(Duration::from_millis(800));
            break;
        }
    }
    out
}

/// Reabre programas fechados para a limpeza (o explorer.exe os inicia sem admin).
pub fn relaunch(exes: &[PathBuf]) {
    for exe in exes {
        open_unelevated(&exe.to_string_lossy());
    }
}

// ---------------------------------------------------------------------------
// Servicos
// ---------------------------------------------------------------------------

fn service_running(name: &str) -> bool {
    run_hidden("sc.exe", &["query", name])
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("RUNNING"))
        .unwrap_or(false)
}

/// Para os servicos e devolve os que estavam rodando (para religar depois).
pub fn stop_services(names: &[&str]) -> Vec<String> {
    let mut stopped = Vec::new();
    for name in names {
        if service_running(name) {
            let _ = run_hidden("net.exe", &["stop", name, "/y"]);
            stopped.push(name.to_string());
        }
    }
    stopped
}

pub fn start_services(names: &[String]) {
    for name in names {
        let _ = run_hidden("net.exe", &["start", name]);
    }
}

// ---------------------------------------------------------------------------
// Ponto de restauracao
// ---------------------------------------------------------------------------

pub fn create_restore_point() -> Result<(), String> {
    let out = run_hidden(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Checkpoint-Computer -Description 'Axios Cleaner' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop",
        ],
    )
    .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err("A Proteção do Sistema pode estar desativada nesta unidade.".into())
    }
}

// ---------------------------------------------------------------------------
// Manutencao
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct TaskResult {
    pub id: String,
    pub ok: bool,
    pub secs: u64,
    pub msg: String,
}

fn restart_explorer_and_thumbs() -> Result<String, String> {
    let _ = run_hidden("taskkill.exe", &["/f", "/im", "explorer.exe"]);
    std::thread::sleep(Duration::from_millis(1200));
    let mut removed = 0;
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let dir = PathBuf::from(local).join("Microsoft\\Windows\\Explorer");
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if (n.starts_with("thumbcache_") || n.starts_with("iconcache_")) && n.ends_with(".db")
                    && std::fs::remove_file(e.path()).is_ok()
                {
                    removed += 1;
                }
            }
        }
    }
    // O Windows reabre o Explorer sozinho; se nao reabrir, abrimos.
    std::thread::sleep(Duration::from_millis(2500));
    let sys = process_list();
    if sys.processes_by_exact_name("explorer.exe".as_ref()).next().is_none() {
        let _ = Command::new("explorer.exe").spawn();
    }
    Ok(format!("{removed} arquivos de cache removidos"))
}

fn exit_ok(out: Result<ExitStatus, String>, ok_msg: &str) -> Result<String, String> {
    match out {
        Ok(s) if s.success() => Ok(ok_msg.into()),
        Ok(s) => Err(format!("terminou com código {}", s.code().unwrap_or(-1))),
        Err(e) => Err(e),
    }
}

pub fn run_task(id: &str, stop: &AtomicBool) -> TaskResult {
    let start = Instant::now();
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let res: Result<String, String> = match id {
        "dism" => exit_ok(run_cancellable("dism.exe", &["/Online", "/Cleanup-Image", "/StartComponentCleanup"], stop), "Componentes antigos removidos"),
        "explorer" => restart_explorer_and_thumbs(),
        "dns" => exit_ok(run_cancellable("ipconfig.exe", &["/flushdns"], stop), "Cache de DNS limpo"),
        "trim" => exit_ok(run_cancellable("defrag.exe", &[&drive, "/O", "/H"], stop), "Unidade otimizada"),
        "sfc" => exit_ok(run_cancellable("sfc.exe", &["/scannow"], stop), "Verificação concluída"),
        "restore" => create_restore_point().map(|_| "Ponto de restauração criado".into()),
        _ => Err("tarefa desconhecida".into()),
    };
    let (ok, msg) = match res {
        Ok(m) => (true, m),
        Err(m) => (false, m),
    };
    TaskResult { id: id.into(), ok, secs: start.elapsed().as_secs(), msg }
}

// ---------------------------------------------------------------------------
// Agendamento (Agendador de Tarefas do Windows)
// ---------------------------------------------------------------------------

const TASK_NAME: &str = "Axios Cleaner\\Limpeza automatica";
const WEEKDAYS: [&str; 7] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

fn valid_time(time: &str) -> bool {
    let Some((h, m)) = time.split_once(':') else { return false };
    h.len() == 2 && m.len() == 2 && h.parse::<u8>().is_ok_and(|h| h < 24) && m.parse::<u8>().is_ok_and(|m| m < 60)
}

fn valid_day(freq: &str, day: &str) -> bool {
    match freq {
        "daily" => true,
        "weekly" => WEEKDAYS.contains(&day),
        "monthly" => day.parse::<u8>().is_ok_and(|d| (1..=28).contains(&d)),
        _ => false,
    }
}

/// A tarefa roda como admin, entao o .exe precisa estar num lugar que so admin
/// altera (Arquivos de Programas). Senao, outro programa poderia troca-lo.
fn installed_exe() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().and_then(std::fs::canonicalize).map_err(|e| e.to_string())?;
    let protected = ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|v| std::env::var(v).ok())
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .any(|root| exe.starts_with(root));
    if protected {
        Ok(exe)
    } else {
        Err("Instale o app pelo instalador para usar a limpeza agendada.".into())
    }
}

pub fn schedule_exists() -> bool {
    run_hidden("schtasks.exe", &["/Query", "/TN", TASK_NAME]).map(|o| o.status.success()).unwrap_or(false)
}

/// `freq`: daily | weekly | monthly. `day`: MON..SUN (semanal) ou 1..28 (mensal).
pub fn schedule_set(freq: &str, day: &str, time: &str) -> Result<(), String> {
    if !valid_time(time) || !valid_day(freq, day) {
        return Err("agendamento inválido".into());
    }
    let exe = installed_exe()?;
    let tr = format!("\"{}\" --auto", exe.display());
    let mut args: Vec<&str> = vec!["/Create", "/F", "/TN", TASK_NAME, "/TR", &tr, "/RL", "HIGHEST", "/ST", time];
    match freq {
        "daily" => args.extend(["/SC", "DAILY"]),
        "weekly" => args.extend(["/SC", "WEEKLY", "/D", day]),
        "monthly" => args.extend(["/SC", "MONTHLY", "/D", day]),
        _ => return Err("frequência inválida".into()),
    }
    let out = run_hidden("schtasks.exe", &args).map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn schedule_clear() {
    let _ = run_hidden("schtasks.exe", &["/Delete", "/F", "/TN", TASK_NAME]);
}

/// Data/hora local: ("2026-10-30_201530", "30/10/2026 20:15").
pub fn local_stamp() -> (String, String) {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    let mut t = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut t) };
    (
        format!("{:04}-{:02}-{:02}_{:02}{:02}{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond),
        format!("{:02}/{:02}/{:04} {:02}:{:02}", t.wDay, t.wMonth, t.wYear, t.wHour, t.wMinute),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_input_is_validated() {
        assert!(valid_time("12:00") && valid_time("23:59"));
        assert!(!valid_time("24:00") && !valid_time("9:00") && !valid_time("12:00 /RU x"));
        assert!(valid_day("weekly", "SUN") && !valid_day("weekly", "DOM"));
        assert!(valid_day("monthly", "28") && !valid_day("monthly", "31"));
        assert!(!valid_day("hourly", "1"));
    }

    #[test]
    fn open_log_rejects_files_outside_the_logs_folder() {
        let logs = std::env::temp_dir().join(format!("axios_logs_{}", std::process::id()));
        std::fs::create_dir_all(&logs).unwrap();
        let outside = std::env::temp_dir().join(format!("axios_outside_{}.txt", std::process::id()));
        std::fs::write(&outside, b"x").unwrap();
        assert!(open_log(&outside.to_string_lossy(), &logs).is_err());
        assert!(open_log(r"C:\Windows\notepad.exe", &logs).is_err());
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&logs);
    }
}
