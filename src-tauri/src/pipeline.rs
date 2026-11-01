//! Fluxo completo de uma limpeza, usado pela tela e pela limpeza agendada:
//! ponto de restauracao -> fechar apps -> pausar servicos -> limpar ->
//! religar tudo -> log e historico.

use crate::engine::{self, CleanItem};
use crate::rules::Category;
use crate::{store, system};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Tempo que os apps tem para fechar sozinhos antes de serem encerrados.
const APP_CLOSE_TIMEOUT: Duration = Duration::from_secs(8);

/// Envia um evento para a interface (ou para lugar nenhum, no modo agendado).
pub type Emit<'a> = &'a dyn Fn(&str, Value);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanOpts {
    pub ids: Vec<String>,
    pub close_apps: bool,
    /// Processos que o usuario deixou fechar; `None` fecha todos os das categorias.
    #[serde(default)]
    pub close_only: Option<Vec<String>>,
    pub restore_point: bool,
}

#[derive(Serialize, Default)]
pub struct CleanSummary {
    pub freed: u64,
    pub files: u64,
    pub skipped: u64,
    pub items: Vec<CleanItem>,
    pub closed: Vec<String>,
    pub cancelled: bool,
    pub log: Option<String>,
    pub restore_error: Option<String>,
}

pub fn run_clean(opts: &CleanOpts, scheduled: bool, stop: &AtomicBool, emit: Emit) -> CleanSummary {
    let cats = selected_categories(&opts.ids);
    let mut summary = CleanSummary::default();

    if opts.restore_point {
        emit("clean-phase", json!("Criando ponto de restauração…"));
        summary.restore_error = system::create_restore_point().err();
    }
    let relaunch = if opts.close_apps { close_running_apps(&cats, opts.close_only.as_deref(), &mut summary, emit) } else { vec![] };
    let paused = pause_services(&cats, emit);

    clean_categories(&cats, &engine::Policy::load(), stop, emit, &mut summary);
    summary.cancelled = stop.load(Ordering::Relaxed);

    resume(&paused, &relaunch, emit);
    summary.log = write_report(&summary, scheduled);
    record_history(&summary, scheduled);
    summary
}

fn selected_categories(ids: &[String]) -> Vec<&'static Category> {
    engine::all().iter().filter(|c| ids.iter().any(|i| i == c.id)).collect()
}

/// Fecha os apps que travam os arquivos e devolve o que deve ser reaberto.
/// Processos das categorias que podem ser fechados: todos, ou so os de `only`.
fn closable(cats: &[&Category], only: Option<&[String]>) -> Vec<&'static str> {
    let allowed = |name: &str| only.map_or(true, |list| list.iter().any(|n| n.eq_ignore_ascii_case(name)));
    cats.iter().flat_map(|c| c.processes.iter().copied()).filter(|n| allowed(n)).collect()
}

fn close_running_apps(cats: &[&Category], only: Option<&[String]>, summary: &mut CleanSummary, emit: Emit) -> Vec<PathBuf> {
    let names = closable(cats, only);
    if names.is_empty() {
        return vec![];
    }
    emit("clean-phase", json!("Fechando apps abertos…"));
    let closed = system::close_apps(&names, APP_CLOSE_TIMEOUT);
    summary.closed = closed.names;
    closed.relaunch
}

fn pause_services(cats: &[&Category], emit: Emit) -> Vec<String> {
    let services: Vec<&str> = cats.iter().flat_map(|c| c.services.iter().copied()).collect();
    if services.is_empty() {
        return vec![];
    }
    emit("clean-phase", json!("Pausando serviços do Windows…"));
    system::stop_services(&services)
}

fn clean_categories(cats: &[&Category], policy: &engine::Policy, stop: &AtomicBool, emit: Emit, summary: &mut CleanSummary) {
    emit("clean-phase", json!("Limpando…"));
    for cat in cats {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        emit("clean-start", json!(cat.id));
        let item = engine::clean_category(cat, policy, stop, &|processed, freed| {
            emit("clean-tick", json!({ "id": cat.id, "files": processed, "freed": freed }));
        });
        summary.freed += item.freed;
        summary.files += item.files;
        summary.skipped += item.skipped;
        emit("clean-progress", serde_json::to_value(&item).unwrap_or_default());
        summary.items.push(item);
    }
}

fn resume(paused: &[String], relaunch: &[PathBuf], emit: Emit) {
    if !paused.is_empty() {
        emit("clean-phase", json!("Religando serviços…"));
        system::start_services(paused);
    }
    system::relaunch(relaunch);
}

fn category_name(id: &str) -> &'static str {
    engine::find(id).map(|c| c.name).unwrap_or("?")
}

fn write_report(s: &CleanSummary, scheduled: bool) -> Option<String> {
    let (stamp, when) = system::local_stamp();
    let mut lines = vec![
        format!("Axios Cleaner — limpeza {}em {when}", if scheduled { "automática " } else { "" }),
        format!("Liberado: {} · {} arquivos apagados · {} em uso pulados", human_size(s.freed), s.files, s.skipped),
    ];
    if s.cancelled {
        lines.push("A limpeza foi cancelada antes do fim.".into());
    }
    if !s.closed.is_empty() {
        lines.push(format!("Apps fechados: {}", s.closed.join(", ")));
    }
    if let Some(e) = &s.restore_error {
        lines.push(format!("Ponto de restauração não criado: {e}"));
    }
    lines.push(String::new());
    for item in &s.items {
        lines.push(format!("[{}] {} · {} arquivos · {} pulados", category_name(&item.id), human_size(item.freed), item.files, item.skipped));
        lines.extend(item.skipped_paths.iter().map(|p| format!("    em uso: {p}")));
    }
    store::write_log(&stamp, &lines)
}

/// Resumo curto das categorias: "Sistema, Chrome, Edge +4".
fn summarize_names(items: &[CleanItem]) -> String {
    let names: Vec<&str> = items.iter().map(|i| category_name(&i.id)).collect();
    match names.len() {
        0..=3 => names.join(", "),
        n => format!("{} +{}", names[..3].join(", "), n - 3),
    }
}

fn record_history(s: &CleanSummary, scheduled: bool) {
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    store::push_history(json!({
        "at": at, "freed": s.freed, "files": s.files, "skipped": s.skipped,
        "what": summarize_names(&s.items), "log": s.log, "auto": scheduled, "cancelled": s.cancelled,
    }));
}

pub fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else {
        format!("{:.0} KB", b / KB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_size_picks_the_right_unit() {
        assert_eq!(human_size(2048), "2 KB");
        assert_eq!(human_size(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(human_size(3 * 1024 * 1024 * 1024), "3.00 GB");
    }

    #[test]
    fn summarize_names_shortens_long_lists() {
        let item = |id: &str| CleanItem { id: id.into(), ..Default::default() };
        assert_eq!(summarize_names(&[item("chrome")]), "Google Chrome");
        let many: Vec<_> = ["chrome", "edge", "firefox", "brave", "vivaldi"].iter().map(|i| item(i)).collect();
        assert_eq!(summarize_names(&many), "Google Chrome, Microsoft Edge, Mozilla Firefox +2");
    }

    #[test]
    fn closable_respects_the_users_choice() {
        let cats = selected_categories(&["chrome".into(), "teams".into()]);
        assert_eq!(closable(&cats, None), vec!["chrome.exe", "ms-teams.exe", "Teams.exe"], "sem escolha, fecha todos");
        let only = vec!["teams.exe".to_string(), "MS-TEAMS.EXE".to_string()];
        assert_eq!(closable(&cats, Some(&only)), vec!["ms-teams.exe", "Teams.exe"], "so os escolhidos, sem diferenciar maiusculas");
        assert!(closable(&cats, Some(&[])).is_empty(), "lista vazia nao fecha nada");
    }

    #[test]
    fn selected_categories_ignores_unknown_ids() {
        let cats = selected_categories(&["usertemp".into(), "nao-existe".into()]);
        assert_eq!(cats.len(), 1);
        assert_eq!(cats[0].id, "usertemp");
    }
}
