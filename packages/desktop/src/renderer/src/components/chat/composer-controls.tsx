import { useMemo } from "react";
import type { SessionControlState } from "../../../../shared/contracts.ts";
import { ModelSelector, type ModelOption as ModelSelectorOption } from "../assistant-ui/model-selector.tsx";
import { Select } from "../assistant-ui/select.tsx";

function modelKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

export function createModelSelectorState(availableModels: SessionControlState["models"]) {
  const models: ModelSelectorOption[] = [];
  const groups = new Map<string, ModelSelectorOption[]>();
  const modelByKey = new Map<string, SessionControlState["models"][number]>();
  for (const model of availableModels) {
    const key = modelKey(model.provider, model.id);
    const option: ModelSelectorOption = {
      id: key,
      name: model.name,
      description: model.id,
      keywords: [model.provider],
    };
    models.push(option);
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), option]);
    modelByKey.set(key, model);
  }
  return { models, groups, modelByKey };
}

/** 当前 session 的模型选择器。 */
export function ModelSelect({ snapshot }: { snapshot: SessionControlState }) {
  const { models, groups, modelByKey } = useMemo(() => createModelSelectorState(snapshot.models), [snapshot.models]);

  const value = snapshot.model ? modelKey(snapshot.model.provider, snapshot.model.id) : undefined;

  return (
    <ModelSelector.Root
      models={models}
      value={value}
      onValueChange={(nextValue) => {
        const model = modelByKey.get(nextValue);
        if (model) {
          void window.desktop.sessions.setModel(snapshot.projectId, snapshot.threadId, model.provider, model.id);
        }
      }}
    >
      <ModelSelector.Trigger variant="ghost" size="sm" aria-label="选择模型" disabled={models.length === 0}>
        <ModelSelector.Value showEffort={false} />
      </ModelSelector.Trigger>
      <ModelSelector.Content align="end">
        <ModelSelector.Search placeholder="搜索模型..." />
        <ModelSelector.List>
          <ModelSelector.Empty />
          {[...groups].map(([provider, providerModels]) => (
            <ModelSelector.Group key={provider} heading={provider}>
              {providerModels.map((model) => (
                <ModelSelector.Item key={model.id} model={model} />
              ))}
            </ModelSelector.Group>
          ))}
        </ModelSelector.List>
      </ModelSelector.Content>
    </ModelSelector.Root>
  );
}

/** 当前 session 的 thinking level 选择器。 */
export function ThinkingSelect({ snapshot }: { snapshot: SessionControlState }) {
  return (
    <Select
      value={snapshot.thinkingLevel}
      options={snapshot.thinkingLevels.map((level) => ({ value: level, label: level }))}
      onValueChange={(value) =>
        void window.desktop.sessions.setThinking(
          snapshot.projectId,
          snapshot.threadId,
          value as SessionControlState["thinkingLevel"],
        )
      }
    />
  );
}
