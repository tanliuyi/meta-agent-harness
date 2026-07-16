import { useMemo } from "react";
import type { ModelOption, Project, SessionControlState } from "../../../../shared/contracts.ts";
import { ModelSelector, type ModelOption as ModelSelectorOption } from "../assistant-ui/model-selector.tsx";
import { Select } from "../assistant-ui/select.tsx";

function modelKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

/** 仅供新会话草稿选择目标 Project。 */
export function ProjectSelect({
  projects,
  projectId,
  disabled,
  onValueChange,
}: {
  projects: readonly Project[];
  projectId: string | null;
  disabled: boolean;
  onValueChange(projectId: string): void;
}) {
  return (
    <Select
      value={projectId ?? ""}
      options={projects.map((project) => ({
        value: project.id,
        label: project.name,
        disabled: !project.available,
      }))}
      placeholder="选择项目"
      disabled={disabled}
      onValueChange={onValueChange}
    />
  );
}

export function createModelSelectorState(availableModels: readonly ModelOption[]) {
  const models: ModelSelectorOption[] = [];
  const groups = new Map<string, ModelSelectorOption[]>();
  const modelByKey = new Map<string, ModelOption>();
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

/** draft 与 committed session 共用的受控模型选择器。 */
export function ModelSelect({
  availableModels,
  model,
  disabled = false,
  onValueChange,
}: {
  availableModels: readonly ModelOption[];
  model: { provider: string; id: string } | null | undefined;
  disabled?: boolean;
  onValueChange(provider: string, modelId: string): void;
}) {
  const { models, groups, modelByKey } = useMemo(() => createModelSelectorState(availableModels), [availableModels]);
  const value = model ? modelKey(model.provider, model.id) : undefined;

  return (
    <ModelSelector.Root
      models={models}
      value={value}
      onValueChange={(nextValue) => {
        const model = modelByKey.get(nextValue);
        if (model) onValueChange(model.provider, model.id);
      }}
    >
      <ModelSelector.Trigger variant="ghost" size="sm" aria-label="选择模型" disabled={disabled || models.length === 0}>
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

/** draft 与 committed session 共用的受控 thinking level 选择器。 */
export function ThinkingSelect({
  value,
  levels,
  disabled = false,
  onValueChange,
}: {
  value: SessionControlState["thinkingLevel"];
  levels: SessionControlState["thinkingLevels"];
  disabled?: boolean;
  onValueChange(value: SessionControlState["thinkingLevel"]): void;
}) {
  return (
    <Select
      value={value}
      options={levels.map((level) => ({ value: level, label: level }))}
      disabled={disabled || levels.length === 0}
      onValueChange={(nextValue) => onValueChange(nextValue as SessionControlState["thinkingLevel"])}
    />
  );
}
