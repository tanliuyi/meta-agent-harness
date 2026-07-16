import { join } from "node:path";
import {
  AuthStorage,
  findInitialModel,
  getAgentDir,
  ModelRegistry,
  resolveThinkingConfiguration,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { DraftSessionConfig, Readiness, SessionCreateInput, ThinkingLevel } from "../../shared/contracts.ts";

export interface SessionConfigurationServices {
  auth: AuthStorage;
  models: ModelRegistry;
  settings: SettingsManager;
}

/** 创建 preview 与真实 session 共用的 Pi 配置服务。 */
export function createSessionConfigurationServices(cwd: string): SessionConfigurationServices {
  const agentDir = getAgentDir();
  const auth = AuthStorage.create(join(agentDir, "auth.json"));
  return {
    auth,
    models: ModelRegistry.create(auth, join(agentDir, "models.json")),
    settings: SettingsManager.create(cwd, agentDir),
  };
}

/** 不创建 AgentSession，只解析新会话可选模型和默认 thinking。 */
export async function loadDraftSessionConfig(
  cwd: string,
  services: SessionConfigurationServices = createSessionConfigurationServices(cwd),
): Promise<DraftSessionConfig> {
  const { models, settings } = services;
  const initial = await findInitialModel({
    scopedModels: [],
    isContinuing: false,
    defaultProvider: settings.getDefaultProvider(),
    defaultModelId: settings.getDefaultModel(),
    defaultThinkingLevel: settings.getDefaultThinkingLevel(),
    modelRegistry: models,
  });
  const requestedThinking = settings.getDefaultThinkingLevel() ?? initial.thinkingLevel;
  const available = models.getAvailable();
  const thinking = resolveThinkingConfiguration(initial.model, requestedThinking);
  return {
    models: available.map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      thinking: model.reasoning,
      thinkingLevels: resolveThinkingConfiguration(model, requestedThinking).thinkingLevels,
    })),
    model: initial.model ? { provider: initial.model.provider, id: initial.model.id, name: initial.model.name } : null,
    thinkingLevel: thinking.thinkingLevel,
    thinkingLevels: thinking.thinkingLevels,
    readiness: sessionReadiness(Boolean(initial.model), available.length, models.getAll().length),
  };
}

/** 校验 renderer 选择并转换为 createAgentSession 的精确输入。 */
export function resolveSessionCreateSelection(
  input: SessionCreateInput,
  models: ModelRegistry,
): { model: NonNullable<ReturnType<ModelRegistry["find"]>>; thinkingLevel: ThinkingLevel } {
  const model = models.find(input.model.provider, input.model.id);
  if (!model) throw new Error(`模型不存在: ${input.model.provider}/${input.model.id}`);
  if (!models.hasConfiguredAuth(model)) throw new Error(`模型凭据不可用: ${input.model.provider}/${input.model.id}`);
  return { model, thinkingLevel: resolveThinkingConfiguration(model, input.thinkingLevel).thinkingLevel };
}

export function sessionReadiness(hasModel: boolean, availableCount: number, allCount: number): Readiness {
  if (hasModel) return { state: "ready" };
  if (allCount === 0) return { state: "missing-model", message: "Pi 没有可用模型配置" };
  if (availableCount === 0) return { state: "missing-credentials", message: "请先在 Pi 中配置模型凭据" };
  return { state: "unavailable-model", message: "当前会话模型不可用，请选择其他模型" };
}
