import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	DEFAULT_SHORTCUTS,
	mergeWithDefaults,
	RECORDING_SHORTCUT_ACTIONS,
	type RecordingShortcutsConfig,
	type ShortcutsConfig,
} from "@/lib/shortcuts";
export {
	DEFAULT_RECORDING_SHORTCUTS,
	RECORDING_SHORTCUT_ACTIONS,
	type RecordingShortcutAction,
	type RecordingShortcutsConfig,
} from "@/lib/shortcuts";
import { isMac as getIsMac } from "@/utils/platformUtils";

interface ShortcutsContextValue {
	shortcuts: ShortcutsConfig;
	recordingShortcuts: RecordingShortcutsConfig;
	isMac: boolean;
	setShortcuts: (config: ShortcutsConfig) => void;
	setRecordingShortcuts: (config: RecordingShortcutsConfig) => void;
	persistShortcuts: (
		config?: ShortcutsConfig,
		recordingConfig?: RecordingShortcutsConfig,
	) => Promise<void>;
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

function applySavedShortcuts(
	saved: Record<string, unknown>,
	setEditor: (config: ShortcutsConfig) => void,
	setRecording: (config: RecordingShortcutsConfig) => void,
): void {
	const looksLikeNewSchema = "editor" in saved || "recording" in saved;
	if (!looksLikeNewSchema) {
		setEditor(mergeWithDefaults(saved as Partial<ShortcutsConfig>));
		setRecording({ ...DEFAULT_RECORDING_SHORTCUTS });
		return;
	}

	const editor = saved.editor as Partial<ShortcutsConfig> | undefined;
	const recording = saved.recording as Partial<RecordingShortcutsConfig> | undefined;
	if (editor) {
		setEditor(mergeWithDefaults(editor));
	}
	setRecording(mergeRecordingWithDefaults(recording));
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
	const [shortcuts, setShortcuts] = useState<ShortcutsConfig>(DEFAULT_SHORTCUTS);
	const [recordingShortcuts, setRecordingShortcutsState] = useState<RecordingShortcutsConfig>(
		DEFAULT_RECORDING_SHORTCUTS,
	);
	const [isMac, setIsMac] = useState(false);
	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const receivedExternalSave = useRef(false);

	useEffect(() => {
		getIsMac()
			.then(setIsMac)
			.catch(() => undefined);

		void (async () => {
			try {
				const saved = await window.electronAPI?.getShortcuts?.();
				if (!saved || receivedExternalSave.current) return;
				applySavedShortcuts(saved, setShortcuts, setRecordingShortcutsState);
			} catch {
				return undefined;
			}
		})();
	}, []);

	useEffect(() => {
		const unsubscribe = window.electronAPI?.onShortcutsChanged?.((saved) => {
			receivedExternalSave.current = true;
			applySavedShortcuts(saved, setShortcuts, setRecordingShortcutsState);
		});
		return () => unsubscribe?.();
	}, []);

	const persistShortcuts = useCallback(
		async (config?: ShortcutsConfig, recordingConfig?: RecordingShortcutsConfig) => {
			const nextEditor = config ?? shortcuts;
			const nextRecording = recordingConfig ?? recordingShortcuts;
			const result = await window.electronAPI?.saveShortcuts?.({
				editor: nextEditor,
				recording: nextRecording,
			});
			if (result && !result.success) {
				throw new Error(result.error ?? "Failed to save shortcuts");
			}
			setShortcuts(nextEditor);
			setRecordingShortcutsState(nextRecording);
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
			isConfigOpen,
			openConfig,
			closeConfig,
		],
	);

	return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}
