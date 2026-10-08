use serde::Deserialize;
use tauri::{image::Image, include_image, Emitter, Wry};
use tauri_plugin_store::StoreExt;

/// A suppressed chord: an ordered list of chord positions, where every position
/// accepts one or more physical rdev key names (e.g. the "Control" position
/// accepts "ControlLeft" and "ControlRight"). Matching is order-insensitive.
pub type SuppressedChord = Vec<Vec<String>>;

#[derive(Default)]
pub struct AppState {
    pub listening: bool,
    pub pressed_keys: Vec<String>,
    pub toggle_shortcut: Vec<String>,
    /// Chords whose key events must never reach the overlay (sidecar capture mode;
    /// empty in standalone). See the contract in `app/sidecar.rs`.
    pub suppressed_chords: Vec<SuppressedChord>,
    /// Keys whose press was suppressed; their release must stay hidden too.
    pub suppressed_active: Vec<String>,
    /// True once the parent sent a successful `start_capture` (sidecar capture mode).
    pub capture_started: bool,

    pub monitor_name: Option<String>,
    pub monitor_scale: f64,
    pub monitor_position: (i32, i32),
}

impl AppState {
    pub fn new(app: &tauri::AppHandle, listening: bool) -> Self {
        let mut toggle_shortcut = vec!["Shift".to_string(), "F10".to_string()];

        // load saved config from store
        if let Ok(store) = app.store("store.json") {
            if let Some(value) = store.get("key_event_store") {
                // the value comes in as a String: "{\"state\": ...}"
                if let Some(json_str) = value.as_str() {
                    // parse the inner string
                    match serde_json::from_str::<KeyEventStore>(json_str) {
                        Ok(parsed) => {
                            toggle_shortcut = parsed.state.toggle_shortcut;
                        }
                        Err(e) => eprintln!("Failed to parse inner config JSON: {}", e),
                    }
                }
            }
        }

        Self {
            listening,
            pressed_keys: vec![],
            toggle_shortcut,
            suppressed_chords: vec![],
            suppressed_active: vec![],
            capture_started: false,
            monitor_name: None,
            monitor_scale: 1.0,
            monitor_position: (0, 0),
        }
    }

    /// Suppression decision for a KeyPress of `key_name`, which must already be
    /// recorded in `pressed_keys` (see `app/event.rs`). Rules:
    /// - a chord member that completes a fully-pressed chord is suppressed;
    /// - a modifier that starts/extends an incomplete chord is suppressed as prefix;
    /// - everything else (letters, digits, unrelated keys) is emitted normally.
    pub fn should_suppress_press(&self, key_name: &str) -> bool {
        if self.suppressed_chords.is_empty() {
            return false;
        }
        for chord in &self.suppressed_chords {
            let is_member = chord
                .iter()
                .any(|alts| alts.iter().any(|name| name == key_name));
            if !is_member {
                continue;
            }
            let pressed_positions = chord
                .iter()
                .filter(|alts| position_pressed(alts, &self.pressed_keys))
                .count();
            if pressed_positions == chord.len() {
                return true;
            }
        }
        if is_modifier_key_name(key_name) {
            for chord in &self.suppressed_chords {
                let is_member = chord
                    .iter()
                    .any(|alts| alts.iter().any(|name| name == key_name));
                if is_member
                    && chord
                        .iter()
                        .any(|alts| position_pressed(alts, &self.pressed_keys))
                {
                    return true;
                }
            }
        }
        false
    }

    /// A KeyRelease of `key_name` must stay hidden when its press was suppressed.
    /// Returns true (and consumes the tracked press) when the release is suppressed.
    pub fn take_suppressed_release(&mut self, key_name: &str) -> bool {
        if let Some(index) = self.suppressed_active.iter().position(|k| k == key_name) {
            self.suppressed_active.remove(index);
            true
        } else {
            false
        }
    }
    pub fn toggle_listener(&mut self, app: &tauri::AppHandle, toggle: &tauri::menu::MenuItem<Wry>) {
        self.listening = !self.listening;

        if self.listening {
            eprintln!("🟢 Listening enabled");
            toggle.set_text("Stop").unwrap();
            app.tray_by_id("keyviz-tray")
                .unwrap()
                .set_icon(Some(Image::from(include_image!("icons/tray.png"))))
                .unwrap();
        } else {
            eprintln!("🔴 Listening disabled");
            toggle.set_text("Start").unwrap();
            app.tray_by_id("keyviz-tray")
                .unwrap()
                .set_icon(Some(Image::from(include_image!("icons/tray-disabled.png"))))
                .unwrap();
        }

        app.emit_to("main", "listening-toggle", self.listening)
            .unwrap();
    }
}

#[derive(Debug, Deserialize)]
struct KeyEventStore {
    pub state: KeyEventState,
    // pub version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyEventState {
    // pub drag_threshold: u32,
    // pub filter_hotkeys: bool,
    // pub ignore_modifiers: Vec<String>,
    // pub show_event_history: bool,
    // pub max_history: u32,
    // pub linger_duration_ms: u32,
    // pub show_mouse_events: bool,
    pub toggle_shortcut: Vec<String>,
}

/// rdev key names treated as chord prefixes for suppression purposes.
pub fn is_modifier_key_name(name: &str) -> bool {
    matches!(
        name,
        "ControlLeft"
            | "ControlRight"
            | "ShiftLeft"
            | "ShiftRight"
            | "Alt"
            | "AltGr"
            | "MetaLeft"
            | "MetaRight"
    )
}

fn position_pressed(alts: &[String], pressed_keys: &[String]) -> bool {
    alts.iter()
        .any(|name| pressed_keys.iter().any(|pressed| pressed == name))
}

/// Normalize raw `suppressed_shortcuts` chords into canonical rdev key names.
/// See the full contract in `app/sidecar.rs`; unknown tokens are preserved as-is
/// (they simply never match a pressed key).
pub fn normalize_chords(raw_chords: &[Vec<String>]) -> Vec<SuppressedChord> {
    raw_chords
        .iter()
        .filter(|chord| !chord.is_empty())
        .map(|chord| {
            chord
                .iter()
                .map(|token| canonical_key_names(token))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Map one chord position token to the rdev `{:?}` key names it can match.
fn canonical_key_names(token: &str) -> Vec<String> {
    let raw = token.trim();
    if raw.is_empty() {
        return vec![raw.to_string()];
    }
    let lower = raw.to_ascii_lowercase();

    // Friendly aliases first.
    let aliased: &[&str] = match lower.as_str() {
        "control" | "ctrl" | "lcontrol" | "control_l" => &["ControlLeft", "ControlRight"],
        "rcontrol" | "control_r" => &["ControlRight"],
        "shift" | "lshift" | "shift_l" => &["ShiftLeft", "ShiftRight"],
        "rshift" | "shift_r" => &["ShiftRight"],
        "alt" | "lalt" | "alt_l" => &["Alt", "AltGr"],
        "ralt" | "alt_r" | "altgr" => &["AltGr"],
        "meta" | "super" | "win" | "windows" | "cmd" | "command" | "lmeta" => {
            &["MetaLeft", "MetaRight"]
        }
        "rmeta" => &["MetaRight"],
        "enter" => &["Return"],
        "esc" => &["Escape"],
        "del" => &["Delete"],
        "up" => &["UpArrow"],
        "down" => &["DownArrow"],
        "left" => &["LeftArrow"],
        "right" => &["RightArrow"],
        _ => &[],
    };
    if !aliased.is_empty() {
        return aliased.iter().map(|name| name.to_string()).collect();
    }

    // Structured rdev families (case-insensitive input, canonical output).
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() == 1 {
        let only = chars[0];
        if only.is_ascii_alphabetic() {
            return vec![format!("Key{}", only.to_ascii_uppercase())];
        }
        if only.is_ascii_digit() {
            return vec![format!("Num{only}")];
        }
    }
    if let Some(rest) = lower.strip_prefix("key") {
        if rest.len() == 1 && rest.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
            return vec![format!("Key{}", rest.to_ascii_uppercase())];
        }
    }
    if let Some(rest) = lower.strip_prefix("num") {
        if rest.len() == 1 && rest.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return vec![format!("Num{rest}")];
        }
    }
    if let Some(rest) = lower.strip_prefix("kp") {
        if rest.len() == 1 && rest.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return vec![format!("Kp{rest}")];
        }
    }
    if let Some(rest) = lower.strip_prefix('f') {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(number) = rest.parse::<u32>() {
                if (1..=24).contains(&number) {
                    return vec![format!("F{number}")];
                }
            }
        }
    }

    // Assume the caller already used exact rdev `{:?}` names (ControlLeft, KeyR,
    // F10, Return, ...). Case is preserved so exact matching still works.
    vec![raw.to_string()]
}

#[cfg(test)]
mod suppression_tests {
    use super::*;

    fn state_with_chords(raw: &[Vec<&str>]) -> AppState {
        let chords: Vec<Vec<String>> = raw
            .iter()
            .map(|chord| chord.iter().map(|k| k.to_string()).collect())
            .collect();
        AppState {
            suppressed_chords: normalize_chords(&chords),
            ..Default::default()
        }
    }

    fn press(state: &mut AppState, key: &str) -> bool {
        state.pressed_keys.push(key.to_string());
        let suppressed = state.should_suppress_press(key);
        if suppressed {
            // Mirror app/event.rs: a suppressed press is tracked for its release.
            state.suppressed_active.push(key.to_string());
        }
        suppressed
    }

    #[test]
    fn friendly_aliases_normalize_to_rdev_names() {
        let chords = normalize_chords(&[vec![
            "Ctrl".to_string(),
            "Alt".to_string(),
            "Shift".to_string(),
            "R".to_string(),
        ]]);
        assert_eq!(
            chords,
            vec![vec![
                vec!["ControlLeft".to_string(), "ControlRight".to_string()],
                vec!["Alt".to_string(), "AltGr".to_string()],
                vec!["ShiftLeft".to_string(), "ShiftRight".to_string()],
                vec!["KeyR".to_string()],
            ]]
        );
    }

    #[test]
    fn exact_rdev_names_pass_through() {
        let chords = normalize_chords(&[vec!["ControlLeft".to_string(), "KeyR".to_string(), "F10".to_string()]]);
        assert_eq!(
            chords,
            vec![vec![
                vec!["ControlLeft".to_string()],
                vec!["KeyR".to_string()],
                vec!["F10".to_string()],
            ]]
        );
    }

    #[test]
    fn full_chord_and_prefixes_are_suppressed() {
        let mut state = state_with_chords(&[vec!["Ctrl", "Alt", "Shift", "R"]]);
        // Every prefix key press stays hidden, in any order.
        assert!(press(&mut state, "ControlLeft"));
        assert!(press(&mut state, "Alt"));
        assert!(press(&mut state, "ShiftLeft"));
        // The completing key press is suppressed too.
        assert!(press(&mut state, "KeyR"));
    }

    #[test]
    fn suppressed_releases_stay_hidden_but_plain_release_is_kept() {
        let mut state = state_with_chords(&[vec!["Ctrl", "Alt", "Shift", "R"]]);
        assert!(press(&mut state, "ControlLeft"));
        assert!(press(&mut state, "Alt"));
        assert!(press(&mut state, "ShiftLeft"));
        assert!(press(&mut state, "KeyR"));

        assert!(state.take_suppressed_release("ControlLeft"));
        assert!(!state.take_suppressed_release("ControlLeft")); // single-shot
    }

    #[test]
    fn lone_letter_and_unrelated_keys_are_never_suppressed() {
        let mut state = state_with_chords(&[vec!["Ctrl", "Alt", "Shift", "R"]]);
        // A plain R press is a normal demo keystroke, not a chord member event.
        assert!(!press(&mut state, "KeyR"));
        assert!(!state.take_suppressed_release("KeyR"));

        // Ctrl held (prefix), then an unrelated key must still be emitted.
        let mut state = state_with_chords(&[vec!["Ctrl", "Alt", "Shift", "R"]]);
        assert!(press(&mut state, "ControlLeft"));
        assert!(!press(&mut state, "KeyV"));
        assert!(!state.take_suppressed_release("KeyV"));
        // ...and the Ctrl release stays hidden.
        assert!(state.take_suppressed_release("ControlLeft"));
    }

    #[test]
    fn completing_key_is_suppressed_regardless_of_press_order() {
        // User hits R while Ctrl+Alt+Shift are already held from a prefix window.
        let mut state = state_with_chords(&[vec!["Ctrl", "Alt", "Shift", "R"]]);
        assert!(press(&mut state, "ShiftRight"));
        assert!(press(&mut state, "ControlRight"));
        assert!(press(&mut state, "Alt"));
        // R completes the chord -> suppressed.
        assert!(press(&mut state, "KeyR"));
    }

    #[test]
    fn no_chords_means_no_suppression() {
        let mut state = AppState::default();
        assert!(!press(&mut state, "ControlLeft"));
        assert!(!press(&mut state, "KeyR"));
    }
}
