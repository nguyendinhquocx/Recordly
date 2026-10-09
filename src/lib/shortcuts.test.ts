import { describe, expect, it } from "vitest";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	DEFAULT_SHORTCUTS,
	findRecordingShortcutConflict,
	FIXED_SHORTCUTS,
	hasGlobalRecordingModifier,
} from "./shortcuts";

describe("hasGlobalRecordingModifier", () => {
	it("requires Ctrl/Command or Alt, not just Shift", () => {
		expect(hasGlobalRecordingModifier({ key: "q" })).toBe(false);
		expect(hasGlobalRecordingModifier({ key: "q", shift: true })).toBe(false);
		expect(hasGlobalRecordingModifier({ key: "q", ctrl: true })).toBe(true);
		expect(hasGlobalRecordingModifier({ key: "q", alt: true })).toBe(true);
	});
});

describe("findRecordingShortcutConflict", () => {
	it("checks addZoom instead of excluding an editor action", () => {
		expect(
			findRecordingShortcutConflict(
				{ key: "z" },
				DEFAULT_SHORTCUTS,
				DEFAULT_RECORDING_SHORTCUTS,
				"start",
			),
		).toEqual({ type: "editor", action: "addZoom" });
	});

	it("rejects a fixed editor chord", () => {
		const tab = FIXED_SHORTCUTS[0]?.bindings[0];
		expect(tab).toBeDefined();
		if (!tab) return;

		expect(
			findRecordingShortcutConflict(
				tab,
				DEFAULT_SHORTCUTS,
				DEFAULT_RECORDING_SHORTCUTS,
				"start",
			),
		).toMatchObject({ type: "fixed" });
	});

	it("rejects another recording binding but allows the binding being edited", () => {
		const stopBinding = DEFAULT_RECORDING_SHORTCUTS.stop;
		expect(
			findRecordingShortcutConflict(
				stopBinding,
				DEFAULT_SHORTCUTS,
				DEFAULT_RECORDING_SHORTCUTS,
				"start",
			),
		).toEqual({ type: "recording", action: "stop" });

		expect(
			findRecordingShortcutConflict(
				DEFAULT_RECORDING_SHORTCUTS.start,
				DEFAULT_SHORTCUTS,
				DEFAULT_RECORDING_SHORTCUTS,
				"start",
			),
		).toBeNull();
	});
});
