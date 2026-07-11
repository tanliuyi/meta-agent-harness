/**
 * 本文件测试 Desktop 全局模型设置服务。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelSettingsService } from '../model-settings-service'

const tempDirs: string[] = []

describe('ModelSettingsService', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('写入自定义 provider，刷新 registry，并回显 models.json apiKey 以便编辑', async () => {
    const dir = createTempDir()
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir
    })

    const snapshot = await service.upsertCustomProvider({
      provider: 'local-openai',
      name: 'Local OpenAI',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'ollama',
      models: [
        {
          id: 'qwen2.5-coder:7b',
          name: 'Qwen Coder Local',
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          maxTokens: 16000
        }
      ]
    })

    expect(snapshot.registry.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'local-openai',
          id: 'qwen2.5-coder:7b',
          status: 'available'
        })
      ])
    )
    expect(snapshot.customProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'local-openai',
          apiKey: 'ollama',
          hasApiKeyConfig: true,
          models: [
            expect.objectContaining({
              id: 'qwen2.5-coder:7b',
              contextWindow: 128000,
              maxTokens: 16000
            })
          ]
        })
      ])
    )
    expect(JSON.stringify(snapshot)).toContain('ollama')

    await service.upsertCustomProvider({
      provider: 'local-openai',
      name: 'Local OpenAI Edited',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      headers: { 'X-Test': 'yes' },
      compat: { supportsDeveloperRole: true },
      authHeader: false,
      models: [
        {
          id: 'qwen2.5-coder:7b',
          name: 'Qwen Coder Local',
          reasoning: true,
          thinkingLevelMap: { off: null, low: 'low', high: 'high' },
          input: ['text', 'image'],
          contextWindow: 128000,
          maxTokens: 16000,
          cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
          headers: { 'X-Model': 'qwen' },
          compat: { supportsReasoningEffort: true }
        }
      ],
      modelOverrides: {
        'built-in-model': {
          maxTokens: 8192
        }
      }
    })

    const modelsJson = JSON.parse(readFileSync(join(dir, 'agent', 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai'].apiKey).toBe('ollama')
    expect(modelsJson.providers['local-openai']).toMatchObject({
      name: 'Local OpenAI Edited',
      headers: { 'X-Test': 'yes' },
      compat: { supportsDeveloperRole: true },
      authHeader: false,
      modelOverrides: {
        'built-in-model': {
          maxTokens: 8192
        }
      }
    })
    expect(modelsJson.providers['local-openai'].models[0]).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { off: null, low: 'low', high: 'high' },
      input: ['text', 'image'],
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      headers: { 'X-Model': 'qwen' },
      compat: { supportsReasoningEffort: true }
    })

    const saved = await service.updateModelSettings({
      defaultProvider: 'local-openai',
      defaultModel: 'qwen2.5-coder:7b',
      defaultThinkingLevel: 'low',
      enabledModels: ['local-openai/qwen2.5-coder:7b']
    })

    expect(saved.settings).toMatchObject({
      defaultProvider: 'local-openai',
      defaultModel: 'qwen2.5-coder:7b',
      defaultThinkingLevel: 'low',
      enabledModels: ['local-openai/qwen2.5-coder:7b']
    })
  })

  it('重命名自定义 provider 时迁移 models.json 和 auth.json 中的 API key', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'old-provider',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKey: 'models-json-secret',
      models: [{ id: 'local-model' }]
    })
    await service.setProviderApiKey({
      provider: 'old-provider',
      key: 'auth-json-secret'
    })

    const snapshot = await service.upsertCustomProvider({
      provider: 'new-provider',
      originalProvider: 'old-provider',
      name: 'Renamed Provider',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [{ id: 'local-model' }]
    })

    const modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['old-provider']).toBeUndefined()
    expect(modelsJson.providers['new-provider']).toMatchObject({
      name: 'Renamed Provider',
      apiKey: 'models-json-secret'
    })

    const authJson = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf-8'))
    expect(authJson['old-provider']).toBeUndefined()
    expect(authJson['new-provider']).toMatchObject({
      type: 'api_key',
      key: 'auth-json-secret'
    })
    expect(snapshot.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'new-provider',
          status: 'configured',
          source: 'credentialStore'
        })
      ])
    )
    expect(snapshot.customProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'new-provider',
          apiKey: 'models-json-secret'
        })
      ])
    )
    expect(JSON.stringify(snapshot)).not.toContain('auth-json-secret')
  })

  it('将 provider API key 写入 Pi-compatible auth.json，snapshot 不回显明文', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({
      agentDir,
      cwd: dir
    })

    const snapshot = await service.setProviderApiKey({
      provider: 'openai',
      key: 'sk-test-secret'
    })

    const authPath = join(agentDir, 'auth.json')
    expect(existsSync(authPath)).toBe(true)
    expect(JSON.parse(readFileSync(authPath, 'utf-8'))).toMatchObject({
      openai: {
        type: 'api_key',
        key: 'sk-test-secret'
      }
    })
    expect(JSON.stringify(snapshot)).not.toContain('sk-test-secret')
    expect(snapshot.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai',
          status: 'configured',
          source: 'credentialStore'
        })
      ])
    )
  })

  it('标记支持 OAuth 的 provider，并拒绝不支持 OAuth 的 provider 登录', async () => {
    const dir = createTempDir()
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir
    })

    const snapshot = await service.getModelSettings()

    expect(snapshot.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai-codex',
          oauthAvailable: true
        })
      ])
    )
    await expect(service.loginProviderOAuth({ provider: 'openai' })).rejects.toThrow(
      'provider does not support OAuth'
    )
  })

  it('支持按配置项局部保存 thinking 和 enabledModels，不要求默认模型同时有效', async () => {
    const dir = createTempDir()
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir
    })

    const thinkingSaved = await service.updateModelSettings({
      defaultThinkingLevel: 'high'
    })
    expect(thinkingSaved.settings.defaultThinkingLevel).toBe('high')

    const modelsSaved = await service.updateModelSettings({
      enabledModels: ['openai/gpt-*', 'claude-*']
    })
    expect(modelsSaved.settings.enabledModels).toEqual(['openai/gpt-*', 'claude-*'])
    expect(modelsSaved.settings.defaultProvider).toBeUndefined()
    expect(modelsSaved.settings.defaultModel).toBeUndefined()
  })

  it('默认模型保存仍要求 provider 和 model 成对且存在', async () => {
    const dir = createTempDir()
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir
    })

    await expect(
      service.updateModelSettings({
        defaultProvider: 'openai'
      })
    ).rejects.toThrow('defaultProvider and defaultModel must be provided together')
  })

  it('models.json 损坏时返回诊断，写入自定义 provider 不覆盖原文件', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({
      agentDir,
      cwd: dir
    })
    const modelsPath = join(agentDir, 'models.json')
    writeFileSync(modelsPath, '{ bad json', 'utf-8')

    const snapshot = await service.getModelSettings()

    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'modelRegistry',
          message: 'models.json 解析失败'
        })
      ])
    )

    await expect(
      service.upsertCustomProvider({
        provider: 'local-openai',
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
        models: [{ id: 'qwen2.5-coder:7b' }]
      })
    ).rejects.toThrow('models.json 解析失败')
    expect(readFileSync(modelsPath, 'utf-8')).toBe('{ bad json')
  })
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meta-agent-model-settings-'))
  tempDirs.push(dir)
  return dir
}
