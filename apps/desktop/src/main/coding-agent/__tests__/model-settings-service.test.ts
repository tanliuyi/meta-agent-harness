/**
 * 本文件测试 Desktop 全局模型设置服务。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStorage } from '@coding-agent-src/core/auth-storage'
import { ModelSettingsService } from '../model-settings-service'

const tempDirs: string[] = []

describe('ModelSettingsService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('自定义 provider 敏感配置仅回显状态，并支持保留、替换与清除', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({
      agentDir,
      cwd: dir
    })

    const initialSnapshot = await service.upsertCustomProvider({
      provider: 'local-openai',
      name: 'Local OpenAI',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'replace', value: 'api-key-v1' },
      headersUpdate: {
        mode: 'replace',
        value: { Authorization: 'provider-header-v1' }
      },
      models: [
        {
          id: 'qwen2.5-coder:7b',
          name: 'Qwen Coder Local',
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          maxTokens: 16000,
          headersUpdate: { mode: 'replace', value: { 'X-Model': 'model-header-v1' } }
        }
      ],
      modelOverrides: {
        'built-in-model': { maxTokens: 8192 }
      },
      modelOverrideHeadersUpdate: {
        mode: 'replace',
        value: { 'built-in-model': { 'X-Override': 'override-header-v1' } }
      }
    })

    expect(initialSnapshot.registry.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'local-openai',
          id: 'qwen2.5-coder:7b',
          status: 'available'
        })
      ])
    )
    expect(initialSnapshot.customProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'local-openai',
          hasApiKeyConfig: true,
          hasHeadersConfig: true,
          models: [
            expect.objectContaining({
              id: 'qwen2.5-coder:7b',
              contextWindow: 128000,
              maxTokens: 16000,
              hasHeadersConfig: true
            })
          ],
          modelOverrides: {
            'built-in-model': expect.objectContaining({ hasHeadersConfig: true })
          }
        })
      ])
    )
    const initialSummary = initialSnapshot.customProviders.find(
      (provider) => provider.provider === 'local-openai'
    )
    expect(initialSummary).not.toHaveProperty('apiKey')
    expect(initialSummary).not.toHaveProperty('headers')
    expect(initialSummary?.models?.[0]).not.toHaveProperty('headers')
    expect(initialSummary?.modelOverrides?.['built-in-model']).not.toHaveProperty('headers')
    for (const secret of [
      'api-key-v1',
      'provider-header-v1',
      'model-header-v1',
      'override-header-v1'
    ]) {
      expect(JSON.stringify(initialSnapshot)).not.toContain(secret)
      expect(JSON.stringify(await service.listCustomProviders())).not.toContain(secret)
    }

    await service.upsertCustomProvider({
      provider: 'local-openai',
      name: 'Local OpenAI Edited',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'preserve' },
      headersUpdate: { mode: 'preserve' },
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
          headersUpdate: { mode: 'preserve' },
          compat: { supportsReasoningEffort: true }
        }
      ],
      modelOverrides: {
        'built-in-model': {
          maxTokens: 8192
        }
      },
      modelOverrideHeadersUpdate: { mode: 'preserve' }
    })

    let modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai'].apiKey).toBe('api-key-v1')
    expect(modelsJson.providers['local-openai']).toMatchObject({
      name: 'Local OpenAI Edited',
      headers: { Authorization: 'provider-header-v1' },
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
      headers: { 'X-Model': 'model-header-v1' },
      compat: { supportsReasoningEffort: true }
    })
    expect(modelsJson.providers['local-openai'].modelOverrides['built-in-model'].headers).toEqual({
      'X-Override': 'override-header-v1'
    })

    const replacedSnapshot = await service.upsertCustomProvider({
      provider: 'local-openai',
      name: 'Local OpenAI Edited',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'replace', value: 'api-key-v2' },
      headersUpdate: { mode: 'replace', value: { Authorization: 'provider-header-v2' } },
      models: [
        {
          id: 'qwen2.5-coder:7b',
          name: 'Qwen Coder Local',
          headersUpdate: { mode: 'replace', value: { 'X-Model': 'model-header-v2' } }
        }
      ],
      modelOverrides: { 'built-in-model': { maxTokens: 4096 } },
      modelOverrideHeadersUpdate: {
        mode: 'replace',
        value: { 'built-in-model': { 'X-Override': 'override-header-v2' } }
      }
    })

    modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai']).toMatchObject({
      apiKey: 'api-key-v2',
      headers: { Authorization: 'provider-header-v2' },
      models: [{ headers: { 'X-Model': 'model-header-v2' } }],
      modelOverrides: {
        'built-in-model': { headers: { 'X-Override': 'override-header-v2' } }
      }
    })
    const persistedText = JSON.stringify(modelsJson)
    expect(persistedText).not.toContain('apiKeyUpdate')
    expect(persistedText).not.toContain('headersUpdate')
    expect(persistedText).not.toContain('modelOverrideHeadersUpdate')
    for (const secret of [
      'api-key-v2',
      'provider-header-v2',
      'model-header-v2',
      'override-header-v2'
    ]) {
      expect(JSON.stringify(replacedSnapshot)).not.toContain(secret)
    }

    const clearedSnapshot = await service.upsertCustomProvider({
      provider: 'local-openai',
      name: 'Local OpenAI Edited',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'clear' },
      headersUpdate: { mode: 'clear' },
      models: [
        {
          id: 'qwen2.5-coder:7b',
          name: 'Qwen Coder Local',
          headersUpdate: { mode: 'clear' }
        }
      ],
      modelOverrides: { 'built-in-model': { maxTokens: 4096 } },
      modelOverrideHeadersUpdate: { mode: 'clear' }
    })

    modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai'].apiKey).toBeUndefined()
    expect(modelsJson.providers['local-openai'].headers).toBeUndefined()
    expect(modelsJson.providers['local-openai'].models[0].headers).toBeUndefined()
    expect(
      modelsJson.providers['local-openai'].modelOverrides['built-in-model'].headers
    ).toBeUndefined()
    expect(clearedSnapshot.customProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'local-openai',
          hasApiKeyConfig: false,
          hasHeadersConfig: false,
          models: [expect.objectContaining({ hasHeadersConfig: false })],
          modelOverrides: {
            'built-in-model': expect.objectContaining({ hasHeadersConfig: false })
          }
        })
      ])
    )

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

  it('重命名模型时按 previousId 保留 header，且控制字段不落盘', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [
        {
          id: 'old-model',
          headersUpdate: { mode: 'replace', value: { 'X-Secret': 'preserved' } }
        }
      ]
    })

    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [
        {
          id: 'renamed-model',
          previousId: 'old-model',
          headersUpdate: { mode: 'preserve' }
        }
      ]
    })

    const modelsText = readFileSync(join(agentDir, 'models.json'), 'utf-8')
    const modelsJson = JSON.parse(modelsText)
    expect(modelsJson.providers['local-openai'].models).toEqual([
      expect.objectContaining({
        id: 'renamed-model',
        headers: { 'X-Secret': 'preserved' }
      })
    ])
    expect(modelsText).not.toContain('previousId')
    expect(modelsText).not.toContain('headersUpdate')
  })

  it('拒绝模型跨 endpoint 使用 previousId 保留 header', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'https://trusted.example/v1',
      api: 'openai-completions',
      models: [
        {
          id: 'old-model',
          headersUpdate: { mode: 'replace', value: { Authorization: 'model-secret' } }
        }
      ]
    })

    await expect(
      service.upsertCustomProvider({
        provider: 'local-openai',
        baseUrl: 'https://trusted.example/v1',
        api: 'openai-completions',
        models: [
          {
            id: 'renamed-model',
            previousId: 'old-model',
            baseUrl: 'https://attacker.example/v1',
            headersUpdate: { mode: 'preserve' }
          }
        ]
      })
    ).rejects.toThrow('cannot preserve headers across request targets')

    const modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai'].models).toEqual([
      expect.objectContaining({
        id: 'old-model',
        headers: { Authorization: 'model-secret' }
      })
    ])
  })

  it('endpoint 变化时要求显式清除或替换 models.json 敏感配置', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'https://trusted.example/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'replace', value: 'provider-api-key' },
      headersUpdate: { mode: 'replace', value: { Authorization: 'provider-header' } },
      models: [{ id: 'local-model' }]
    })

    await expect(
      service.upsertCustomProvider({
        provider: 'local-openai',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-completions',
        apiKeyUpdate: { mode: 'clear' },
        headersUpdate: { mode: 'preserve' },
        models: [{ id: 'local-model' }]
      })
    ).rejects.toThrow('headersUpdate cannot preserve sensitive configuration')
    await expect(
      service.upsertCustomProvider({
        provider: 'local-openai',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-completions',
        apiKeyUpdate: { mode: 'preserve' },
        headersUpdate: { mode: 'clear' },
        models: [{ id: 'local-model' }]
      })
    ).rejects.toThrow('apiKeyUpdate cannot preserve sensitive configuration')

    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'https://attacker.example/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'clear' },
      headersUpdate: { mode: 'clear' },
      models: [{ id: 'local-model' }]
    })

    const modelsText = readFileSync(join(agentDir, 'models.json'), 'utf-8')
    const modelsJson = JSON.parse(modelsText)
    expect(modelsJson.providers['local-openai'].baseUrl).toBe('https://attacker.example/v1')
    expect(modelsJson.providers['local-openai'].apiKey).toBeUndefined()
    expect(modelsJson.providers['local-openai'].headers).toBeUndefined()
    expect(modelsText).not.toContain('provider-api-key')
    expect(modelsText).not.toContain('provider-header')
  })

  it('拒绝 endpoint 变化时保留 model override headers', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'openai',
      baseUrl: 'https://trusted.example/v1',
      modelOverrides: { 'gpt-test': { maxTokens: 4096 } },
      modelOverrideHeadersUpdate: {
        mode: 'replace',
        value: { 'gpt-test': { Authorization: 'override-secret' } }
      }
    })

    await expect(
      service.upsertCustomProvider({
        provider: 'openai',
        baseUrl: 'https://attacker.example/v1',
        modelOverrides: { 'gpt-test': { maxTokens: 4096 } },
        modelOverrideHeadersUpdate: { mode: 'preserve' }
      })
    ).rejects.toThrow('cannot preserve headers for gpt-test across request targets')

    const modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers.openai.baseUrl).toBe('https://trusted.example/v1')
    expect(modelsJson.providers.openai.modelOverrides['gpt-test'].headers).toEqual({
      Authorization: 'override-secret'
    })
  })

  it('auth.json 凭据存在时拒绝同一 provider 改向新 endpoint', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'https://trusted.example/v1',
      api: 'openai-completions',
      models: [{ id: 'local-model' }]
    })
    await service.setProviderApiKey({ provider: 'local-openai', key: 'stored-secret' })

    await expect(
      service.upsertCustomProvider({
        provider: 'local-openai',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-completions',
        models: [{ id: 'local-model' }]
      })
    ).rejects.toThrow('stored provider credential must be cleared')

    let modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai'].baseUrl).toBe('https://trusted.example/v1')
    expect(
      JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf-8'))['local-openai']
    ).toMatchObject({ key: 'stored-secret' })

    await service.setProviderApiKey({ provider: 'local-openai', mode: 'clear' })
    await service.upsertCustomProvider({
      provider: 'local-openai',
      baseUrl: 'https://attacker.example/v1',
      api: 'openai-completions',
      models: [{ id: 'local-model' }]
    })
    modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['local-openai'].baseUrl).toBe('https://attacker.example/v1')
    expect(readFileSync(join(agentDir, 'auth.json'), 'utf-8')).not.toContain('stored-secret')
  })

  it('环境变量凭据存在时拒绝覆盖内置 provider endpoint', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-secret')
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await expect(
      service.upsertCustomProvider({
        provider: 'openai',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-completions'
      })
    ).rejects.toThrow('stored provider credential must be cleared')

    expect(existsSync(join(agentDir, 'models.json'))).toBe(false)
  })

  it('运行时凭据存在时拒绝 provider 改向新 endpoint', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })
    const authStorage = (service as unknown as { authStorage: AuthStorage }).authStorage
    authStorage.setRuntimeApiKey('runtime-provider', 'runtime-secret')

    await expect(
      service.upsertCustomProvider({
        provider: 'runtime-provider',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-completions'
      })
    ).rejects.toThrow('stored provider credential must be cleared')

    expect(existsSync(join(agentDir, 'models.json'))).toBe(false)
  })

  it('upsert 前刷新另一进程刚写入的 auth.json 凭据', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })
    writeFileSync(
      join(agentDir, 'auth.json'),
      JSON.stringify({
        'external-provider': { type: 'api_key', key: 'external-secret' }
      }),
      'utf-8'
    )

    await expect(
      service.upsertCustomProvider({
        provider: 'external-provider',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-completions'
      })
    ).rejects.toThrow('stored provider credential must be cleared')

    expect(existsSync(join(agentDir, 'models.json'))).toBe(false)
  })

  it('provider 重命名或 endpoint 变化前必须清除 auth.json 凭据且不会自动迁移', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })

    await service.upsertCustomProvider({
      provider: 'old-provider',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'replace', value: 'models-json-secret' },
      models: [{ id: 'local-model' }]
    })
    await service.setProviderApiKey({
      provider: 'old-provider',
      key: 'auth-json-secret'
    })

    await expect(
      service.upsertCustomProvider({
        provider: 'new-provider',
        originalProvider: 'old-provider',
        name: 'Renamed Provider',
        baseUrl: 'http://localhost:11434/v1',
        api: 'openai-completions',
        apiKeyUpdate: { mode: 'clear' },
        models: [{ id: 'local-model' }]
      })
    ).rejects.toThrow('stored provider credential must be cleared')

    let modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['old-provider']).toBeDefined()
    expect(modelsJson.providers['new-provider']).toBeUndefined()
    let authJson = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf-8'))
    expect(authJson['old-provider']).toMatchObject({ key: 'auth-json-secret' })
    expect(authJson['new-provider']).toBeUndefined()

    await service.setProviderApiKey({ provider: 'old-provider', mode: 'clear' })
    const snapshot = await service.upsertCustomProvider({
      provider: 'new-provider',
      originalProvider: 'old-provider',
      name: 'Renamed Provider',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      apiKeyUpdate: { mode: 'clear' },
      models: [{ id: 'local-model' }]
    })

    modelsJson = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'))
    expect(modelsJson.providers['old-provider']).toBeUndefined()
    expect(modelsJson.providers['new-provider']).toMatchObject({
      name: 'Renamed Provider'
    })
    expect(modelsJson.providers['new-provider'].apiKey).toBeUndefined()

    authJson = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf-8'))
    expect(authJson['old-provider']).toBeUndefined()
    expect(authJson['new-provider']).toBeUndefined()
    expect(snapshot.customProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'new-provider',
          hasApiKeyConfig: false
        })
      ])
    )
    expect(
      snapshot.customProviders.find((provider) => provider.provider === 'new-provider')
    ).not.toHaveProperty('apiKey')
    expect(JSON.stringify(snapshot)).not.toContain('models-json-secret')
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

  it('将 owner AbortSignal 传给 OAuth provider，取消后不写入凭据', async () => {
    const dir = createTempDir()
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir
    })
    const authStorage = (service as unknown as { authStorage: AuthStorage }).authStorage
    const ownerLifetime = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const login = vi
      .spyOn(authStorage, 'login')
      .mockImplementation(async (_provider, callbacks) => {
        receivedSignal = callbacks.signal
        await new Promise<never>((_resolve, reject) => {
          callbacks.signal?.addEventListener('abort', () => reject(new Error('owner aborted')), {
            once: true
          })
        })
      })

    const result = service.loginProviderOAuth({ provider: 'openai-codex' }, undefined, {
      ownerId: 7,
      signal: ownerLifetime.signal
    })
    ownerLifetime.abort()

    await expect(result).rejects.toThrow('owner aborted')
    expect(receivedSignal).toBe(ownerLifetime.signal)
    expect(login).toHaveBeenCalledTimes(1)
    expect(authStorage.has('openai-codex')).toBe(false)
  })

  it('OAuth 登录进行中拒绝同 provider 的 endpoint 或身份变化', async () => {
    const dir = createTempDir()
    const agentDir = join(dir, 'agent')
    const service = new ModelSettingsService({ agentDir, cwd: dir })
    const authStorage = (service as unknown as { authStorage: AuthStorage }).authStorage
    let completeLogin!: () => void
    vi.spyOn(authStorage, 'login').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeLogin = resolve
        })
    )

    const login = service.loginProviderOAuth({ provider: 'openai-codex' })

    await expect(
      service.upsertCustomProvider({
        provider: 'openai-codex',
        baseUrl: 'https://attacker.example/v1',
        api: 'openai-responses'
      })
    ).rejects.toThrow('cannot change while OAuth login is in progress')
    expect(existsSync(join(agentDir, 'models.json'))).toBe(false)

    completeLogin()
    await expect(login).resolves.toEqual(
      expect.objectContaining({ credentials: expect.any(Array) })
    )
  })

  it.each([
    ['auth URL', 'javascript:alert(1)', 'auth'],
    ['device URL', 'file:///tmp/token', 'device'],
    ['mailto URL', 'mailto:oauth@example.com', 'auth']
  ] as const)('拒绝 OAuth provider 返回的非 HTTP(S) %s', async (_label, uri, kind) => {
    const dir = createTempDir()
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir
    })
    const authStorage = (service as unknown as { authStorage: AuthStorage }).authStorage
    vi.spyOn(authStorage, 'login').mockImplementation(async (_provider, callbacks) => {
      if (kind === 'auth') {
        callbacks.onAuth({ url: uri })
        return
      }
      callbacks.onDeviceCode({
        userCode: 'code',
        verificationUri: uri,
        intervalSeconds: 5,
        expiresInSeconds: 60
      })
    })

    await expect(service.loginProviderOAuth({ provider: 'openai-codex' })).rejects.toThrow(
      'protocol is not allowed'
    )
    expect(authStorage.has('openai-codex')).toBe(false)
  })

  it('完整外部协议能力允许 OAuth provider 使用自定义 URI scheme', async () => {
    const dir = createTempDir()
    writeFileSync(
      join(dir, 'desktop-runtime.json'),
      JSON.stringify({ externalProtocolAccess: 'full' })
    )
    const openExternal = vi.fn(async () => undefined)
    const service = new ModelSettingsService({
      agentDir: join(dir, 'agent'),
      cwd: dir,
      openExternal
    })
    const authStorage = (service as unknown as { authStorage: AuthStorage }).authStorage
    vi.spyOn(authStorage, 'login').mockImplementation(async (_provider, callbacks) => {
      callbacks.onAuth({ url: 'my-oauth://callback?request=1' })
    })

    await expect(service.loginProviderOAuth({ provider: 'openai-codex' })).resolves.toBeDefined()
    expect(openExternal).toHaveBeenCalledWith('my-oauth://callback?request=1')
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
