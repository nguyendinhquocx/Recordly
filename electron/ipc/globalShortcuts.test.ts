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

vi.mock("../windows", () => ({
	getHudOverlayWindow: () => null,
}));

import {
	bindingToAccelerator,
	handleRendererProcessGone,
	registerGlobalRecordingShortcuts,
	resumeGlobalRecordingShortcuts,
	suspendGlobalRecordingShortcuts,
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

	it("requires a safe modifier and maps space/function keys", () => {
		expect(bindingToAccelerator({ key: " " })).toBeNull();
		expect(bindingToAccelerator({ key: "q" })).toBeNull();
		expect(bindingToAccelerator({ key: " ", ctrl: true })).toBe(
			"CommandOrControl+Space",
		);
		expect(bindingToAccelerator({ key: "F10", ctrl: true, shift: true })).toBe(
			"CommandOrControl+Shift+F10",
		);
	});

	it("returns null for unsupported keys", () => {
		expect(bindingToAccelerator({ key: "" })).toBeNull();
		expect(bindingToAccelerator({ key: "some weird key", ctrl: true })).toBeNull();
		expect(bindingToAccelerator({ key: "insert", ctrl: true })).toBeNull();
		expect(bindingToAccelerator({ key: "+", ctrl: true })).toBeNull();
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

	it("registers defaults when the saved config is a legacy flat schema", async () => {
		mockShortcutsFile({ addZoom: { key: "z" } });
		const results = await registerGlobalRecordingShortcuts();

		expect(results.map((result) => result.action)).toEqual(["start", "stop", "pause-resume"]);
		expect(results.map((result) => result.registered)).toEqual([true, true, true]);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(3);
	});

	it("falls back to defaults for null bindings in malformed config", async () => {
		mockShortcutsFile({
			recording: { start: null, stop: null, "pause-resume": null },
		});
		const results = await registerGlobalRecordingShortcuts();

		expect(results.map((result) => result.registered)).toEqual([true, true, true]);
		expect(globalShortcutMock.register).toHaveBeenCalledWith(
			"CommandOrControl+Alt+Shift+R",
			expect.any(Function),
		);
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
		expect(results[1].code).toBe("register_failed");
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
		expect(globalShortcutMock.register).toHaveBeenCalledWith(
			"CommandOrControl+Alt+Shift+T",
			expect.any(Function),
		);
	});

	it("suspends tracked accelerators during chord capture and restores them after", async () => {
		mockShortcutsFile({});
		await registerGlobalRecordingShortcuts();
		const registeredCallsBeforeSuspend = globalShortcutMock.register.mock.calls.length;
		globalShortcutMock.isRegistered.mockReturnValue(true);

		suspendGlobalRecordingShortcuts();
		const suspendedResults = await registerGlobalRecordingShortcuts();
		expect(globalShortcutMock.unregister).toHaveBeenCalledTimes(3);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(registeredCallsBeforeSuspend);
		expect(suspendedResults).toHaveLength(3);

		const resumedResults = await resumeGlobalRecordingShortcuts();
		expect(resumedResults.map((result) => result.registered)).toEqual([true, true, true]);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(registeredCallsBeforeSuspend + 3);
		expect(globalShortcutMock.unregisterAll).not.toHaveBeenCalled();
	});

	it("registers default hotkeys when no shortcuts file exists", async () => {
		readFileMock.mockRejectedValue(new Error("ENOENT"));
		const results = await registerGlobalRecordingShortcuts();
		expect(results.map((result) => result.registered)).toEqual([true, true, true]);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(3);
	});
});

describe("suspension leak recovery", () => {
	beforeEach(() => {
		readFileMock.mockReset();
		globalShortcutMock.register.mockClear().mockReturnValue(true);
		globalShortcutMock.unregister.mockClear();
		globalShortcutMock.isRegistered.mockClear().mockReturnValue(false);
		globalShortcutMock.unregisterAll.mockClear();
		unregisterAllGlobalRecordingShortcuts();
	});

	it("ignores renderer exits that never suspended hotkeys", async () => {
		await expect(handleRendererProcessGone(99)).resolves.toBe(false);
		expect(globalShortcutMock.register).not.toHaveBeenCalled();
	});

	it("re-registers hotkeys when the suspending renderer dies mid chord-capture", async () => {
		mockShortcutsFile({});
		await registerGlobalRecordingShortcuts();
		const callsBefore = globalShortcutMock.register.mock.calls.length;
		globalShortcutMock.isRegistered.mockReturnValue(true);

		suspendGlobalRecordingShortcuts(7);
		await expect(handleRendererProcessGone(7)).resolves.toBe(true);

		expect(globalShortcutMock.unregister).toHaveBeenCalledTimes(3);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(callsBefore + 3);
	});

	it("keeps suspension while another capture surface is still open", async () => {
		mockShortcutsFile({});
		await registerGlobalRecordingShortcuts();
		const callsBefore = globalShortcutMock.register.mock.calls.length;

		suspendGlobalRecordingShortcuts(1);
		suspendGlobalRecordingShortcuts(2);
		await expect(handleRendererProcessGone(1)).resolves.toBe(true);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(callsBefore);

		await resumeGlobalRecordingShortcuts(2);
		expect(globalShortcutMock.register).toHaveBeenCalledTimes(callsBefore + 3);
	});
});
