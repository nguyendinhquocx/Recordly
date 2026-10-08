import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileMock, globalShortcutMock } = vi.hoisted(() => ({
	readFileMock: vi.fn(),
	globalShortcutMock: {
		register: vi.fn(() => true),
		unregister: vi.fn(),
		isRegistered: vi.fn(() => false),
		unregisterAll: vi.fn(),
	},
}));

vi.mock("node:fs/promises", () => ({
	default: { readFile: (...args: unknown[]) => readFileMock(...args) },
	readFile: (...args: unknown[]) => readFileMock(...args),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/mock/userData") },
	globalShortcut: globalShortcutMock,
	ipcMain: { handle: vi.fn() },
}));

vi.mock("../../windows", () => ({
	getHudOverlayWindow: () => null,
}));

import {
	bindingToAccelerator,
	registerGlobalRecordingShortcuts,
	unregisterAllGlobalRecordingShortcuts,
} from "./globalShortcuts";

function mockShortcutsFile(content: unknown): void {
	readFileMock.mockResolvedValue(typeof content === "string" ? content : JSON.stringify(content));
}

describe("bindingToAccelerator", () => {
	it("maps ctrl+alt+shift+r to Electron accelerator", () => {
		expect(bindingToAccelerator({ key: "r", ctrl: true, alt: true, shift: true })).toBe(
			"CommandOrControl+Alt+Shift+R",
		);
	});

	it("maps space and function keys", () => {
		expect(bindingToAccelerator({ key: " " })).toBe("Space");
		expect(bindingToAccelerator({ key: "F10", shift: true })).toBe("Shift+F10");
	});

	it("returns null for unsupported keys", () => {
		expect(bindingToAccelerator({ key: "" })).toBeNull();
		expect(bindingToAccelerator({ key: "some weird key" })).toBeNull();
	});
});

describe("registerGlobalRecordingShortcuts", () => {
	beforeEach(() => {
		readFileMock.mockReset();
		globalShortcutMock.register.mockClear().mockReturnValue(true);
		globalShortcutMock.unregister.mockClear();
		globalShortcutMock.isRegistered.mockClear().mockReturnValue(false);
		globalShortcutMock.unregisterAll.mockClear();
		unregisterAllGlobalRecordingShortcuts();
	});

	it("reports unset when no recording hotkeys are configured (legacy flat schema)", async () => {
		mockShortcutsFile({ addZoom: { key: "z" } });
		const results = await registerGlobalRecordingShortcuts();

		expect(results).toHaveLength(3);
		for (const result of results) {
			expect(result.registered).toBe(false);
			expect(result.code).toBe("unset");
		}
		expect(globalShortcutMock.register).not.toHaveBeenCalled();
	});

	it("registers configured hotkeys with correct accelerators", async () => {
		mockShortcutsFile({
			editor: { playPause: { key: " " } },
			recording: {
				start: { key: "r", ctrl: true, alt: true, shift: true },
				stop: { key: "s", ctrl: true, alt: true, shift: true },
				"pause-resume": { key: "p", ctrl: true, alt: true, shift: true },
			},
		});
		const results = await registerGlobalRecordingShortcuts();

		expect(results.map((result) => result.registered)).toEqual([true, true, true]);
		expect(globalShortcutMock.register).toHaveBeenCalledWith(
			"CommandOrControl+Alt+Shift+R",
			expect.any(Function),
		);
		expect(globalShortcutMock.register).toHaveBeenCalledWith(
			"CommandOrControl+Alt+Shift+S",
			expect.any(Function),
		);
	});

	it("surfaces register failures instead of swallowing them", async () => {
		mockShortcutsFile({
			recording: {
				start: { key: "r", ctrl: true, alt: true, shift: true },
			},
		});
		globalShortcutMock.register.mockReturnValue(false);
		const results = await registerGlobalRecordingShortcuts();

		expect(results[0]).toMatchObject({
			action: "start",
			registered: false,
			code: "register_failed",
			accelerator: "CommandOrControl+Alt+Shift+R",
		});
		expect(results[1].code).toBe("unset");
	});

	it("unregisters previous accelerators when re-registering with new config", async () => {
		mockShortcutsFile({
			recording: { start: { key: "r", ctrl: true, alt: true, shift: true } },
		});
		globalShortcutMock.isRegistered.mockReturnValue(true);
		await registerGlobalRecordingShortcuts();

		mockShortcutsFile({
			recording: { start: { key: "t", ctrl: true, alt: true, shift: true } },
		});
		await registerGlobalRecordingShortcuts();

		expect(globalShortcutMock.unregister).toHaveBeenCalledWith("CommandOrControl+Alt+Shift+R");
		expect(globalShortcutMock.register).toHaveBeenLastCalledWith(
			"CommandOrControl+Alt+Shift+T",
			expect.any(Function),
		);
	});

	it("handles missing shortcuts file gracefully", async () => {
		readFileMock.mockRejectedValue(new Error("ENOENT"));
		const results = await registerGlobalRecordingShortcuts();
		expect(results.every((result) => result.code === "unset")).toBe(true);
	});
});
