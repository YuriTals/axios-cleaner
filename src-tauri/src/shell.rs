//! Janela principal, icone na bandeja e limpeza agendada (modo sem janela).

use crate::pipeline::{self, CleanOpts};
use crate::{engine, store};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WindowEvent};

pub const MAIN_WINDOW: &str = "main";
pub const TRAY_ID: &str = "main";

/// Quanto tempo o modo agendado espera antes de sair (para a notificacao aparecer).
const NOTIFICATION_GRACE: Duration = Duration::from_secs(5);

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// A janela so pode exibir o proprio app: nenhuma navegacao para a internet.
fn is_app_url(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn close_to_tray_enabled() -> bool {
    store::load_config()["settings"]["closeToTray"].as_bool().unwrap_or(false)
}

/// Pedido de saida que a interface ainda nao confirmou ter recebido (`quit_ack`).
pub static QUIT_PENDING: AtomicBool = AtomicBool::new(false);

/// Sair passa pela interface, que pergunta e cancela tarefas antes de chamar `quit_app`.
/// Se a interface travou e nao respondeu ao primeiro pedido, o segundo fecha de vez.
pub fn request_quit(app: &AppHandle) {
    if QUIT_PENDING.swap(true, Ordering::SeqCst) {
        app.exit(0);
        return;
    }
    show_main(app);
    let _ = app.emit("quit-requested", ());
}

/// Cria a janela principal. Fechar a janela (X ou Alt+F4) so a esconde com
/// "fechar para a bandeja" ligado; sem ele, vira um pedido de saida.
pub fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let config = app.config().app.windows[0].clone();
    let window = WebviewWindowBuilder::from_config(app, &config)?.on_navigation(is_app_url).build()?;
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if close_to_tray_enabled() {
                let _ = handle.hide();
            } else {
                request_quit(handle.app_handle());
            }
        }
    });
    Ok(())
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir Axios Cleaner", true, None::<&str>)?;
    let scan = MenuItem::with_id(app, "scan", "Analisar agora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &scan, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Axios Cleaner")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "scan" => {
                show_main(app);
                let _ = app.emit("tray-scan", ());
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Opcoes salvas pela interface (categorias marcadas e ajustes).
fn saved_clean_options() -> CleanOpts {
    let cfg = store::load_config();
    let ids = cfg["selected"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_else(|| engine::all().iter().filter(|c| c.default_on).map(|c| c.id.to_string()).collect());
    CleanOpts {
        ids,
        close_apps: cfg["settings"]["closeApps"].as_bool().unwrap_or(true),
        close_only: None,
        restore_point: cfg["settings"]["restorePoint"].as_bool().unwrap_or(false),
    }
}

/// Limpeza agendada: roda sem janela com as escolhas salvas e avisa no fim.
pub fn run_scheduled_clean(app: AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    std::thread::spawn(move || {
        let never_cancel = AtomicBool::new(false);
        let summary = pipeline::run_clean(&saved_clean_options(), true, &never_cancel, &|_, _| {});
        let _ = app
            .notification()
            .builder()
            .title("Axios Cleaner")
            .body(format!("Limpeza automática concluída: {} liberados.", pipeline::human_size(summary.freed)))
            .show();
        std::thread::sleep(NOTIFICATION_GRACE);
        app.exit(0);
    });
}
