import { describe, expect, it } from "vitest";
import { shouldReportUnexpectedKeyvizExit } from "./useKeyvizSidecar";

describe("shouldReportUnexpectedKeyvizExit", () => {
	it("reports an exit while capture is active", () => {
		expect(shouldReportUnexpectedKeyvizExit("capturing", "exited", false)).toBe(true);
		expect(shouldReportUnexpectedKeyvizExit("capturing", "failed", false)).toBe(true);
	});

	it("ignores planned teardown and failures outside capture", () => {
		expect(shouldReportUnexpectedKeyvizExit("capturing", "exited", true)).toBe(false);
		expect(shouldReportUnexpectedKeyvizExit("ready", "failed", false)).toBe(false);
		expect(shouldReportUnexpectedKeyvizExit("idle", "exited", false)).toBe(false);
	});
});
