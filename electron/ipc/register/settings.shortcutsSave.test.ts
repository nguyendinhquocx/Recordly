import { beforeEach, describe, expect, it, vi } from "vitest";

const { atomicWriteMock, browserWindowsMock, handleMock, onMock, readFileMock, writeFileMock } =
	vi.hoisted(() => ({
		atomicWriteMock: vi.fn(() => Promise.resolve()),
		browserWindowsMock: { getAllWindows: vi.fn(() => [] as unknown[]) },
		handleMock: vi.fn(),
		onMock: vi.fn(),
		readFileMock: vi.fn(),
		writeFileMock: vi.fn(),
	}));

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: (...args: unknown[]) => readFileMock(...args),
		writeFile: (...args: unknown[]) => writeFileMock(...args),
	},
	readFile: (...args: unknown[]) => readFileMock(...args),
	writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/mock/userData"), getVersion: vi.fn(() => "0.0.0-test") },
	BrowserWindow: {
		fromWebContents: vi.fn(() => null),
		getAllWindows: () => browserWindowsMock.getAllWindows(),
	},
	ipcMain: {
		handle: (...args: unknown[]) => handleMock(...args),
		on: (...args: unknown[]) => onMock(...args),
	},
}));

vi.mock("../constants", () => ({
	COUNTDOWN_SETTINGS_FILE: "/mock/countdown.json",
	RECORDINGS_SETTINGS_FILE: "/mock/recording-preferences.json",
	SHORTCUTS_FILE: "/mock/shortcuts.json",
}));

vi.mock("../project/atomicSave", () => ({
	writeProjectFileAtomically: (...args: unknown[]) => atomicWriteMock(...args),
}));

vi.mock("../settings/recordingPreferencesStore", () => ({
	createRecordingPreferencesStore: vi.fn(() => ({
		read: vi.fn(async () => ({})),
		update: vi.fn(async () => undefined),
	})),
}));

vi.mock("../state", () => ({
	countdownInProgress: false,
	countdownRemaining: null,
	setCountdownInProgress: vi.fn(),
	setCountdownRemaining: vi.fn(),
}));

vi.mock("../utils", () => ({
	parseJsonWithByteOrderMark: vi.fn((content: string) => JSON.parse(content)),
}));

vi.mock("../../appSettingsStore", () => ({
	hasAppSetting: vi.fn(() => false),
	readAppSettingsStore: vi.fn(() => ({})),
	writeAppSettingsStore: vi.fn(),
}));

vi.mock("../../countdownController", () => ({
	createCountdownController: vi.fn(() => ({ start: vi.fn(), cancel: vi.fn() })),
}));

vi.mock("../../cursorHider", () => ({
	hideCursor: vi.fn(() => true),
}));

vi.mock("../../windows", () => ({
	createCountdownWindow: vi.fn(() => null),
}));

import { registerSettingsHandlers } from "./settings";

function getSaveShortcutsHandler(): (shortcuts: unknown) => Promise<{
	success: boolean;
	error?: string;
}> {
	const entry = handleMock.mock.calls.find(([channel]) => channel === "save-shortcuts");
	if (!entry) {
		throw new Error("save-shortcuts handler was not registered");
	}
	// Handler thật có signature (event, shortcuts) — bind sẵn event=null khi gọi trực tiếp.
	const handler = entry[1] as (
		event: unknown,
		shortcuts: unknown,
	) => Promise<{ success: boolean; error?: string }>;
	return (shortcuts) => handler(null, shortcuts);
}

describe("save-shortcuts handler", () => {
	beforeEach(() => {
		handleMock.mockReset();
		onMock.mockReset();
		atomicWriteMock.mockReset().mockResolvedValue(undefined);
		readFileMock.mockReset();
		writeFileMock.mockReset();
		browserWindowsMock.getAllWindows.mockReset().mockReturnValue([]);
		registerSettingsHandlers();
	});

	it("persists through the atomic writer and broadcasts to every window", async () => {
		const broadcastWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
		browserWindowsMock.getAllWindows.mockReturnValue([broadcastWindow]);
		const shortcuts = {
			editor: { addZoom: { key: "z" } },
			recording: { start: { key: "r", ctrl: true, alt: true, shift: true } },
		};

		const result = await getSaveShortcutsHandler()(shortcuts);

		expect(result).toEqual({ success: true });
		expect(atomicWriteMock).toHaveBeenCalledWith(
			"/mock/shortcuts.json",
			JSON.stringify(shortcuts, null, 2),
		);
		expect(broadcastWindow.webContents.send).toHaveBeenCalledWith("shortcuts:changed", shortcuts);
	});

	it("skips destroyed windows when broadcasting", async () => {
		const destroyedWindow = { isDestroyed: () => true, webContents: { send: vi.fn() } };
		const liveWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
		browserWindowsMock.getAllWindows.mockReturnValue([destroyedWindow, liveWindow]);

		await getSaveShortcutsHandler()({ editor: {} });

		expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
		expect(liveWindow.webContents.send).toHaveBeenCalledWith("shortcuts:changed", {
			editor: {},
		});
	});

	it("fails without touching the target file directly when the atomic swap fails", async () => {
		atomicWriteMock.mockRejectedValue(new Error("disk full"));

		const result = await getSaveShortcutsHandler()({ editor: {} });

		expect(result).toEqual({ success: false, error: "Error: disk full" });
		expect(writeFileMock).not.toHaveBeenCalled();
	});
});
