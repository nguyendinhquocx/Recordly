import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bindingToSidecarChord,
	KeyvizSidecarController as BaseKeyvizSidecarController,
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
	pid: number | undefined;
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
	child.pid = 1234;
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

class KeyvizSidecarController extends BaseKeyvizSidecarController {
	constructor(options: ConstructorParameters<typeof BaseKeyvizSidecarController>[0] = {}) {
		super({ detectStandaloneKeyviz: () => false, ...options });
	}
}

describe("bindingToSidecarChord", () => {
	it("maps ctrl+alt+shift+r to normalized chord tokens", () => {
		expect(bindingToSidecarChord({ key: "r", ctrl: true, alt: true, shift: true })).toEqual<
			SidecarChord
		>(["Control", "Alt", "Shift", "R"]);
	});

	it("maps space and arrow keys", () => {
		expect(bindingToSidecarChord({ key: " " })).toEqual<SidecarChord>(["Space"]);
		expect(bindingToSidecarChord({ key: "arrowup", ctrl: true })).toEqual<SidecarChord>([
			"Control",
			"UpArrow",
		]);
	});

	it("maps enter alias to Return", () => {
		expect(bindingToSidecarChord({ key: "enter" })).toEqual<SidecarChord>(["Return"]);
	});

	it("preserves rdev names for less-common physical keys", () => {
		expect(bindingToSidecarChord({ key: "insert", ctrl: true })).toEqual<SidecarChord>([
			"Control",
			"Insert",
		]);
		expect(bindingToSidecarChord({ key: "scrolllock" })).toEqual<SidecarChord>([
			"ScrollLock",
		]);
		expect(bindingToSidecarChord({ key: "=" })).toEqual<SidecarChord>(["Equal"]);
		expect(bindingToSidecarChord({ key: ";" })).toEqual<SidecarChord>(["SemiColon"]);
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
			["Control", "Alt", "Shift", "R"],
			["Control", "Alt", "Shift", "S"],
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

	it("settles the ready waiter immediately on asynchronous spawn error", async () => {
		const child = createFakeChild();
		child.pid = undefined;
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => {
				queueMicrotask(() => child.emit("error", new Error("ENOENT")));
				return child as never;
			},
		});

		const promise = controller.prepareCapture([]);
		const assertion = expect(promise).resolves.toMatchObject({
			ok: false,
			code: "spawn_failed",
		});
		await vi.advanceTimersByTimeAsync(0);
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

	it("resolves the ready waiter when the sidecar exits before ready", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const promise = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.emit("exit", 1);

		await expect(promise).resolves.toMatchObject({ ok: false, code: "process_exited" });
	});

	it("resolves the capture_started waiter when the sidecar exits during handshake", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const promise = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n');
		await vi.advanceTimersByTimeAsync(0);
		child.emit("exit", 1);

		await expect(promise).resolves.toMatchObject({ ok: false, code: "process_exited" });
	});

	it("treats capture_failed buffered after capture_started as startup failure", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const promise = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit("data", '{"type":"ready"}\n');
		await vi.advanceTimersByTimeAsync(0);
		child.stdout.emit(
			"data",
			'{"type":"capture_started"}\n{"type":"capture_failed","code":"hook_install_failed","message":"late failure"}\n',
		);
		await vi.advanceTimersByTimeAsync(0);
		child.emit("exit", 0);

		await expect(promise).resolves.toEqual({
			ok: false,
			code: "capture_failed",
			message: "late failure",
		});
	});

	it("notifies an unexpected runtime failure after capture preparation resolved", async () => {
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
		await expect(prepare).resolves.toEqual({ ok: true });

		child.stdout.emit(
			"data",
			'{"type":"capture_failed","code":"hook_install_failed","message":"listener died"}\n',
		);
		expect(controller.getStatus().state).toBe("failed");
		expect(onUnexpectedExit).toHaveBeenCalledTimes(1);
	});

	it("settles an in-flight ready waiter when release stops the handshake", async () => {
		const child = createFakeChild();
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => child as never,
		});

		const prepare = controller.prepareCapture([]);
		await vi.advanceTimersByTimeAsync(0);
		const release = controller.stop("test-abort");
		await vi.advanceTimersByTimeAsync(0);
		expect(emittedLines(child).some((line) => line.type === "quit")).toBe(true);
		child.emit("exit", 0);
		await Promise.all([release, expect(prepare).resolves.toMatchObject({ ok: false, code: "cancelled" })]);
	});

	it("rejects capture when standalone Keyviz is already running", async () => {
		const spawnFn = vi.fn();
		const controller = new BaseKeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			detectStandaloneKeyviz: () => true,
			spawnFn: spawnFn as never,
		});

		await expect(controller.prepareCapture([])).resolves.toMatchObject({
			ok: false,
			code: "standalone_running",
		});
		expect(spawnFn).not.toHaveBeenCalled();
	});

	it("reports asynchronous settings spawn failures", async () => {
		const child = createFakeChild();
		child.pid = undefined;
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: () => {
				queueMicrotask(() => child.emit("error", new Error("permission denied")));
				return child as never;
			},
		});

		await expect(controller.openSettings()).resolves.toEqual({
			success: false,
			error: "spawn_failed",
		});
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
		const settingsChild = createFakeChild();
		const spawnedArgs: string[][] = [];
		const controller = new KeyvizSidecarController({
			resolveBinary: resolveBinaryFound,
			spawnFn: (_command, args) => {
				spawnedArgs.push(args);
				return settingsChild as never;
			},
		});

		const opening = controller.openSettings();
		let resolved = false;
		void opening.then(() => {
			resolved = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(resolved).toBe(false);
		settingsChild.stdout.emit("data", '{"type":"ready"}\n');
		const result = await opening;

		expect(result).toEqual({ success: true });
		expect(spawnedArgs).toEqual([["--mode=settings"]]);
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
