import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

// Builds the Recordly Keyviz sidecar (Task 2 of
// docs/specs/.working/SPEC-2026-10-08-recordly-keyviz.md).
//
// Steps:
//   1. `pnpm install --frozen-lockfile` inside keyviz/ when node_modules is missing
//   2. frontend build (vite) via pnpm
//   3. Tauri release build with the sidecar identity config
//      (keyviz/src-tauri/tauri.sidecar.conf.json: productName "recordly-keyviz",
//      identifier "app.recordly.keyvizsidecar", bundling disabled)
//   4. stage the exe into the canonical sidecar output folder
//
// Output (single source of truth for electron-builder extraResources):
//   keyviz/src-tauri/target/release/recordly-keyviz.exe
// The keyviz/src-tauri/.gitignore ignores /target/, so the binary never reaches git.

const projectRoot = process.cwd();
const keyvizDir = path.join(projectRoot, "keyviz");
const tauriDir = path.join(keyvizDir, "src-tauri");
const sidecarConfig = path.join("src-tauri", "tauri.sidecar.conf.json");
const outputExeName = "recordly-keyviz.exe";

if (process.platform !== "win32") {
	console.log("[build-keyviz-sidecar] Skipping: host platform is not Windows.");
	process.exit(0);
}

function run(command, args, cwd, label, useShell = false) {
	console.log(`[build-keyviz-sidecar] ${label}: ${command} ${args.join(" ")} (cwd: ${path.relative(projectRoot, cwd) || "."})`);
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 45 * 60 * 1000,
		// pnpm ships as a .cmd shim on Windows; spawnSync needs a shell to run it.
		shell: useShell && process.platform === "win32",
	});
	if (result.stdout?.trim()) {
		console.log(result.stdout.trim());
	}
	if (result.status !== 0) {
		const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
		throw new Error(details || `${label} failed with exit code ${result.status}`);
	}
}

function requireTool(command, label, useShell = false) {
	const check = spawnSync(command, ["--version"], {
		encoding: "utf8",
		shell: useShell && process.platform === "win32",
	});
	if (check.status !== 0) {
		const details = [check.stderr, check.stdout].filter(Boolean).join("\n").trim();
		throw new Error(
			details || `${command} is unavailable; install ${label} before building the Keyviz sidecar.`,
		);
	}
	console.log(`[build-keyviz-sidecar] ${label}: ${[check.stdout, check.stderr].filter(Boolean).join(" ").trim().split(/\r?\n/)[0]}`);
}

// 0. Toolchain sanity checks (fail fast with actionable messages).
requireTool("pnpm", "pnpm (https://pnpm.io/installation)", true);
requireTool("cargo", "the Rust toolchain (https://rustup.rs)");

// 1. Install frontend dependencies from a clean checkout when needed.
if (!existsSync(path.join(keyvizDir, "node_modules"))) {
	run("pnpm", ["install", "--frozen-lockfile"], keyvizDir, "Installing keyviz frontend deps", true);
} else {
	console.log("[build-keyviz-sidecar] keyviz/node_modules already present; skipping pnpm install.");
}

// 2. Frontend build (TypeScript check + vite production bundle into keyviz/dist).
run("pnpm", ["run", "build"], keyvizDir, "Building keyviz frontend", true);

// 3. Tauri release build with the sidecar identity (first run compiles all Rust
// dependencies; 10-20 minutes on a cold target dir is normal).
run("pnpm", ["exec", "tauri", "build", "--config", sidecarConfig], keyvizDir, "Building keyviz sidecar (tauri)", true);

// 4. Locate and stage the built exe. `tauri build` names the binary after the
// productName in the sidecar config; fall back to the crate bin name.
const releaseDir = path.join(tauriDir, "target", "release");
const candidates = [path.join(releaseDir, outputExeName), path.join(releaseDir, "keyviz.exe")];
const builtExe = candidates.find((candidate) => existsSync(candidate));
if (!builtExe) {
	throw new Error(
		`Sidecar exe not found after build. Looked in:\n${candidates.map((candidate) => `  - ${candidate}`).join("\n")}`,
	);
}

const stagedDir = path.join(releaseDir, "sidecar");
mkdirSync(stagedDir, { recursive: true });
const stagedExe = path.join(stagedDir, outputExeName);
rmSync(stagedExe, { force: true });
copyFileSync(builtExe, stagedExe);

const sizeMb = (statSync(stagedExe).size / (1024 * 1024)).toFixed(1);
console.log(
	`[build-keyviz-sidecar] Staged ${outputExeName} (${sizeMb} MB) -> ${path.relative(projectRoot, stagedExe)}`,
);
console.log(
	"[build-keyviz-sidecar] electron-builder extraResources source:",
	path.relative(projectRoot, stagedExe),
);
