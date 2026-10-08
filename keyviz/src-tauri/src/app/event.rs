use std::{sync::Mutex, thread};

use rdev::{listen, Button, EventType};
use serde::Serialize;
use tauri::{menu::MenuItem, AppHandle, Emitter, Manager, Wry};

use crate::app::sidecar::emit_json;
use crate::app::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum InputEvent {
    KeyEvent { pressed: bool, name: String },
    MouseButtonEvent { pressed: bool, button: MouseButton },
    MouseMoveEvent { x: f64, y: f64 },
    MouseWheelEvent { delta_x: i64, delta_y: i64 },
}

#[derive(Debug, Clone, Serialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    Other,
}

pub fn map_mouse_button(button: Button) -> MouseButton {
    match button {
        Button::Left => MouseButton::Left,
        Button::Right => MouseButton::Right,
        Button::Middle => MouseButton::Middle,
        _ => MouseButton::Other,
    }
}

pub fn start_listener(app_handle: AppHandle, toggle_menu_item: Option<MenuItem<Wry>>) {
    thread::spawn(move || {
        eprintln!("Starting global input listener...");

        // Keep a handle for the failure path; the main one is moved into the callback.
        let error_reporter = app_handle.clone();
        if let Err(err) = listen(move |event| {
            // get app state
            let state = app_handle.state::<Mutex<AppState>>();
            let mut app_state = state.lock().unwrap();

            // track pressed keys
            if let EventType::KeyPress(key) = event.event_type {
                let key_name = format!("{:?}", key);
                // If the name contains parenthesis (like "RawKey(123)", "Unknown()"), ignore it.
                if key_name.contains('(') {
                    return;
                }
                // if key is already marked as pressed, ignore repeat
                if app_state.pressed_keys.contains(&key_name) {
                    return;
                }
                // record key as pressed
                app_state.pressed_keys.push(key_name.clone());
                // check if toggle shortcut is pressed (standalone tray only)
                if let Some(toggle_menu_item) = &toggle_menu_item {
                    if app_state.toggle_shortcut == app_state.pressed_keys {
                        app_state.toggle_listener(&app_handle, toggle_menu_item);

                        if !app_state.listening {
                            // emit key releases for all pressed keys
                            for key_name in &app_state.pressed_keys {
                                app_handle
                                    .emit_to(
                                        "main",
                                        "input-event",
                                        InputEvent::KeyEvent {
                                            pressed: false,
                                            name: key_name.clone(),
                                        },
                                    )
                                    .unwrap()
                            }
                        }
                    }
                }
                // Sidecar suppression (no-op in standalone: chords are empty there).
                // Suppressed keys are never emitted and their release stays hidden.
                if app_state.should_suppress_press(&key_name) {
                    app_state.suppressed_active.push(key_name);
                    return;
                }
            } else if let EventType::KeyRelease(key) = event.event_type {
                let key_name = format!("{:?}", key);
                if key_name.contains('(') {
                    return;
                }
                // remove key from pressed keys
                app_state.pressed_keys.retain(|k| k != &key_name);
                // hide the release of a suppressed key as well
                if app_state.take_suppressed_release(&key_name) {
                    return;
                }
            }

            // emit event if listening
            if !app_state.listening {
                return;
            }
            let input_event = match event.event_type {
                EventType::KeyPress(key) => Some(InputEvent::KeyEvent {
                    pressed: true,
                    name: format!("{:?}", key),
                }),
                EventType::KeyRelease(key) => Some(InputEvent::KeyEvent {
                    pressed: false,
                    name: format!("{:?}", key),
                }),
                EventType::ButtonPress(button) => Some(InputEvent::MouseButtonEvent {
                    pressed: true,
                    button: map_mouse_button(button),
                }),
                EventType::ButtonRelease(button) => Some(InputEvent::MouseButtonEvent {
                    button: map_mouse_button(button),
                    pressed: false,
                }),
                EventType::MouseMove { x, y } => {
                    // Convert Physical -> Logical
                    #[cfg(target_os = "macos")]
                    let (logical_x, logical_y) = (
                        x - app_state.monitor_position.0 as f64,
                        y - app_state.monitor_position.1 as f64,
                    );

                    #[cfg(not(target_os = "macos"))]
                    let (logical_x, logical_y) = {
                        let (offset_x, offset_y) = app_state.monitor_position;
                        (x - offset_x as f64, y - offset_y as f64)
                    };

                    Some(InputEvent::MouseMoveEvent {
                        x: logical_x,
                        y: logical_y,
                    })
                }
                EventType::Wheel { delta_x, delta_y } => {
                    Some(InputEvent::MouseWheelEvent { delta_x, delta_y })
                }
            };

            app_handle.emit("input-event", input_event).unwrap();
        }) {
            eprintln!("rdev listen failed: {err:?}");
            // Sidecar contract: report the late hook failure on stdout so the
            // parent can react instead of waiting forever. In standalone mode the
            // capture flag is false and stdout stays untouched.
            let sidecar_capture = error_reporter
                .try_state::<Mutex<AppState>>()
                .map(|state| state.lock().unwrap().capture_started)
                .unwrap_or(false);
            if sidecar_capture {
                emit_json(&serde_json::json!({
                    "type": "capture_failed",
                    "code": "hook_install_failed",
                    "message": format!("{err:?}"),
                }));
            }
        }
    });
}
