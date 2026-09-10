import { MainAgentSettingsPage } from "@renderer/features/settings/agents/main-agent-settings-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/agents")({
  component: MainAgentSettingsPage,
});
