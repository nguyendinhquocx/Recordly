import { BrowserWindow, app, ipcMain } from "electron";
import {
	bindingToSidecarChord,
	getKeyvizSidecarController,
	type KeyvizStatus,
	type SidecarChord,
} from "../keyvizSidecar";

/**
 * IPC cho Keyviz sidecar. Renderer KHÔNG bao giờ đụng process/OS trực tiếp —
 * chỉ gọi typed IPC; controller sống ở main process.
 */

function normalizeChords(input: unknown): SidecarChord[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const chords: SidecarChord[] = [];
	for (const raw of input) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const binding = raw as { key?: unknown; ctrl?: unknown; shift?: unknown; alt?: unknown };
		if (typeof binding.key !== "string" || binding.key.length === 0) {
			continue;
		}
		chords.push(
			bindingToSidecarChord({
				key: binding.key,
				ctrl: binding.ctrl === true,
				shift: binding.shift === true,
				alt: binding.alt === true,
			}),
		);
	}
	return chords;
}

export function registerKeyvizSidecarHandlers(): void {
	const controller = getKeyvizSidecarController();

	// Push state changes tới mọi renderer window (HUD là consumer chính).
	controller.onStateChange((status: KeyvizStatus) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) {
				window.webContents.send("keyviz:state-changed", status);
			}
		}
	});

	// Nhả sidecar khi app thoát — không để process mồ côi.
	app.on("before-quit", () => {
		void controller.dispose();
	});

	ipcMain.handle("keyviz:get-status", (): KeyvizStatus => controller.getStatus());

	ipcMain.handle("keyviz:prepare-capture", async (_event, suppressed: unknown) => {
		return controller.prepareCapture(normalizeChords(suppressed));
	});

	ipcMain.handle("keyviz:release", async () => {
		await controller.stop("renderer-release");
		return { success: true };
	});

	ipcMain.handle("keyviz:open-settings", async () => {
		return controller.openSettings();
	});
}
