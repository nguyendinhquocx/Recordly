use std::sync::Mutex;

use serde_json::json;
use tauri::{
    image::Image,
    include_image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewWindowBuilder,
};

mod app;
use app::commands::{log, set_main_window_monitor, set_toggle_shortcut};
use app::event::start_listener;
use app::sidecar::{emit_json, parse_cli, spawn_protocol_thread, RunMode};
use app::state::AppState;
use app::window::config_window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli = parse_cli();
    let sidecar_settings_mode = cli.mode == RunMode::Settings;

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, __, ___| {}))
        .plugin(tauri_plugin_prevent_default::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            match cli.mode {
                RunMode::Standalone => setup_standalone(app)?,
                RunMode::Capture => setup_sidecar_capture(app)?,
                RunMode::Settings => setup_sidecar_settings(app, &cli.lang)?,
            }
            Ok(())
        })
        .on_window_event(move |window, event| {
            if window.label() != "settings" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    if sidecar_settings_mode {
                        // Sidecar settings mode: closing the window ends the process.
                        eprintln!("[recordly-keyviz] settings window closed; exiting cleanly");
                        std::process::exit(0);
                    }
                    window
                        .app_handle()
                        .emit_to("main", "settings-window", false)
                        .unwrap();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            log,
            set_toggle_shortcut,
            set_main_window_monitor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Legacy standalone behavior (no CLI args): overlay + tray + listener at startup.
fn setup_standalone(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // prepare window
    if let Some(window) = app.get_webview_window("main") {
        config_window(&window);
    }

    let app_handle = app.handle();
    // manage app state
    app.manage(Mutex::new(AppState::new(app_handle, true)));

    // tray actions
    let toggle_item = MenuItem::with_id(app, "toggle", "Stop", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    // start global input listener
    start_listener(app_handle.clone(), Some(toggle_item.clone()), None);

    // setup tray menu
    let menu = Menu::with_items(app, &[&toggle_item, &settings_item, &quit_item])?;
    let _ = TrayIconBuilder::with_id("keyviz-tray")
        .icon(Image::from(include_image!("icons/tray.png")))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => {
                let state = app.state::<Mutex<AppState>>();
                let mut app_state = state.lock().unwrap();
                app_state.toggle_listener(app, &toggle_item);
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.set_focus();
                    return;
                }
                let webview_url = tauri::WebviewUrl::App("index.html#/settings".into());
                WebviewWindowBuilder::new(app, "settings", webview_url.clone())
                    .title("Keyviz")
                    .inner_size(800.0, 640.0)
                    .min_inner_size(640.0, 480.0)
                    .max_inner_size(1000.0, 800.0)
                    .maximizable(false)
                    .build()
                    .unwrap();

                app.emit_to("main", "settings-window", true).unwrap();
            }
            "quit" => std::process::exit(0),
            _ => println!("um... what?"),
        })
        .build(app);

    Ok(())
}

/// Recordly sidecar capture mode: overlay + stdio protocol. No tray, no listener
/// until the parent sends `start_capture`.
fn setup_sidecar_capture(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Overlay window only.
    if let Some(window) = app.get_webview_window("main") {
        config_window(&window);
    }

    let app_handle = app.handle();
    // Listener stays off until the parent sends `start_capture`.
    app.manage(Mutex::new(AppState::new(app_handle, false)));

    // Parent-driven stdio protocol; exits on `quit` or stdin EOF.
    spawn_protocol_thread(app_handle.clone(), RunMode::Capture);

    // Setup finished and the overlay is visible: tell the parent we can receive
    // commands. Exactly one JSON line.
    emit_json(&json!({ "type": "ready" }));
    Ok(())
}

/// Recordly sidecar settings mode: settings window only (localized via `lang`).
/// No overlay, no tray, no listener; closing the window exits the process.
fn setup_sidecar_settings(
    app: &mut tauri::App,
    lang: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // The overlay window comes from the shared config; close it in settings mode.
    if let Some(window) = app.get_webview_window("main") {
        window.close()?;
    }

    let app_handle = app.handle();
    app.manage(Mutex::new(AppState::new(app_handle, false)));

    let webview_url = tauri::WebviewUrl::App(format!("index.html#/settings?lang={lang}").into());
    WebviewWindowBuilder::new(app_handle, "settings", webview_url)
        .title("Keyviz")
        .inner_size(800.0, 640.0)
        .min_inner_size(640.0, 480.0)
        .max_inner_size(1000.0, 800.0)
        .maximizable(false)
        .build()?;

    // Parent-driven stdio protocol; exits on `quit` or stdin EOF.
    spawn_protocol_thread(app_handle.clone(), RunMode::Settings);

    emit_json(&json!({ "type": "ready" }));
    Ok(())
}
