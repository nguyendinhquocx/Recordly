import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/i18n/config";
import { FIXED_SHORTCUTS, SHORTCUT_LABELS } from "./shortcuts";

const localesDir = path.resolve(process.cwd(), "src", "i18n", "locales");
const localeDirs = readdirSync(localesDir).filter((entry) =>
	statSync(path.join(localesDir, entry)).isDirectory(),
);

function referencedShortcutKeys(): string[] {
	return [
		...Object.values(SHORTCUT_LABELS),
		...FIXED_SHORTCUTS.map((fixed) => fixed.label),
	];
}

describe("shortcut i18n key parity", () => {
	it("discovers exactly the shipped locale directories including vi and ru", () => {
		expect(localeDirs.sort()).toEqual([
			"de",
			"en",
			"es",
			"fr",
			"it",
			"ko",
			"nl",
			"pt-BR",
			"ru",
			"vi",
			"zh-CN",
			"zh-TW",
		]);
	});

	it("registers vi in the runtime locale list without registering ru", () => {
		expect(SUPPORTED_LOCALES).toContain("vi");
		expect(SUPPORTED_LOCALES).not.toContain("ru");
		expect(SUPPORTED_LOCALES[0]).toBe("en");
		expect(INITIAL_DEFAULT_LOCALE).toBe("vi");
	});

	it("resolves every referenced shortcut key in every locale directory", () => {
		const keys = referencedShortcutKeys();

		expect(keys.length).toBeGreaterThan(0);
		expect(new Set(keys).size).toBe(keys.length);

		for (const locale of localeDirs) {
			const shortcuts = JSON.parse(
				readFileSync(path.join(localesDir, locale, "shortcuts.json"), "utf8"),
			) as Record<string, Record<string, string>>;

			for (const key of keys) {
				const action = key.split(".").pop();
				const value = shortcuts.actions?.[action];

				expect(value, `${locale}/shortcuts.json is missing "${key}"`).toBeTruthy();
				expect(typeof value).toBe("string");
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});

	it("keeps English values for the fixed shortcut keys", () => {
		const en = JSON.parse(
			readFileSync(path.join(localesDir, "en", "shortcuts.json"), "utf8"),
		) as Record<string, Record<string, string>>;

		expect(en.actions.cycleForward).toBe("Cycle Annotations Forward");
		expect(en.actions.cycleBackward).toBe("Cycle Annotations Backward");
		expect(en.actions.deleteSelectedAlt).toBe("Delete Selected (alt)");
		expect(en.actions.panTimeline).toBe("Pan Timeline");
		expect(en.actions.zoomTimeline).toBe("Zoom Timeline");
	});

	it("translates the configurable action labels into Vietnamese", () => {
		const vi = JSON.parse(
			readFileSync(path.join(localesDir, "vi", "shortcuts.json"), "utf8"),
		) as Record<string, Record<string, string>>;
		const en = JSON.parse(
			readFileSync(path.join(localesDir, "en", "shortcuts.json"), "utf8"),
		) as Record<string, Record<string, string>>;

		for (const action of Object.keys(SHORTCUT_LABELS)) {
			expect(vi.actions[action]).not.toBe(en.actions[action]);
		}
	});
});
