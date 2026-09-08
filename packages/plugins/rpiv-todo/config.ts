export interface GuidanceFields {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface TodoConfig {
	guidance?: GuidanceFields;
	maxWidgetLines?: number;
}

export const DEFAULT_MAX_WIDGET_LINES = 12;

export function validateGuidanceFields(value: unknown): GuidanceFields {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const input = value as Record<string, unknown>;
	return {
		description: typeof input.description === "string" && input.description.length > 0 ? input.description : undefined,
		promptSnippet:
			typeof input.promptSnippet === "string" && input.promptSnippet.length > 0 ? input.promptSnippet : undefined,
		promptGuidelines:
			Array.isArray(input.promptGuidelines) &&
			input.promptGuidelines.length > 0 &&
			input.promptGuidelines.every((item) => typeof item === "string" && item.length > 0)
				? input.promptGuidelines
				: undefined,
	};
}

export function resolveMaxWidgetLines(config: Pick<TodoConfig, "maxWidgetLines">): number {
	const lines = config.maxWidgetLines;
	return typeof lines === "number" && Number.isFinite(lines) && lines >= 3
		? Math.floor(lines)
		: DEFAULT_MAX_WIDGET_LINES;
}
