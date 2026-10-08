import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	DEFAULT_SHORTCUTS,
	mergeWithDefaults,
	type ShortcutBinding,
	type ShortcutsConfig,
} from "@/lib/shortcuts";
import { isMac as getIsMac } from "@/utils/platformUtils";

/** 3 global recording hotkeys (start/stop/pause-resume) — schema mới của shortcuts.json. */
export interface RecordingShortcutsConfig {
	start: ShortcutBinding;
	stop: ShortcutBinding;
	"pause-resume": ShortcutBinding;
}

export const RECORDING_SHORTCUT_ACTIONS = ["start", "stop", "pause-resume"] as const;
export type RecordingShortcutAction = (typeof RECORDING_SHORTCUT_ACTIONS)[number];

/** Hotkey mặc định theo spec: Ctrl+Alt+Shift+R / S / P (Windows). */
export const DEFAULT_RECORDING_SHORTCUTS: RecordingShortcutsConfig = {
	start: { key: "r", ctrl: true, alt: true, shift: true },
	stop: { key: "s", ctrl: true, alt: true, shift: true },
	"pause-resume": { key: "p", ctrl: true, alt: true, shift: true },
};

interface ShortcutsContextValue {
	shortcuts: ShortcutsConfig;
	recordingShortcuts: RecordingShortcutsConfig;
	isMac: boolean;
	setShortcuts: (config: ShortcutsConfig) => void;
	setRecordingShortcuts: (config: RecordingShortcutsConfig) => void;
	persistShortcuts: (config?: ShortcutsConfig) => Promise<void>;
	persistRecordingShortcuts: (config?: RecordingShortcutsConfig) => Promise<void>;
	isConfigOpen: boolean;
	openConfig: () => void;
	closeConfig: () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function useShortcuts(): ShortcutsContextValue {
	const ctx = useContext(ShortcutsContext);
	if (!ctx) throw new Error("useShortcuts must be used within <ShortcutsProvider>");
	return ctx;
}

function mergeRecordingWithDefaults(
	partial: Partial<RecordingShortcutsConfig> | undefined,
): RecordingShortcutsConfig {
	const merged: RecordingShortcutsConfig = { ...DEFAULT_RECORDING_SHORTCUTS };
	if (partial) {
		for (const action of RECORDING_SHORTCUT_ACTIONS) {
			if (partial[action]) {
				merged[action] = partial[action];
			}
		}
	}
	return merged;
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
	const [shortcuts, setShortcuts] = useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
	const [recordingShortcuts, setRecordingShortcutsState] = useState<RecordingShortcutsConfig>(
		DEFAULT_RECORDING_SHORTCUTS,
	);
	const [isMac, setIsMac] = useState(false);
	const [isConfigOpen, setIsConfigOpen] = useState(false);

	useEffect(() => {
		getIsMac()
			.then(setIsMac)
			.catch(() => undefined);

		void (async () => {
			try {
				const saved = await window.electronAPI?.getShortcuts?.();
				if (!saved) return;
				// Schema mới: { editor, recording }. Schema cũ (flat) coi như editor-only.
				const looksLikeNewSchema = "editor" in saved || "recording" in saved;
				if (looksLikeNewSchema) {
					const editor = (saved as { editor?: Partial<ShortcutsConfig> }).editor;
					const recording = (
						saved as { recording?: Partial<RecordingShortcutsConfig> }
					).recording;
					if (editor) {
						setShortcuts(mergeWithDefaults(editor));
					}
					setRecordingShortcutsState(mergeRecordingWithDefaults(recording));
				} else {
					setShortcuts(mergeWithDefaults(saved as Partial<ShortcutsConfig>));
				}
			} catch {
				return undefined;
			}
		})();
	}, []);

	const persistShortcuts = useCallback(
		async (config?: ShortcutsConfig) => {
			const nextEditor = config ?? shortcuts;
			// Gửi full schema mới; giữ nguyên recording hiện tại.
			await window.electronAPI?.saveShortcuts?.({
				editor: nextEditor,
				recording: recordingShortcuts,
			});
			if (config) {
				setShortcuts(config);
			}
		},
		[shortcuts, recordingShortcuts],
	);

	const persistRecordingShortcuts = useCallback(
		async (config?: RecordingShortcutsConfig) => {
			const nextRecording = config ?? recordingShortcuts;
			await window.electronAPI?.saveShortcuts?.({
				editor: shortcuts,
				recording: nextRecording,
			});
			if (config) {
				setRecordingShortcutsState(config);
			}
		},
		[shortcuts, recordingShortcuts],
	);

	const setRecordingShortcuts = useCallback((config: RecordingShortcutsConfig) => {
		setRecordingShortcutsState(config);
	}, []);

	const openConfig = useCallback(() => setIsConfigOpen(true), []);
	const closeConfig = useCallback(() => setIsConfigOpen(false), []);

	const value = useMemo<ShortcutsContextValue>(
		() => ({
			shortcuts,
			recordingShortcuts,
			isMac,
			setShortcuts,
			setRecordingShortcuts,
			persistShortcuts,
			persistRecordingShortcuts,
			isConfigOpen,
			openConfig,
			closeConfig,
		}),
		[
			shortcuts,
			recordingShortcuts,
			isMac,
			setRecordingShortcuts,
			persistShortcuts,
			persistRecordingShortcuts,
			isConfigOpen,
			openConfig,
			closeConfig,
		],
	);

	return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
