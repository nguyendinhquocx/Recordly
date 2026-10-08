//! Recordly sidecar control plane (Task 2 of SPEC-2026-10-08-recordly-keyviz).
//!
//! # CLI modes
//! - `keyviz.exe --mode=capture`  → overlay + stdio protocol; listener only after `start_capture`.
//! - `keyviz.exe --mode=settings` → settings window only; no listener, no tray, no overlay.
//! - no args                      → legacy standalone behavior (listener + tray at startup).
//! - optional `--lang=vi`         → settings UI language (sidecar modes default to `vi`,
//!   standalone defaults to `en`). Unknown `--mode` values exit with code 2.
//!
//! # Stdio protocol (line-delimited JSON, UTF-8, exactly one JSON object per line)
//! Sidecar → parent:
//! - `{"type":"ready"}` — once, right after Tauri setup finished (overlay visible in
//!   capture mode, settings window built in settings mode).
//! - `{"type":"capture_started"}` — the input listener was spawned after `start_capture`.
//! - `{"type":"capture_failed","code":"hook_install_failed","message":"..."}` — the
//!   low-level keyboard hook could not be installed. Emitted instead of
//!   `capture_started` when the synchronous pre-flight probe fails, or (rare race)
//!   right after `capture_started` if rdev's `listen()` fails later; the parent must
//!   treat `capture_failed` as terminal regardless of ordering.
//!
//! Parent → sidecar:
//! - `{"type":"start_capture","suppressed_shortcuts":[[...], ...]}` — starts the global
//!   input listener. `suppressed_shortcuts` is an array of chords; every chord is an
//!   array of key positions. See `suppressed_shortcuts contract` below.
//! - `{"type":"quit"}` — clean shutdown, process exits with code 0.
//!
//! Stdin EOF (parent died) also exits the process with code 0, so a dead parent can
//! never leave an orphaned hook. Unknown/malformed lines are reported on stderr and
//! ignored; they never produce stdout noise. No key content is ever logged.
//!
//! # suppressed_shortcuts contract
//! Each chord is an array of key positions, e.g. `[["ControlLeft","Alt","ShiftLeft","KeyR"]]`.
//! Key names use rdev's `{:?}` debug naming (see `crates/rdev/src/rdev.rs`): `ControlLeft`,
//! `ControlRight`, `Alt`, `AltGr`, `ShiftLeft`, `ShiftRight`, `MetaLeft`, `MetaRight`,
//! `KeyA`…`KeyZ`, `Num0`…`Num9`, `Kp0`…`Kp9`, `F1`…`F24`, `Return`, `Escape`, `Space`,
//! `Tab`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`,
//! `UpArrow`, `DownArrow`, `LeftArrow`, `RightArrow`, `PrintScreen`, `ScrollLock`,
//! `Pause`, `NumLock`, `CapsLock`, `Minus`, `Equal`, `Comma`, `Dot`, `Slash`, ...
//! Friendly aliases are accepted and normalized: `Control`/`Ctrl` → ControlLeft+ControlRight,
//! `Shift` → ShiftLeft+ShiftRight, `Alt` → Alt+AltGr, `Meta`/`Super`/`Win`/`Cmd` →
//! MetaLeft+MetaRight, `Enter` → Return, `Esc` → Escape, `Del` → Delete, `Up`/`Down`/
//! `Left`/`Right` → arrow variants, single letters `A`–`Z` → `KeyA`…, digits `0`–`9` →
//! `Num0`…. A chord may also be sent as one `"Ctrl+Alt+Shift+R"` string element.
//! Chord matching is order-insensitive (set matching over currently pressed keys):
//! - a key that completes a fully-pressed chord is suppressed (press + its release);
//! - a modifier that starts/extends an incomplete chord is suppressed as a prefix;
//! - every other key is emitted normally; mouse events are never suppressed.
//!
//! Sidecar modes require the parent to keep the child's stdio piped.
use std::io::{BufRead, Write};

use serde_json::{json, Value};
use tauri::{Manager, Wry};

use crate::app::event::start_listener;
use crate::app::state::{normalize_chords, AppState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunMode {
    /// Legacy standalone Keyviz: listener + tray from startup, no stdio protocol.
    Standalone,
    /// Recordly sidecar capture: overlay + stdio protocol, listener only after
    /// `start_capture`.
    Capture,
    /// Recordly sidecar settings: settings window only; closing it exits the process.
    Settings,
}

pub struct CliOptions {
    pub mode: RunMode,
    pub lang: String,
}

pub fn parse_cli() -> CliOptions {
    let mut mode = RunMode::Standalone;
    let mut lang: Option<String> = None;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        let (key, inline_value) = match arg.split_once('=') {
            Some((key, value)) => (key, Some(value.to_string())),
            None => (arg.as_str(), None),
        };
        match key {
            "--mode" => {
                let value = match inline_value {
                    Some(value) => value,
                    None => iter.next().unwrap_or_default(),
                };
                mode = match value.as_str() {
                    "capture" => RunMode::Capture,
                    "settings" => RunMode::Settings,
                    other => {
                        eprintln!(
                            "[recordly-keyviz] unknown --mode value {other:?}; expected \"capture\" or \"settings\""
                        );
                        std::process::exit(2);
                    }
                };
            }
            "--lang" => {
                let value = match inline_value {
                    Some(value) => value,
                    None => iter.next().unwrap_or_default(),
                };
                if !value.is_empty() {
                    lang = Some(value);
                }
            }
            // Ignore unknown args so future flags stay backward compatible.
            _ => {}
        }
    }

    let lang = lang.unwrap_or_else(|| match mode {
        RunMode::Standalone => "en".to_string(),
        _ => "vi".to_string(),
    });
    CliOptions { mode, lang }
}

/// Write one JSON line to stdout and flush immediately (parent may be a pipe).
pub fn emit_json(value: &Value) {
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{value}");
    let _ = lock.flush();
}

/// Spawn the stdin reader thread that drives the sidecar protocol.
///
/// The thread exits the whole process with code 0 on stdin EOF (parent died) or on
/// a `quit` command, so a dead parent can never leave an orphaned hook/window.
pub fn spawn_protocol_thread(app: tauri::AppHandle<Wry>, mode: RunMode) {
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut reader = stdin.lock();
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => handle_command(&app, mode, line.trim()),
                Err(err) => {
                    eprintln!("[recordly-keyviz] stdin read error: {err}");
                    break;
                }
            }
        }
        eprintln!("[recordly-keyviz] stdin closed; exiting cleanly");
        // OS-level hooks are removed when the process exits.
        std::process::exit(0);
    });
}

fn handle_command(app: &tauri::AppHandle<Wry>, mode: RunMode, line: &str) {
    if line.is_empty() {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        eprintln!("[recordly-keyviz] ignoring non-JSON stdin line");
        return;
    };
    match value.get("type").and_then(Value::as_str) {
        Some("start_capture") => start_capture(app, &value),
        Some("quit") => {
            eprintln!("[recordly-keyviz] quit requested; exiting cleanly");
            std::process::exit(0);
        }
        other => eprintln!(
            "[recordly-keyviz] ignoring stdin command {other:?} in mode {mode:?}"
        ),
    }
}

fn start_capture(app: &tauri::AppHandle<Wry>, value: &Value) {
    {
        let state = app.state::<std::sync::Mutex<AppState>>();
        let mut app_state = state.lock().unwrap();
        if app_state.capture_started {
            // Idempotent: a duplicate start_capture must not install a second hook.
            eprintln!("[recordly-keyviz] duplicate start_capture; acknowledging again");
            emit_json(&json!({ "type": "capture_started" }));
            return;
        }
        app_state.suppressed_chords = normalize_chords(&parse_raw_chords(
            value.get("suppressed_shortcuts"),
        ));
        app_state.listening = true;
        app_state.capture_started = true;
    }

    // Pre-flight the low-level keyboard hook so an immediate install failure is
    // reported as `capture_failed` instead of a silent timeout on the parent side.
    // rdev's listen() blocks forever on success, so this synchronous probe is the
    // only way to answer before the message loop takes over the thread.
    if let Err(message) = probe_keyboard_hook() {
        eprintln!("[recordly-keyviz] hook pre-flight failed: {message}");
        {
            let state = app.state::<std::sync::Mutex<AppState>>();
            let mut app_state = state.lock().unwrap();
            app_state.listening = false;
            app_state.capture_started = false;
        }
        emit_json(&json!({
            "type": "capture_failed",
            "code": "hook_install_failed",
            "message": message,
        }));
        return;
    }

    // No tray toggle in sidecar modes: lifecycle is owned by the parent process.
    start_listener(app.clone(), None);
    emit_json(&json!({ "type": "capture_started" }));
    // NOTE: if rdev's listen() fails after this point (rare race between the probe
    // above and the real install), the listener thread also reports
    // `capture_failed` on stdout; the parent must treat it as terminal.
}

/// Accepts `[["ControlLeft","Alt","ShiftLeft","KeyR"], ...]` and the lenient
/// `["Ctrl+Alt+Shift+R", ...]` form; anything else becomes an empty chord list.
fn parse_raw_chords(value: Option<&Value>) -> Vec<Vec<String>> {
    let Some(entries) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut chords = Vec::new();
    for entry in entries {
        match entry {
            Value::Array(positions) => {
                let chord = positions
                    .iter()
                    .filter_map(|p| p.as_str().map(str::to_string))
                    .collect::<Vec<_>>();
                if !chord.is_empty() {
                    chords.push(chord);
                }
            }
            Value::String(combined) => {
                let chord = combined
                    .split('+')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                if chord.len() > 1 {
                    chords.push(chord);
                }
            }
            _ => {}
        }
    }
    chords
}

/// Synchronous WH_KEYBOARD_LL install probe: installs a pass-through hook for
/// microseconds, unhooks it, and reports the OS error verbatim. This is what lets
/// the sidecar distinguish `capture_failed` ("hook cannot be installed at all")
/// from a running listener.
#[cfg(target_os = "windows")]
fn probe_keyboard_hook() -> Result<(), String> {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExA, UnhookWindowsHookEx, HOOKPROC, WH_KEYBOARD_LL,
    };

    // Pass-through procedure; installed for microseconds only.
    unsafe extern "system" fn probe_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    let hook_proc: HOOKPROC = Some(probe_proc);
    unsafe {
        match SetWindowsHookExA(WH_KEYBOARD_LL, hook_proc, None, 0) {
            Ok(hook) => {
                UnhookWindowsHookEx(hook);
                Ok(())
            }
            Err(err) => Err(format!("SetWindowsHookExA(WH_KEYBOARD_LL) failed: {err}")),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn probe_keyboard_hook() -> Result<(), String> {
    // The sidecar is Windows-only in this revision; other hosts always "succeed".
    Ok(())
}
