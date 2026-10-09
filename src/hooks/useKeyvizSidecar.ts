import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShortcutBinding } from "@/lib/shortcuts";

/**
 * Quản lý Keyviz sidecar từ renderer: toggle bật/tắt (nhớ lựa chọn),
 * chuẩn bị capture trước khi record (kèm dialog retry/skip/cancel khi lỗi),
 * phát hiện sidecar rớt giữa recording.
 *
 * Preference lưu qua appSettingsStore ("keyviz.enabled", mặc định true).
 * Controller thật sống ở main process — renderer chỉ gọi typed IPC.
 */

export type KeyvizSidecarUiState =
	| "idle"
	| "starting"
	| "ready"
	| "capturing"
	| "stopping"
	| "failed"
	| "exited";

export interface KeyvizPrepareOutcome {
	mode: "off" | "ok" | "skipped" | "cancelled";
}

interface PendingDecision {
	code: string;
	message: string;
	resolve: (decision: "retry" | "skip" | "cancel") => void;
}

const KEYVIZ_ENABLED_SETTING_KEY = "keyviz.enabled";
const SIDECAR_STATUS_POLL_MS = 2_000;

export function shouldReportUnexpectedKeyvizExit(
	currentState: KeyvizSidecarUiState,
	nextState: KeyvizSidecarUiState,
	releaseRequested: boolean,
): boolean {
	return (
		!releaseRequested &&
		currentState === "capturing" &&
		(nextState === "exited" || nextState === "failed")
	);
}

type KeyvizStatusPayload = {
	supported: boolean;
	state: KeyvizSidecarUiState;
	binaryFound: boolean;
};

export function useKeyvizSidecar() {
	const recordingShortcutsRef = useRef<ShortcutBinding[]>([]);

	const [enabled, setEnabledState] = useState<boolean | null>(null);
	const [supported, setSupported] = useState(false);
	const [uiState, setUiState] = useState<KeyvizSidecarUiState>("idle");
	const [unexpectedExit, setUnexpectedExit] = useState(false);
	const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
	const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
	const stateRef = useRef<KeyvizSidecarUiState>("idle");
	const releaseRequestedRef = useRef(false);
	stateRef.current = uiState;

	useEffect(() => {
		void window.electronAPI?.keyvizGetStatus?.()
			.then((status) => setSupported(status.supported))
			.catch(() => setSupported(false));
	}, []);

	// Nạp preference lần đầu (null = chưa set = mặc định bật theo spec).
	useEffect(() => {
		const stored = window.electronAPI?.getAppSetting?.(KEYVIZ_ENABLED_SETTING_KEY);
		setEnabledState(stored === null || stored === undefined ? true : stored === true);
	}, []);

	// Cho phép HUD cập nhật danh sách shortcut cần lọc khỏi overlay trước mỗi lần quay.
	const setSuppressedShortcuts = useCallback((bindings: ShortcutBinding[]) => {
		recordingShortcutsRef.current = bindings;
	}, []);

	// Theo dõi trạng thái sidecar đẩy từ main.
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onKeyvizStateChanged?.((status) => {
			const payload = status as KeyvizStatusPayload;
			if (
				shouldReportUnexpectedKeyvizExit(
					stateRef.current,
					payload.state,
					releaseRequestedRef.current,
				)
			) {
				setUnexpectedExit(true);
			}
			setUiState(payload.state);
		});
		return () => unsubscribe?.();
	}, []);

	// Phát hiện sidecar rớt giữa recording: state capturing nhưng process đã exited.
	useEffect(() => {
		if (uiState !== "capturing") {
			if (pollTimer.current) {
				clearInterval(pollTimer.current);
				pollTimer.current = null;
			}
			return;
		}
		pollTimer.current = setInterval(() => {
			void window.electronAPI?.keyvizGetStatus?.().then((status) => {
				const payload = status as KeyvizStatusPayload;
				if (releaseRequestedRef.current) return;
				if (payload.state === "exited" || payload.state === "failed") {
					setUiState(payload.state);
					if (
						shouldReportUnexpectedKeyvizExit(
							stateRef.current,
							payload.state,
							releaseRequestedRef.current,
						)
					) {
						setUnexpectedExit(true);
					}
				}
			});
		}, SIDECAR_STATUS_POLL_MS);
		return () => {
			if (pollTimer.current) {
				clearInterval(pollTimer.current);
				pollTimer.current = null;
			}
		};
	}, [uiState]);

	const setEnabled = useCallback((next: boolean) => {
		setEnabledState(next);
		window.electronAPI?.setAppSetting?.(KEYVIZ_ENABLED_SETTING_KEY, next);
	}, []);

	/** Vòng chuẩn bị: start_capture → lỗi thì hỏi user retry/skip/cancel → lặp. */
	const prepareForRecording = useCallback(async (): Promise<KeyvizPrepareOutcome> => {
		if (enabled === false) {
			return { mode: "off" };
		}

		releaseRequestedRef.current = false;
		let isSupported = supported;
		if (!isSupported) {
			try {
				const status = await window.electronAPI?.keyvizGetStatus?.();
				isSupported = status?.supported === true;
				setSupported(isSupported);
			} catch {
				isSupported = false;
			}
		}
		if (!isSupported) {
			return { mode: "off" };
		}

		// eslint-disable-next-line no-constant-condition
		while (true) {
			setUiState("starting");
			let result: { ok: boolean; code?: string; message?: string };
			try {
				result = await window.electronAPI.keyvizPrepareCapture(recordingShortcutsRef.current);
			} catch (error) {
				result = { ok: false, code: "ipc_error", message: String(error) };
			}

			if (result.ok) {
				try {
					const status = await window.electronAPI?.keyvizGetStatus?.();
					if (status && status.state !== "capturing") {
						result = {
							ok: false,
							code: "capture_failed",
							message: "The sidecar exited immediately after the capture handshake.",
						};
					}
				} catch {
					// The prepare IPC succeeded; status is an extra race guard only.
				}
				if (result.ok) {
					setUiState("capturing");
					return { mode: "ok" };
				}
			}

			// Hỏi user qua dialog: retry / quay không Keyviz / hủy.
			const decision = await new Promise<"retry" | "skip" | "cancel">((resolve) => {
				setPendingDecision({
					code: result.code ?? "unknown",
					message: result.message ?? "Unknown error",
					resolve,
				});
			});
			setPendingDecision(null);

			if (decision === "skip") {
				setUiState("idle");
				return { mode: "skipped" };
			}
			if (decision === "cancel") {
				setUiState("idle");
				return { mode: "cancelled" };
			}
			// retry → lặp lại start_capture.
		}
	}, [enabled, supported]);

	/** Nhả sidecar: pause/stop/cancel/app exit đều gọi. Idempotent. */
	const release = useCallback(async () => {
		releaseRequestedRef.current = true;
		setUiState("idle");
		setUnexpectedExit(false);
		try {
			await window.electronAPI?.keyvizRelease?.();
		} catch {
			/* process sẽ tự thoát qua stdin EOF nếu IPC lỗi */
		}
	}, []);

	const openSettings = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
		try {
			return (
				(await window.electronAPI?.keyvizOpenSettings?.()) ?? {
					success: false,
					error: "unavailable",
				}
			);
		} catch (error) {
			return { success: false, error: String(error) };
		}
	}, []);

	/** Xử lý sidecar rớt giữa recording từ UI: dừng-lưu hoặc tiếp tục không overlay. */
	const resolveUnexpectedExit = useCallback(
		async (action: "stop-recording" | "continue-without") => {
			setUnexpectedExit(false);
			await release();
			return action;
		},
		[release],
	);

	return useMemo(
		() => ({
			enabled,
			supported,
			setEnabled,
			uiState,
			unexpectedExit,
			pendingDecision,
			setSuppressedShortcuts,
			prepareForRecording,
			release,
			openSettings,
			resolveUnexpectedExit,
		}),
		[
			enabled,
			supported,
			setEnabled,
			uiState,
			unexpectedExit,
			pendingDecision,
			setSuppressedShortcuts,
			prepareForRecording,
			release,
			openSettings,
			resolveUnexpectedExit,
		],
	);
}

export type KeyvizSidecarControl = ReturnType<typeof useKeyvizSidecar>;
