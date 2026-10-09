import {
	execFile,
	spawn,
	type ChildProcessWithoutNullStreams,
} from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

/**
 * Controller cho Keyviz sidecar process (Windows only).
 *
 * Protocol: stdio line-delimited JSON (KHÔNG TCP).
 * - Sidecar -> Recordly : {"type":"ready"} | {"type":"capture_started"} | {"type":"capture_failed","code":"...","message":"..."}
 * - Recordly -> Sidecar : {"type":"start_capture","suppressed_shortcuts":[["Control","Alt","Shift","R"],...]} | {"type":"quit"}
 *
 * Lifecycle theo spec: sidecar khởi động ở trạng thái overlay-ready NHƯNG chưa hook;
 * input listener chỉ bắt đầu sau lệnh start_capture. Pause/stop/cancel/app-exit gửi quit
 * và đợi process thoát (hard-kill fallback); resume spawn lại sidecar.
 *
 * Suppression chord contract (W2 sidecar): mảng chord, mỗi chord là mảng token
 * chấp nhận alias (không phân biệt hoa thường): "Control"/"Ctrl", "Alt", "Shift",
 * "Meta"/"Win"; chữ đơn "A"-"Z"; số đơn "0"-"9"; "F1".."F24"; "Space", "Return"/"Enter",
 * "Tab", "Escape"/"Esc", "Backspace", "Delete"/"Del", "Home", "End", "PageUp", "PageDown",
 * "UpArrow"/"DownArrow"/"LeftArrow"/"RightArrow" (hoặc "Up"/"Down"/"Left"/"Right").
 * Sidecar normalize alias sang rdev::Key variants (Control -> ControlLeft|ControlRight...).
 */

export type KeyvizSidecarState =
	| "idle"
	| "starting"
	| "ready"
	| "capturing"
	| "stopping"
	| "failed"
	| "exited";

/** Chord dạng mảng token alias, vd ["Control","Alt","Shift","R"] — sidecar tự normalize. */
export type SidecarChord = string[];

export interface KeyvizPrepareSuccess {
	ok: true;
}

export interface KeyvizPrepareFailure {
	ok: false;
	code: string;
	message: string;
}

export type KeyvizPrepareResult = KeyvizPrepareSuccess | KeyvizPrepareFailure;

export interface KeyvizStatus {
	supported: boolean;
	state: KeyvizSidecarState;
	binaryFound: boolean;
}

interface SidecarLine {
	type?: unknown;
	code?: unknown;
	message?: unknown;
}

const READY_TIMEOUT_MS = 10_000;
const CAPTURE_STARTED_TIMEOUT_MS = 10_000;
const QUIT_GRACE_MS = 3_000;
const SIDECAR_EXECUTABLE_NAME = "recordly-keyviz.exe";

/**
 * Candidates khớp W2 build contract:
 * - packaged: extraResources "keyviz/recordly-keyviz.exe" trong resources
 * - dev: keyviz/src-tauri/target/release/sidecar/recordly-keyviz.exe (từ repo root)
 */
const SIDECAR_CANDIDATE_PATHS = [
	path.join("keyviz", SIDECAR_EXECUTABLE_NAME),
	path.join("keyviz", "src-tauri", "target", "release", "sidecar", SIDECAR_EXECUTABLE_NAME),
	path.join("electron", "native", "bin", "keyviz", SIDECAR_EXECUTABLE_NAME),
];

export const KEYVIZ_SIDECAR_LINE_EVENT = "keyviz-sidecar-line";

function isWindows(): boolean {
	return process.platform === "win32";
}

/** Standard standalone Tauri build is keyviz.exe; the Recordly sidecar is recordly-keyviz.exe. */
function detectStandaloneKeyvizProcess(): Promise<boolean> {
	return new Promise((resolve, reject) => {
		execFile(
			"tasklist.exe",
			["/FI", "IMAGENAME eq keyviz.exe", "/FO", "CSV", "/NH"],
			{ encoding: "utf8", timeout: 2_000, windowsHide: true },
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout.split(/\r?\n/).some((line) => /^"keyviz\.exe",/i.test(line.trim())));
			},
		);
	});
}

function pathExists(candidate: string): boolean {
	try {
		return fs.existsSync(candidate);
	} catch {
		return false;
	}
}

/** Resolve đường dẫn sidecar exe: env override -> packaged resources -> dev build output. */
export function resolveKeyvizSidecarBinaryPath(): string | null {
	const candidates: string[] = [];
	const configuredPath = process.env.RECORDLY_KEYVIZ_SIDECAR_EXE;
	if (configuredPath) {
		candidates.push(configuredPath);
	}

	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		for (const relativePath of SIDECAR_CANDIDATE_PATHS) {
			candidates.push(
				path.join(resourcesPath, "app.asar.unpacked", relativePath),
				path.join(resourcesPath, relativePath),
			);
		}
	}

	candidates.push(
		...SIDECAR_CANDIDATE_PATHS.map((relativePath) => path.join(process.cwd(), relativePath)),
		...SIDECAR_CANDIDATE_PATHS.map((relativePath) =>
			path.join(app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"), relativePath),
		),
	);

	for (const candidate of candidates) {
		if (pathExists(candidate)) {
			return candidate;
		}
	}
	return null;
}

/**
 * Chuyển ShortcutBinding (renderer, vd {key:"r", ctrl:true, alt:true, shift:true})
 * thành chord mảng token theo contract W2 sidecar.
 */
export function bindingToSidecarChord(binding: {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	meta?: boolean;
}): SidecarChord {
	const chord: string[] = [];
	if (binding.ctrl) chord.push("Control");
	if (binding.meta) chord.push("Meta");
	if (binding.alt) chord.push("Alt");
	if (binding.shift) chord.push("Shift");

	const keyLabels: Record<string, string> = {
		" ": "Space",
		enter: "Return",
		return: "Return",
		tab: "Tab",
		escape: "Escape",
		esc: "Escape",
		backspace: "Backspace",
		delete: "Delete",
		del: "Delete",
		home: "Home",
		end: "End",
		pageup: "PageUp",
		pagedown: "PageDown",
		arrowup: "UpArrow",
		arrowdown: "DownArrow",
		arrowleft: "LeftArrow",
		arrowright: "RightArrow",
		up: "UpArrow",
		down: "DownArrow",
		left: "LeftArrow",
		right: "RightArrow",
	};

	const normalizedKey = binding.key.toLowerCase();
	const key = keyLabels[normalizedKey] ?? normalizedKey.toUpperCase();
	chord.push(key);

	return chord;
}

type SpawnFn = (command: string, args: string[]) => ChildProcessWithoutNullStreams;

function defaultSpawn(command: string, args: string[]): ChildProcessWithoutNullStreams {
	return spawn(command, args, {
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	}) as ChildProcessWithoutNullStreams;
}

type WaitForLineResult =
	| { ok: true; line: SidecarLine }
	| { ok: false; code: string; message: string };

interface PendingWait {
	accepts: (type: unknown, line: SidecarLine) => boolean;
	resolve: (result: WaitForLineResult) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class KeyvizSidecarController {
	private process: ChildProcessWithoutNullStreams | null = null;
	private settingsProcess: ChildProcessWithoutNullStreams | null = null;
	private state: KeyvizSidecarState = "idle";
	private stdoutBuffer = "";
	private pendingWait: PendingWait | null = null;
	// Line đến trước khi waiter tương ứng kịp tạo (stdout xử lý sync) — giữ lại để waitForLine tiêu thụ.
	private bufferedLines: Array<Record<string, unknown>> = [];
	private quitWaiters: Array<() => void> = [];
	private stateListeners = new Set<(status: KeyvizStatus) => void>();
	private unexpectedExitListeners = new Set<() => void>();
	private stopping = false;

	constructor(
		private readonly options: {
			spawnFn?: SpawnFn;
			resolveBinary?: () => string | null;
			detectStandaloneKeyviz?: () => boolean | Promise<boolean>;
		} = {},
	) {}

	getStatus(): KeyvizStatus {
		const binary = this.options.resolveBinary ?? resolveKeyvizSidecarBinaryPath;
		return {
			supported: isWindows(),
			state: this.state,
			binaryFound: binary() !== null,
		};
	}

	onStateChange(listener: (status: KeyvizStatus) => void): () => void {
		this.stateListeners.add(listener);
		return () => {
			this.stateListeners.delete(listener);
		};
	}

	onUnexpectedExit(listener: () => void): () => void {
		this.unexpectedExitListeners.add(listener);
		return () => {
			this.unexpectedExitListeners.delete(listener);
		};
	}

	/**
	 * Đảm bảo sidecar chạy + input listener đã bật (capture_started) TRƯỚC khi capture frame đầu.
	 * Idempotent: nếu đang capturing thì trả success ngay.
	 */
	async prepareCapture(suppressed: SidecarChord[]): Promise<KeyvizPrepareResult> {
		if (!isWindows()) {
			return { ok: false, code: "unsupported_platform", message: "Keyviz sidecar is Windows-only" };
		}

		if (this.state === "capturing" && this.process) {
			return { ok: true };
		}

		try {
			const standaloneRunning = await (this.options.detectStandaloneKeyviz?.() ??
				detectStandaloneKeyvizProcess());
			if (standaloneRunning) {
				return {
					ok: false,
					code: "standalone_running",
					message: "Close the standalone Keyviz app before recording with its overlay.",
				};
			}
		} catch {
			return {
				ok: false,
				code: "standalone_detection_failed",
				message: "Could not check whether standalone Keyviz is already running.",
			};
		}

		// Dọn process cũ nếu còn (ví dụ từ lần thất bại trước).
		if (this.process) {
			await this.stop("prepare-restart");
		}

		const binaryPath = (this.options.resolveBinary ?? resolveKeyvizSidecarBinaryPath)();
		if (!binaryPath) {
			return {
				ok: false,
				code: "binary_missing",
				message: "Keyviz sidecar executable not found",
			};
		}

		const spawnFn = this.options.spawnFn ?? defaultSpawn;
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawnFn(binaryPath, ["--mode=capture"]);
		} catch (error) {
			return { ok: false, code: "spawn_failed", message: String(error) };
		}

		child.on("error", (error) => {
			console.error("[keyviz-sidecar] process error:", error);
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			this.handleStdoutData(child, chunk);
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			// Sidecar KHÔNG được log key content; chỉ forward bounded debug output.
			const trimmed = chunk.trim();
			if (trimmed) {
				console.warn(`[keyviz-sidecar:stderr] ${trimmed.slice(0, 500)}`);
			}
		});
		child.on("exit", () => {
			this.handleProcessExit(child);
		});

		this.process = child;
		this.stdoutBuffer = "";
		this.bufferedLines = [];
		this.setState("starting");

		// 1) Đợi ready.
		const readyResult = await this.waitForLine(
			["ready"],
			READY_TIMEOUT_MS,
			"waiting for sidecar ready",
		);
		if (!readyResult.ok) {
			await this.stop("ready-failed");
			return { ok: false, code: readyResult.code, message: readyResult.message };
		}

		this.setState("ready");

		// 2) Gửi start_capture và đợi capture_started / capture_failed.
		this.sendLine(child, {
			type: "start_capture",
			suppressed_shortcuts: suppressed,
		});

		const captureResult = await this.waitForLine(
			["capture_started"],
			CAPTURE_STARTED_TIMEOUT_MS,
			"waiting for capture_started",
		);
		if (!captureResult.ok) {
			await this.stop("capture-start-failed");
			return { ok: false, code: captureResult.code, message: captureResult.message };
		}

		// A failure can arrive in the same stdout chunk immediately after the ACK.
		// Consume it before resolving prepareCapture successfully.
		const startupFailureIndex = this.bufferedLines.findIndex(
			(line) => line.type === "capture_failed",
		);
		if (startupFailureIndex !== -1) {
			const [failure] = this.bufferedLines.splice(startupFailureIndex, 1);
			await this.stop("capture-failed-during-startup");
			return {
				ok: false,
				code: "capture_failed",
				message:
					typeof failure?.message === "string"
						? failure.message
						: "sidecar failed immediately after capture startup",
			};
		}

		this.setState("capturing");
		return { ok: true };
	}

	/** Gửi quit và đợi process thoát; hard-kill fallback sau QUIT_GRACE_MS. */
	async stop(reason = "stop"): Promise<void> {
		const child = this.process;
		if (!child) {
			this.setState("idle");
			return;
		}

		this.stopping = true;
		this.setState("stopping");
		this.clearPendingWait("cancelled", `sidecar stopped during ${reason}`);

		if (child.stdin.writable) {
			this.sendLine(child, { type: "quit" });
		}

		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				try {
					child.kill();
				} catch {
					/* ignore */
				}
				resolve();
			}, QUIT_GRACE_MS);
			this.quitWaiters.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
		this.quitWaiters = [];
		this.stopping = false;

		if (this.process === child) {
			this.process = null;
		}
		this.setState("idle");
		console.log(`[keyviz-sidecar] stopped (${reason})`);
	}

	/**
	 * Mở cửa sổ Settings của Keyviz ở mode settings (KHÔNG listener, KHÔNG tray).
	 * Process này tự thoát khi người dùng đóng cửa sổ hoặc khi Recordly chết (stdin EOF).
	 */
	async openSettings(): Promise<{ success: boolean; error?: string }> {
		if (!isWindows()) {
			return { success: false, error: "unsupported_platform" };
		}
		if (this.state === "capturing") {
			return { success: false, error: "capturing" };
		}

		const binaryPath = (this.options.resolveBinary ?? resolveKeyvizSidecarBinaryPath)();
		if (!binaryPath) {
			return { success: false, error: "binary_missing" };
		}

		// Chỉ cho phép 1 cửa sổ settings.
		if (this.settingsProcess && this.settingsProcess.exitCode === null) {
			return { success: true };
		}

		const spawnFn = this.options.spawnFn ?? defaultSpawn;
		try {
			const child = spawnFn(binaryPath, ["--mode=settings"]);
			await new Promise<void>((resolve, reject) => {
				if (child.pid !== undefined) {
					resolve();
					return;
				}
				const onSpawn = () => {
					cleanup();
					resolve();
				};
				const onError = (error: Error) => {
					cleanup();
					reject(error);
				};
				const cleanup = () => {
					child.removeListener("spawn", onSpawn);
					child.removeListener("error", onError);
				};
				child.once("spawn", onSpawn);
				child.once("error", onError);
			});
			child.on("error", (error) => {
				console.error("[keyviz-sidecar:settings] process error:", error);
			});
			// Drain để pipe không đầy (sidecar settings chỉ in 1 dòng ready).
			child.stdout.resume();
			child.stderr?.resume();
			this.settingsProcess = child;
			return { success: true };
		} catch (error) {
			console.error("[keyviz-sidecar:settings] failed to spawn:", error);
			return { success: false, error: "spawn_failed" };
		}
	}

	/** Dọn process khi app quit. */
	async dispose(): Promise<void> {
		await this.stop("app-exit");
		if (this.settingsProcess && this.settingsProcess.exitCode === null) {
			this.settingsProcess.stdin.end();
		}
	}

	private sendLine(child: ChildProcessWithoutNullStreams, payload: unknown): void {
		try {
			child.stdin.write(`${JSON.stringify(payload)}\n`);
		} catch (error) {
			console.error("[keyviz-sidecar] failed to write stdin:", error);
		}
	}

	private handleStdoutData(child: ChildProcessWithoutNullStreams, chunk: string): void {
		this.stdoutBuffer += chunk;
		let newlineIndex = this.stdoutBuffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (line) {
				this.handleSidecarLine(child, line);
			}
			newlineIndex = this.stdoutBuffer.indexOf("\n");
		}
		// Chống buffer phình do sidecar in rác không xuống dòng.
		if (this.stdoutBuffer.length > 64 * 1024) {
			this.stdoutBuffer = "";
		}
	}

	private handleSidecarLine(child: ChildProcessWithoutNullStreams, line: string): void {
		let parsed: SidecarLine;
		try {
			parsed = JSON.parse(line) as SidecarLine;
		} catch {
			// Line không phải JSON (log lẻ) — bỏ qua, không bao giờ chứa key content theo contract.
			console.warn(`[keyviz-sidecar] non-JSON stdout: ${line.slice(0, 200)}`);
			return;
		}

		const record = parsed as Record<string, unknown>;
		if (this.pendingWait && this.process === child) {
			if (this.pendingWait.accepts(parsed.type, parsed)) {
				return;
			}
		}

		// Chưa có waiter khớp — buffer lại (waitForLine kế tiếp sẽ scan queue này).
		this.bufferedLines.push(record);
		if (this.bufferedLines.length > 100) {
			this.bufferedLines.shift();
		}

		// capture_failed đến khi đang capturing mà không ai đợi — coi như runtime error muộn.
		if (parsed.type === "capture_failed" && this.state === "capturing") {
			this.setState("failed");
			this.notifyUnexpectedExit();
		}
	}

	private waitForLine(
		acceptTypes: string[],
		timeoutMs: number,
		context: string,
	): Promise<WaitForLineResult> {
		const acceptSet = new Set(acceptTypes);

		// Tiêu thụ line đã buffer trước (trường hợp line đến cùng tick với line trước đó).
		const bufferedIndex = this.bufferedLines.findIndex((line) => {
			const type = line.type;
			if (typeof type !== "string") {
				return false;
			}
			return acceptSet.has(type) || (type === "capture_failed" && !acceptSet.has("capture_failed"));
		});
		if (bufferedIndex !== -1) {
			const [line] = this.bufferedLines.splice(bufferedIndex, 1);
			const type = line.type as string;
			if (type === "capture_failed" && !acceptSet.has("capture_failed")) {
				return Promise.resolve({
					ok: false,
					code: "capture_failed",
					message:
						typeof line.message === "string" && line.message
							? line.message
							: `sidecar reported capture failure ${context}`,
				});
			}
			return Promise.resolve({ ok: true, line });
		}

		return new Promise((resolve) => {
			let pending: PendingWait;
			const timer = setTimeout(() => {
				if (this.pendingWait === pending) {
					this.pendingWait = null;
				}
				resolve({ ok: false, code: "timeout", message: `timeout ${context}` });
			}, timeoutMs);

			pending = {
				resolve,
				timer,
				accepts: (lineType, line) => {
					if (typeof lineType !== "string") {
						return false;
					}

					// capture_failed luôn chấm dứt chờ, kể cả khi đang đợi ready/capture_started.
					if (lineType === "capture_failed" && !acceptSet.has("capture_failed")) {
						clearTimeout(timer);
						this.pendingWait = null;
						resolve({
							ok: false,
							code: "capture_failed",
							message:
								typeof line.message === "string" && line.message
									? line.message
									: `sidecar reported capture failure ${context}`,
						});
						return true;
					}

					if (!acceptSet.has(lineType)) {
						return false;
					}
					clearTimeout(timer);
					this.pendingWait = null;
					resolve({ ok: true, line });
					return true;
				},
			};
			this.pendingWait = pending;
		});
	}

	private clearPendingWait(
		code = "process_exited",
		message = "sidecar process exited while waiting for a response",
	): void {
		const pending = this.pendingWait;
		if (!pending) {
			return;
		}
		clearTimeout(pending.timer);
		this.pendingWait = null;
		pending.resolve({ ok: false, code, message });
	}

	private resolveQuitWaiters(): void {
		const waiters = this.quitWaiters;
		this.quitWaiters = [];
		for (const waiter of waiters) {
			try {
				waiter();
			} catch {
				/* ignore */
			}
		}
	}

	private handleProcessExit(child: ChildProcessWithoutNullStreams): void {
		if (this.process !== child) {
			return;
		}
		this.process = null;
		const wasCapturing = this.state === "capturing";
		this.clearPendingWait("process_exited", "sidecar exited before the handshake completed");
		// stop() đang chờ process thoát — đánh thức ngay, không đợi grace timer.
		this.resolveQuitWaiters();

		if (this.stopping || this.state === "stopping" || this.state === "idle") {
			this.setState("idle");
			return;
		}

		this.setState("exited");
		if (wasCapturing) {
			// Sidecar rớt giữa recording — báo lên HUD để user phục hồi hoặc dừng-lưu.
			this.notifyUnexpectedExit();
		}
	}

	private setState(next: KeyvizSidecarState): void {
		if (this.state === next) {
			return;
		}
		this.state = next;
		const status = this.getStatus();
		for (const listener of this.stateListeners) {
			try {
				listener(status);
			} catch (error) {
				console.error("[keyviz-sidecar] state listener error:", error);
			}
		}
	}

	private notifyUnexpectedExit(): void {
		for (const listener of this.unexpectedExitListeners) {
			try {
				listener();
			} catch (error) {
				console.error("[keyviz-sidecar] unexpected-exit listener error:", error);
			}
		}
	}
}

// Singleton dùng chung cho main process.
let controller: KeyvizSidecarController | null = null;

export function getKeyvizSidecarController(): KeyvizSidecarController {
	if (!controller) {
		controller = new KeyvizSidecarController();
	}
	return controller;
}

export function resetKeyvizSidecarControllerForTests(): void {
	controller = null;
}
