import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCALE, INITIAL_DEFAULT_LOCALE } from "@/i18n/config";
import { getInitialLocale, normalizeLocale, translateForLocale } from "./I18nContext";

// Trim the vi common bundle so the English missing-key fallback path is exercised.
vi.mock("@/i18n/locales/vi/common.json", () => ({
	default: {
		app: {
			name: "Recordly",
		},
	},
}));

function createStorageMock(initialValues: Record<string, string> = {}): Storage {
	const store = new Map(Object.entries(initialValues));

	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.get(key) ?? null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(key, value);
		},
	};
}

function stubWindowStorage(initialValues: Record<string, string> = {}) {
	vi.stubGlobal("window", { localStorage: createStorageMock(initialValues) });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getInitialLocale", () => {
	it("defaults to Vietnamese on first launch when nothing is stored", () => {
		stubWindowStorage();

		expect(getInitialLocale()).toBe("vi");
	});

	it("keeps a previously stored locale instead of defaulting to Vietnamese", () => {
		stubWindowStorage({ "recordly.locale": "en" });

		expect(getInitialLocale()).toBe("en");
	});

	it("keeps a stored Vietnamese locale", () => {
		stubWindowStorage({ "recordly.locale": "vi" });

		expect(getInitialLocale()).toBe("vi");
	});

	it("canonicalizes stored locale aliases", () => {
		stubWindowStorage({ "recordly.locale": "zh-cn" });

		expect(getInitialLocale()).toBe("zh-CN");
	});

	it("falls back to the default locale for unknown stored values", () => {
		stubWindowStorage({ "recordly.locale": "xx-YY" });

		expect(getInitialLocale()).toBe("en");
	});

	it("uses the default locale when window is unavailable", () => {
		expect(getInitialLocale()).toBe(DEFAULT_LOCALE);
	});
});

describe("initial default vs missing-key fallback", () => {
	it("keeps English as DEFAULT_LOCALE while Vietnamese is the first-run default", () => {
		expect(DEFAULT_LOCALE).toBe("en");
		expect(INITIAL_DEFAULT_LOCALE).toBe("vi");
	});
});

describe("translateForLocale", () => {
	it("resolves keys from the active locale bundle", () => {
		expect(translateForLocale("vi", "common.app.name")).toBe("Recordly");
		expect(translateForLocale("en", "common.actions.cancel")).toBe("Cancel");
	});

	it("falls back to the English value when the key is missing in the active locale", () => {
		expect(translateForLocale("vi", "common.app.editorTitle")).toBe("Recordly Editor");
	});

	it("uses the provided fallback before the key itself", () => {
		expect(translateForLocale("vi", "common.app.nonexistent", "Nhãn dự phòng")).toBe(
			"Nhãn dự phòng",
		);
		expect(translateForLocale("vi", "common.app.nonexistent")).toBe("common.app.nonexistent");
	});

	it("interpolates variables into the resolved template", () => {
		expect(
			translateForLocale("vi", "dialogs.shortcutsConfig.changeShortcut", undefined, {
				action: "Thêm thu phóng",
				binding: "Z",
			}),
		).toBe("Đổi phím tắt cho Thêm thu phóng, hiện tại là Z");
	});
});

describe("normalizeLocale", () => {
	it("maps language-only tags onto supported regional locales", () => {
		expect(normalizeLocale("zh")).toBe("zh-CN");
		expect(normalizeLocale("pt")).toBe("pt-BR");
	});

	it("returns the default locale for unsupported languages", () => {
		expect(normalizeLocale("fr-CA")).toBe("fr");
		expect(normalizeLocale(null)).toBe("en");
	});
});
