#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine;
mod files;
mod perf;
mod pipeline;
mod rules;
mod shell;
mod startup;
mod store;
mod system;
mod updates;

use commands::{CancelFlags, DupFilesState, LargeFilesState, PerfState, SysState};
use std::sync::{Arc, Mutex};
use sysinfo::System;

fn main() {
    let scheduled = std::env::args().any(|a| a == "--auto");

    let mut sys = System::new();
    sys.refresh_cpu_usage(); // primeira amostra, para o % de CPU ter base

    let mut builder = tauri::Builder::default();
    if !scheduled {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main(app)))
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(SysState(Mutex::new(sys)))
        .manage(PerfState(Mutex::new(perf::Perf::new())))
        .manage(Arc::new(CancelFlags::default()))
        .manage(LargeFilesState::default())
        .manage(DupFilesState::default())
        .manage(updates::PendingUpdate::default())
        .setup(move |app| {
            if scheduled {
                shell::run_scheduled_clean(app.handle().clone());
            } else {
                shell::create_main_window(app.handle())?;
                shell::create_tray(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::categories,
            commands::scan,
            commands::details,
            commands::clean,
            commands::cancel,
            commands::system_stats,
            commands::is_admin,
            commands::start_route,
            commands::home_dir,
            commands::open_folder,
            commands::reveal_path,
            commands::open_log,
            commands::open_logs_folder,
            commands::simulate,
            commands::check_custom_folder,
            commands::pick_path,
            commands::running_apps,
            commands::quit_ack,
            commands::quit_app,
            commands::set_zoom,
            commands::set_tray_tooltip,
            commands::get_config,
            commands::save_config,
            commands::get_history,
            commands::clear_history,
            commands::large_files,
            commands::recycle_files,
            commands::duplicates,
            commands::map_folder,
            commands::startup_list,
            commands::startup_set,
            commands::maintenance,
            commands::schedule_status,
            commands::schedule_set,
            commands::schedule_clear,
            updates::check_update,
            updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Axios Cleaner");
}
