import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bindingToSidecarChord,
	KeyvizSidecarController,
	type SidecarChord,
} from "./keyvizSidecar";

vi.mock("electron", () => ({
	app: {
		getAppPath: () => "/mock/app",
		getPath: () => "/mock/userData",
	},
}));

interface FakeChild extends EventEmitter {
	stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; writable: boolean };
	stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
	stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
	kill: ReturnType<typeof vi.fn>;
	exitCode: number | null;
}

function createFakeChild() {
	const child = new EventEmitter() as FakeChild;
	child.stdin = { write: vi.fn(), end: vi.fn(), writable: true };
	child.stdout = new EventEmitter() as FakeChild["stdout"];
	child.stdout.setEncoding = vi.fn();
	(child.stdout as unknown as { resume: ReturnType<typeof vi.fn> }).resume = vi.fn();
	child.stderr = new EventEmitter() as FakeChild["stderr"];
	child.stderr.setEncoding = vi.fn();
	(child.stderr as unknown as { resume: ReturnType<typeof vi.fn> }).resume = vi.fn();
	child.kill = vi.fn();
	child.exitCode = null;
	return child;
}

function emittedLines(child: FakeChild): Array<Record<string, unknown>> {
	return child.stdin.write.mock.calls
		.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
		.filter((line) => typeof line.type === "string");
}

function resolveBinaryFound(): string | null {
	return "C:\\mock\\recordly-keyviz.exe";
}

describe("bindingToSidecarChord", () => {
	it("maps ctrl+alt+shift+r to normalized chord", () => {
		expect(
			bindingToSidecarChord({ key: "r", ctrl: true, alt: true, shift: true }),
		).toEqual<SidecarChord>({ modifiers: ["Control", "Alt", "Shift"], key: "R" });
	});

	it("maps space and arrow keys", () => {
		expect(bindingToSidecarChord({ key: " " })).toEqual<SidecarChord>({
			modifiers: [],
			key: "Space",
		});
		expect(bindingToSidecarChord({ key: "arrowup", ctrl: true })).toEqual<SidecarChord>({
			modifiers: ["Control"],
			key: "UpArrow",
		});
	});

	it("maps enter alias to Return", () => {
		expect(bindingToSidecarChord({ key: "enter" })).toEqual<SidecarChord>({
			modifiers: [],
			key: "Return",
		});
	});
});

describe("KeyvizSidecarController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns binary_missing when executable cannot be resolved", async () => {
		const controller = new KeyvizSidecarController({
			resolveBinary: () => null,
		});
		const result = await controller.prepareCapture([]);
		expect(result).toEqual({ ok: false, code: "binary_missing", message: expect.any(String) });
	});

	it("reaches capturing after ready + capture_started and sends suppressed chords", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const suppressed: SidecarChord[] = [
			{ modifiers: ["Control", "Alt", "Shift"], key: "R" },
			{ modifiers: ["Control", "Alt", "Shift"], key: "S" },
		];

		const promise = controller.prepareCapture(suppressed);
		await vi.advanceTimersByTimeAsync(0);

		// Sidecar báo ready trước; Recordly mới gửi start_capture.
		child.stdout.emit("data", '{"type":"ready"}\n');
		await vi.advanceTimersByTimeAsync(0);

		// start_capture đã được gửi với đúng contract.
		const sent = emittedLines(child);
		expect(sent[0]).toEqual({
			type: "start_capture",
			suppressed_shortcuts: suppressed,
		});

		child.stdout.emit("data", '{"type":"capture_started"}\n');
		const result = await promise;

		expect(result).toEqual({ ok: true });
		expect(controller.getStatus().state).toBe("capturing");
	});

	it("handles chunked stdout lines", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const promise = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"re');
		child.stdout.emit("data", 'ady"}\n{"type":"capture_');
		child.stdout.emit("data", 'started"}\n');
		const result = await promise;

		expect(result).toEqual({ ok: true });
	});

	it("surfaces capture_failed distinctly from timeout", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const promise = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n');
		child.stdout.emit(
			"data",
			'{"type":"capture_failed","code":"hook_install_failed","message":"hook blocked"}\n',
		);
		const assertion = expect(promise).resolves.toEqual({
			ok: false,
			code: "capture_failed",
			message: "hook blocked",
		});
		// stop() sau thất bại cần grace timer (fake) để hard-kill resolve.
		await vi.advanceTimersByTimeAsync(15_000);
		await assertion;
		expect(controller.getStatus().state).toBe("idle");
	});

	it("times out when sidecar never becomes ready", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const promise = controller.prepareCapture([]);
		const assertion = expect(promise).resolves.toEqual({
			ok: false,
			code: "timeout",
			message: expect.stringContaining("ready"),
		});
		await vi.advanceTimersByTimeAsync(60_000);
		await assertion;
	});

	it("stop() sends quit and waits for process exit", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const prepare = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n{"type":"capture_started"}\n');
		await prepare;
		expect(controller.getStatus().state).toBe("capturing");

		const stopPromise = controller.stop("test");
		await vi.advanceTimersByTimeAsync(0);
		expect(emittedLines(child).some((line) => line.type === "quit")).toBe(true);

		child.emit("exit", 0);
		await stopPromise;
		expect(controller.getStatus().state).toBe("idle");
	});

	it("stop() hard-kills after grace period when process hangs", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const prepare = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n{"type":"capture_started"}\n');
		await prepare;

		const stopPromise = controller.stop("test");
		await vi.advanceTimersByTimeAsync(0);
		expect(child.kill).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(10_000);
		expect(child.kill).toHaveBeenCalledTimes(1);
		await stopPromise;
		expect(controller.getStatus().state).toBe("idle");
	});

	it("notifies unexpected exit when sidecar dies mid-capture", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const onUnexpectedExit = vi.fn();
		controller.onUnexpectedExit(onUnexpectedExit);

		const prepare = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n{"type":"capture_started"}\n');
		await prepare;

		child.emit("exit", 1);
		expect(onUnexpectedExit).toHaveBeenCalledTimes(1);
		expect(controller.getStatus().state).toBe("exited");
	});

	it("openSettings is rejected while capturing", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const prepare = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n{"type":"capture_started"}\n');
		await prepare;

		const result = await controller.openSettings();
		expect(result).toEqual({ success: false, error: "capturing" });
	});

	it("openSettings spawns settings-mode process", async () => {
		const captureChild = createFakeChild();
		const settingsChild = createFakeChild();
		const spawned: FakeChild[] = [];
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => {
				const next = spawned.length === 0 ? captureChild : settingsChild;
				spawned.push(next);
				return next as never;
			},
		});

		const result = await controller.openSettings();
		expect(result).toEqual({ success: true });
		expect(spawned).toHaveLength(1);
		expect(controller.getStatus().state).toBe("idle");
	});

	it("is idempotent when already capturing", async () => {
		const child = createFakeChild();
		let spawnCount = 0;
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => {
				spawnCount += 1;
				return child as never;
			},
		});

		const first = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n{"type":"capture_started"}\n');
		await first;

		const second = await controller.prepareCapture([]);
		expect(second).toEqual({ ok: true });
		expect(spawnCount).toBe(1);
	});
});
