import { PluginMarketplaceDetailPage } from "@renderer/features/plugins/plugin-marketplace-detail-page";
import { settingsReturnSession } from "@renderer/state/settings-navigation";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/plugins/$pluginId")({ component: PluginMarketplaceDetailRoute });

function PluginMarketplaceDetailRoute() {
  const { pluginId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <PluginMarketplaceDetailPage
      pluginId={pluginId}
      initialQuery={search.query}
      returnSession={settingsReturnSession(search) ?? undefined}
    />
  );
}
