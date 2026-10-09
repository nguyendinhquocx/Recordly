import { ipcMain, globalShortcut } from "electron";
import fs from "node:fs/promises";
import { getHudOverlayWindow } from "../windows";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	isSupportedGlobalShortcutKey,
} from "../../src/lib/shortcuts";
import { SHORTCUTS_FILE } from "./constants";
import { parseJsonWithByteOrderMark } from "./utils";

/**
 * Global recording hotkeys (start / stop / pause-resume) — Electron main process.
 *
 * - Persistence: cùng shortcuts.json với editor shortcuts. Schema mới:
 *     { "editor": ShortcutsConfig, "recording": { start, stop, pauseResume } }
 *   Schema cũ (flat ShortcutsConfig) được giữ làm editor config; recording hotkeys
 *   chưa lưu sẽ dùng chung defaults với renderer để UI và OS không lệch nhau.
 * - Trigger: hotkey khôi phục HUD (nếu minimized) rồi đẩy "recording-hotkey"
 *   tới HUD renderer để xử lý như bấm nút HUD — state luôn nhất quán.
 * - Register failure (accelerator bị app khác giữ) KHÔNG nuốt: trả về per-binding
 *   result để renderer hiển thị lỗi cạnh binding.
 */

export type RecordingHotkeyAction = "start" | "stop" | "pause-resume";

export interface ShortcutBindingLike {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export interface GlobalShortcutRegistration {
	action: RecordingHotkeyAction;
	binding: ShortcutBindingLike | null;
	accelerator: string | null;
	registered: boolean;
	/** "unset" = chưa cấu hình; "register_failed" = OS từ chối; "disabled" = tắt toàn cục. */
	code?: string;
}

export interface GlobalShortcutsSnapshot {
	recording: Partial<Record<RecordingHotkeyAction, ShortcutBindingLike>>;
	editor: Record<string, ShortcutBindingLike>;
}

const RECORDING_ACTIONS: RecordingHotkeyAction[] = ["start", "stop", "pause-resume"];

const KEY_TO_ACCELERATOR: Record<string, string> = {
	" ": "Space",
	space: "Space",
	enter: "Return",
	return: "Return",
	tab: "Tab",
	escape: "Escape",
	esc: "Escape",
	backspace: "Backspace",
	delete: "Delete",
	del: "Delete",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
	plus: "Plus",
	minus: "-",
};

/** ShortcutBinding (renderer) -> Electron accelerator. Trả null nếu key không hợp lệ. */
export function bindingToAccelerator(binding: ShortcutBindingLike): string | null {
	if (!binding || typeof binding.key !== "string" || binding.key.length === 0) {
		return null;
	}
	if (!binding.ctrl && !binding.alt) {
		return null;
	}
	if (!isSupportedGlobalShortcutKey(binding.key)) {
		return null;
	}
	const parts: string[] = [];
	if (binding.ctrl) parts.push("CommandOrControl");
	if (binding.alt) parts.push("Alt");
	if (binding.shift) parts.push("Shift");

	const normalizedKey = binding.key.toLowerCase();
	const mapped = KEY_TO_ACCELERATOR[normalizedKey];
	if (mapped) {
		parts.push(mapped);
	} else if (/^[a-z0-9]$/.test(normalizedKey)) {
		parts.push(normalizedKey.toUpperCase());
	} else if (/^f([1-9]|1\d|2[0-4])$/.test(normalizedKey)) {
		parts.push(normalizedKey.toUpperCase());
	} else {
		return null;
	}
	return parts.join("+");
}

export async function readGlobalShortcutsSnapshot(): Promise<GlobalShortcutsSnapshot> {
	try {
		const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<Record<string, unknown>>(data);
		if (!parsed || typeof parsed !== "object") {
			return { recording: DEFAULT_RECORDING_SHORTCUTS, editor: {} };
		}

		// Schema mới: { editor, recording }. Schema cũ: flat ShortcutsConfig.
		const looksLikeNewSchema = "editor" in parsed || "recording" in parsed;
		if (!looksLikeNewSchema) {
			return {
				recording: DEFAULT_RECORDING_SHORTCUTS,
				editor: parsed as Record<string, ShortcutBindingLike>,
			};
		}

		const editor =
			parsed.editor && typeof parsed.editor === "object"
				? (parsed.editor as Record<string, ShortcutBindingLike>)
				: {};
		const savedRecording =
			parsed.recording && typeof parsed.recording === "object"
				? (parsed.recording as Partial<
						Record<RecordingHotkeyAction, ShortcutBindingLike | null>
				  >)
				: {};
		const recording = { ...DEFAULT_RECORDING_SHORTCUTS };
		for (const action of RECORDING_ACTIONS) {
			const binding = savedRecording[action];
			if (binding && typeof binding.key === "string" && binding.key.length > 0) {
				recording[action] = binding;
			}
		}
		return { editor, recording };
	} catch {
		return { recording: DEFAULT_RECORDING_SHORTCUTS, editor: {} };
	}
}

let registeredAccelerators = new Map<RecordingHotkeyAction, string>();
/** webContents.id -> số suspend đang mở từ contents đó; -1 cho lời gọi không có owner. */
const suspensionCounts = new Map<number, number>();
let lastRegistrationResults: GlobalShortcutRegistration[] = [];

const OWNERLESS_SUSPENDER_ID = -1;

function totalOpenSuspensions(): number {
	let total = 0;
	for (const count of suspensionCounts.values()) {
		total += count;
	}
	return total;
}

function unregisterRegisteredAccelerators(): void {
	for (const [, oldAccelerator] of registeredAccelerators) {
		try {
			if (globalShortcut.isRegistered(oldAccelerator)) {
				globalShortcut.unregister(oldAccelerator);
			}
		} catch {
			/* ignore */
		}
	}
	registeredAccelerators = new Map();
}

function dispatchToHud(action: RecordingHotkeyAction): void {
	const hud = getHudOverlayWindow();
	if (!hud || hud.isDestroyed()) {
		return;
	}
	if (hud.isMinimized()) {
		hud.restore();
	}
	hud.webContents.send("recording-hotkey", action);
}

export async function registerGlobalRecordingShortcuts(): Promise<GlobalShortcutRegistration[]> {
	if (totalOpenSuspensions() > 0) {
		return lastRegistrationResults;
	}
	unregisterRegisteredAccelerators();

	const snapshot = await readGlobalShortcutsSnapshot();
	if (totalOpenSuspensions() > 0) {
		return lastRegistrationResults;
	}
	const results: GlobalShortcutRegistration[] = [];

	for (const action of RECORDING_ACTIONS) {
		const binding = snapshot.recording[action];
		if (!binding) {
			results.push({
				action,
				binding: null,
				accelerator: null,
				registered: false,
				code: "unset",
			});
			continue;
		}

		const accelerator = bindingToAccelerator(binding);
		if (!accelerator) {
			results.push({ action, binding, accelerator: null, registered: false, code: "invalid" });
			continue;
		}

		let registered = false;
		try {
			registered = globalShortcut.register(accelerator, () => {
				dispatchToHud(action);
			});
		} catch {
			registered = false;
		}

		if (registered) {
			registeredAccelerators.set(action, accelerator);
		}
		results.push({
			action,
			binding,
			accelerator,
			registered,
			code: registered ? undefined : "register_failed",
		});
	}

	lastRegistrationResults = results;
	return results;
}

/** Temporarily release hotkeys so capture-mode dialogs can receive the chords. */
export function suspendGlobalRecordingShortcuts(ownerId?: number): void {
	const id = typeof ownerId === "number" ? ownerId : OWNERLESS_SUSPENDER_ID;
	suspensionCounts.set(id, (suspensionCounts.get(id) ?? 0) + 1);
	if (totalOpenSuspensions() === 1) {
		unregisterRegisteredAccelerators();
	}
}

/** Re-register after the final chord-capture surface closes. */
export async function resumeGlobalRecordingShortcuts(
	ownerId?: number,
): Promise<GlobalShortcutRegistration[]> {
	const id = typeof ownerId === "number" ? ownerId : OWNERLESS_SUSPENDER_ID;
	const openCount = suspensionCounts.get(id) ?? 0;
	if (openCount <= 1) {
		suspensionCounts.delete(id);
	} else {
		suspensionCounts.set(id, openCount - 1);
	}
	return totalOpenSuspensions() === 0 ? registerGlobalRecordingShortcuts() : lastRegistrationResults;
}

/**
 * Renderer chết giữa lúc capture chord sẽ không bao giờ gửi resume tương ứng;
 * khi owner cuối cùng biến mất, tự nhả suspension và đăng ký lại hotkeys
 * thay vì để chúng chết im lặng đến khi restart app.
 * Trả true nếu contents này thực sự đang giữ suspension.
 */
export async function handleRendererProcessGone(contentsId: number): Promise<boolean> {
	if (!suspensionCounts.delete(contentsId)) {
		return false;
	}
	if (totalOpenSuspensions() === 0) {
		await registerGlobalRecordingShortcuts();
	}
	return true;
}

/** Gỡ các accelerator do module này đăng ký khi app quit; không đụng module khác. */
export function unregisterAllGlobalRecordingShortcuts(): void {
	suspensionCounts.clear();
	unregisterRegisteredAccelerators();
	lastRegistrationResults = [];
}

export function registerGlobalShortcutIpcHandlers(): void {
	ipcMain.handle("global-shortcuts:register", async () => registerGlobalRecordingShortcuts());
	ipcMain.on("global-shortcuts:suspend", (event) => {
		suspendGlobalRecordingShortcuts(event.sender.id);
		event.returnValue = true;
	});
	ipcMain.handle("global-shortcuts:resume", async (event) =>
		resumeGlobalRecordingShortcuts(event.sender.id),
	);
	ipcMain.handle("global-shortcuts:read", async () => readGlobalShortcutsSnapshot());
}
