import { scope } from "@juicesharp/rpiv-i18n";
import type { TaskStatus } from "../tool/types";

export const I18N_NAMESPACE = "@juicesharp/rpiv-todo";
export const t = scope(I18N_NAMESPACE);

export function formatStatusLabel(status: TaskStatus): string {
	switch (status) {
		case "pending":
			return t("status.pending", "pending");
		case "in_progress":
			return t("status.in_progress", "in progress");
		case "completed":
			return t("status.completed", "completed");
		case "deleted":
			return t("status.deleted", "deleted");
	}
}
