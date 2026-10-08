import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { WarningCircleIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { KeyvizSidecarControl } from "@/hooks/useKeyvizSidecar";
import styles from "./LaunchWindow.module.css";

/**
 * Dialog lỗi khởi động Keyviz trước khi quay: retry / quay không Keyviz / hủy.
 * Render khi useKeyvizSidecar có pendingDecision (flow await trong prepareForRecording).
 */
export function KeyvizStartupErrorDialog({ keyviz }: { keyviz: KeyvizSidecarControl }) {
	const t = useScopedT("launch");
	const decision = keyviz.pendingDecision;

	return (
		<Dialog open={decision !== null} onOpenChange={() => {}}>
			<DialogContent className={`launch-theme ${styles.electronNoDrag}`}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<WarningCircleIcon className="size-5 text-warning" />
						{t("keyviz.errorTitle", "Keyviz overlay failed to start")}
					</DialogTitle>
				</DialogHeader>
				<p className="text-sm text-foreground/80">
					{t(
						"keyviz.errorMessage",
						"The keyboard overlay (Keyviz) could not start. Recording is paused until you choose.",
					)}
					{decision?.message ? (
						<span className="mt-2 block text-xs text-foreground/50">{decision.message}</span>
					) : null}
				</p>
				<DialogFooter className="gap-2">
					<Button variant="ghost" onClick={() => decision?.resolve("cancel")}>
						{t("keyviz.errorCancel", "Cancel recording")}
					</Button>
					<Button variant="outline" onClick={() => decision?.resolve("skip")}>
						{t("keyviz.errorSkip", "Record without overlay")}
					</Button>
					<Button variant="default" onClick={() => decision?.resolve("retry")}>
						{t("keyviz.errorRetry", "Try again")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Banner khi sidecar rớt giữa recording: cho phục hồi hoặc dừng-lưu, không giấu lỗi.
 */
export function KeyvizUnexpectedExitBanner({
	keyviz,
	onStopRecording,
}: {
	keyviz: KeyvizSidecarControl;
	onStopRecording: () => void;
}) {
	const t = useScopedT("launch");

	if (!keyviz.unexpectedExit) {
		return null;
	}

	return (
		<div
			role="alert"
			className={`launch-theme ${styles.electronNoDrag} ${styles.keyvizExitBanner} pointer-events-auto`}
			data-hud-interactive
		>
			<WarningCircleIcon className="size-4 shrink-0 text-warning" />
			<span className="text-xs">
				{t("keyviz.exitBanner", "Keyboard overlay stopped unexpectedly during recording.")}
			</span>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						void keyviz.resolveUnexpectedExit("continue-without");
					}}
				>
					{t("keyviz.exitContinue", "Continue without overlay")}
				</Button>
				<Button
					variant="destructive"
					size="sm"
					onClick={() => {
						void keyviz.resolveUnexpectedExit("stop-recording").then(() => {
							onStopRecording();
						});
					}}
				>
					{t("keyviz.exitStopAndSave", "Stop and save")}
				</Button>
			</div>
		</div>
	);
}
