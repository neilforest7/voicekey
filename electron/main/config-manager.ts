import { safeStorage } from 'electron'
import Store from 'electron-store'
import {
  AppConfig,
  AppPreferences,
  ASRConfig,
  HotkeyConfig,
  LLMRefineConfig,
} from '../shared/types'
import { normalizeRefineBaseUrl } from '../shared/refine-url'
import { DEFAULT_HOTKEYS, LLM_REFINE } from '../shared/constants'

const ENCRYPTED_PREFIX = 'enc:'

interface ConfigSchema {
  app: AppPreferences
  asr: ASRConfig
  llmRefine: LLMRefineConfig
  hotkey: HotkeyConfig
}

const defaultLLMRefineConfig: LLMRefineConfig = {
  enabled: LLM_REFINE.ENABLED,
  endpoint: LLM_REFINE.ENDPOINT,
  model: LLM_REFINE.MODEL,
  apiKey: LLM_REFINE.API_KEY,
  translateToEnglish: LLM_REFINE.TRANSLATE_TO_ENGLISH,
}

function readTranslateToEnglishFlag(config?: Record<string, unknown>): boolean {
  if (!config) {
    return defaultLLMRefineConfig.translateToEnglish
  }

  if (typeof config.translateToEnglish === 'boolean') {
    return config.translateToEnglish
  }

  if (typeof config.translateChineseToEnglish === 'boolean') {
    return config.translateChineseToEnglish
  }

  return defaultLLMRefineConfig.translateToEnglish
}

const defaultConfig: AppConfig = {
  app: {
    language: 'system',
    autoLaunch: false,
  },
  asr: {
    provider: 'glm',
    glm: {
      region: 'cn',
      apiKeys: {
        cn: '',
        intl: '',
      },
      endpoint: '',
    },
    volcengine: {
      appKey: '',
      accessKey: '',
      resourceId: '',
      endpoint: '',
    },
    lowVolumeMode: true,
    streamingMode: false,
    language: 'auto',
  },
  llmRefine: defaultLLMRefineConfig,
  hotkey: {
    pttKey: DEFAULT_HOTKEYS.PTT,
    toggleSettings: DEFAULT_HOTKEYS.SETTINGS,
  },
}

function normalizeLLMRefineConfig(config?: Partial<LLMRefineConfig>): LLMRefineConfig {
  const rawConfig =
    config && typeof config === 'object'
      ? (config as Partial<LLMRefineConfig> & Record<string, unknown>)
      : undefined

  return {
    ...defaultLLMRefineConfig,
    enabled: typeof config?.enabled === 'boolean' ? config.enabled : defaultLLMRefineConfig.enabled,
    endpoint: normalizeRefineBaseUrl(
      typeof config?.endpoint === 'string' && config.endpoint.trim().length > 0
        ? config.endpoint
        : defaultLLMRefineConfig.endpoint,
    ),
    model:
      typeof config?.model === 'string' && config.model.trim().length > 0
        ? config.model
        : defaultLLMRefineConfig.model,
    apiKey: config?.apiKey ?? defaultLLMRefineConfig.apiKey,
    translateToEnglish: readTranslateToEnglishFlag(rawConfig),
  }
}

function readLegacyOpenAICompatibleField(
  config: Record<string, unknown>,
  key: 'endpoint' | 'model' | 'apiKey',
): string {
  const openaiCompatible = config.openaiCompatible
  if (!openaiCompatible || typeof openaiCompatible !== 'object') {
    return defaultLLMRefineConfig[key]
  }

  const value = (openaiCompatible as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : defaultLLMRefineConfig[key]
}

function migrateLLMRefineConfig(config: unknown): LLMRefineConfig | null {
  if (typeof config === 'boolean') {
    return defaultLLMRefineConfig
  }

  if (!config || typeof config !== 'object') {
    return null
  }

  const rawConfig = config as Record<string, unknown>

  if ('provider' in rawConfig || 'openaiCompatible' in rawConfig) {
    if (rawConfig.provider === 'openai-compatible') {
      return normalizeLLMRefineConfig({
        enabled:
          typeof rawConfig.enabled === 'boolean'
            ? rawConfig.enabled
            : defaultLLMRefineConfig.enabled,
        endpoint: readLegacyOpenAICompatibleField(rawConfig, 'endpoint'),
        model: readLegacyOpenAICompatibleField(rawConfig, 'model'),
        apiKey: readLegacyOpenAICompatibleField(rawConfig, 'apiKey'),
      })
    }

    return defaultLLMRefineConfig
  }

  if (
    'endpoint' in rawConfig ||
    'model' in rawConfig ||
    'apiKey' in rawConfig ||
    'enabled' in rawConfig ||
    'translateToEnglish' in rawConfig ||
    'translateChineseToEnglish' in rawConfig
  ) {
    return normalizeLLMRefineConfig(rawConfig as Partial<LLMRefineConfig>)
  }

  return null
}

function normalizeASRConfig(config?: Partial<ASRConfig> | Record<string, unknown>): ASRConfig {
  const rawConfig =
    config && typeof config === 'object'
      ? (config as Partial<ASRConfig> & Record<string, unknown>)
      : {}

  const glm = rawConfig.glm
  const rawGlm = glm && typeof glm === 'object' ? (glm as Record<string, unknown>) : {}

  const volcengine = rawConfig.volcengine
  const rawVolcengine =
    volcengine && typeof volcengine === 'object' ? (volcengine as Record<string, unknown>) : {}

  const legacyApiKeys =
    rawConfig.apiKeys && typeof rawConfig.apiKeys === 'object'
      ? (rawConfig.apiKeys as Record<string, unknown>)
      : {}

  const provider = rawConfig.provider === 'volcengine' ? 'volcengine' : 'glm'

  return {
    provider,
    lowVolumeMode:
      typeof rawConfig.lowVolumeMode === 'boolean'
        ? rawConfig.lowVolumeMode
        : defaultConfig.asr.lowVolumeMode,
    streamingMode:
      typeof rawConfig.streamingMode === 'boolean'
        ? rawConfig.streamingMode
        : defaultConfig.asr.streamingMode,
    language:
      typeof rawConfig.language === 'string' ? rawConfig.language : defaultConfig.asr.language,
    glm: {
      region:
        rawGlm.region === 'intl' || rawConfig.region === 'intl'
          ? 'intl'
          : defaultConfig.asr.glm.region,
      apiKeys: {
        cn:
          typeof rawGlm.apiKeys === 'object' && rawGlm.apiKeys && 'cn' in rawGlm.apiKeys
            ? String((rawGlm.apiKeys as Record<string, unknown>).cn ?? '')
            : typeof legacyApiKeys.cn === 'string'
              ? legacyApiKeys.cn
              : '',
        intl:
          typeof rawGlm.apiKeys === 'object' && rawGlm.apiKeys && 'intl' in rawGlm.apiKeys
            ? String((rawGlm.apiKeys as Record<string, unknown>).intl ?? '')
            : typeof legacyApiKeys.intl === 'string'
              ? legacyApiKeys.intl
              : '',
      },
      endpoint:
        typeof rawGlm.endpoint === 'string'
          ? rawGlm.endpoint
          : typeof rawConfig.endpoint === 'string'
            ? rawConfig.endpoint
            : defaultConfig.asr.glm.endpoint,
    },
    volcengine: {
      appKey:
        typeof rawVolcengine.appKey === 'string'
          ? rawVolcengine.appKey
          : typeof rawVolcengine.appId === 'string'
            ? rawVolcengine.appId
            : typeof rawConfig.appKey === 'string'
              ? rawConfig.appKey
              : typeof rawConfig.appId === 'string'
                ? rawConfig.appId
                : defaultConfig.asr.volcengine.appKey,
      accessKey:
        typeof rawVolcengine.accessKey === 'string'
          ? rawVolcengine.accessKey
          : typeof rawConfig.accessKey === 'string'
            ? rawConfig.accessKey
            : defaultConfig.asr.volcengine.accessKey,
      resourceId:
        typeof rawVolcengine.resourceId === 'string'
          ? rawVolcengine.resourceId
          : typeof rawConfig.resourceId === 'string'
            ? rawConfig.resourceId
            : defaultConfig.asr.volcengine.resourceId,
      endpoint:
        typeof rawVolcengine.endpoint === 'string'
          ? rawVolcengine.endpoint
          : defaultConfig.asr.volcengine.endpoint,
    },
  }
}

export class ConfigManager {
  private store: Store<ConfigSchema>

  constructor() {
    this.store = new Store<ConfigSchema>({
      defaults: defaultConfig,
      name: 'voice-key-config',
    })
    this.migrate()
  }

  private encryptKey(plainText: string): string {
    if (!plainText) return plainText

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plainText)
        return ENCRYPTED_PREFIX + encrypted.toString('base64')
      }
    } catch (error) {
      console.error('[ConfigManager] Failed to encrypt API key:', error)
    }

    return plainText
  }

  private decryptKey(value: string): string {
    if (!value || !value.startsWith(ENCRYPTED_PREFIX)) {
      return value
    }

    try {
      const base64 = value.slice(ENCRYPTED_PREFIX.length)
      const buffer = Buffer.from(base64, 'base64')
      return safeStorage.decryptString(buffer)
    } catch (error) {
      console.error('[ConfigManager] Failed to decrypt API key:', error)
      return ''
    }
  }

  private migrate(): void {
    const asrConfig = this.store.get('asr') as unknown as Record<string, unknown> | undefined
    const migratedAsrConfig = normalizeASRConfig(asrConfig)
    this.store.set('asr', migratedAsrConfig)

    if (
      asrConfig &&
      typeof asrConfig === 'object' &&
      !Object.prototype.hasOwnProperty.call(asrConfig, 'lowVolumeMode')
    ) {
      this.store.set('asr.lowVolumeMode', false)
    }

    if (
      asrConfig &&
      typeof asrConfig === 'object' &&
      !Object.prototype.hasOwnProperty.call(asrConfig, 'streamingMode')
    ) {
      this.store.set('asr.streamingMode', false)
    }

    const llmRefineConfig = this.store.get('llmRefine')
    const migratedLLMRefineConfig = migrateLLMRefineConfig(llmRefineConfig)
    if (migratedLLMRefineConfig) {
      this.store.set('llmRefine', migratedLLMRefineConfig)
    }
  }

  // Must be called after app.whenReady() because safeStorage needs ready on Windows/Linux.
  migrateApiKeysEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) return

    const asr = normalizeASRConfig(this.store.get('asr', defaultConfig.asr))
    const apiKeys = asr.glm.apiKeys
    for (const region of ['cn', 'intl'] as const) {
      const key = apiKeys[region]
      if (key && !key.startsWith(ENCRYPTED_PREFIX)) {
        apiKeys[region] = this.encryptKey(key)
      }
    }

    let volcengineAccessKey = asr.volcengine.accessKey
    if (volcengineAccessKey && !volcengineAccessKey.startsWith(ENCRYPTED_PREFIX)) {
      volcengineAccessKey = this.encryptKey(volcengineAccessKey)
    }

    this.store.set('asr', {
      ...asr,
      glm: {
        ...asr.glm,
        apiKeys,
      },
      volcengine: {
        ...asr.volcengine,
        accessKey: volcengineAccessKey,
      },
    })

    const llmRefine = normalizeLLMRefineConfig(this.store.get('llmRefine', defaultConfig.llmRefine))
    if (llmRefine.apiKey && !llmRefine.apiKey.startsWith(ENCRYPTED_PREFIX)) {
      this.store.set('llmRefine', {
        ...llmRefine,
        apiKey: this.encryptKey(llmRefine.apiKey),
      })
    }
  }

  getConfig(): AppConfig {
    return {
      app: this.getAppConfig(),
      asr: this.getASRConfig(),
      llmRefine: this.getLLMRefineConfig(),
      hotkey: this.getHotkeyConfig(),
    }
  }

  getAppConfig(): AppPreferences {
    return this.store.get('app', defaultConfig.app)
  }

  setAppConfig(config: Partial<AppPreferences>): void {
    const current = this.getAppConfig()
    this.store.set('app', { ...current, ...config })
  }

  getASRConfig(): ASRConfig {
    const config = normalizeASRConfig(this.store.get('asr', defaultConfig.asr))
    return {
      ...config,
      glm: {
        ...config.glm,
        apiKeys: {
          cn: this.decryptKey(config.glm.apiKeys.cn),
          intl: this.decryptKey(config.glm.apiKeys.intl),
        },
      },
      volcengine: {
        ...config.volcengine,
        accessKey: this.decryptKey(config.volcengine.accessKey),
      },
    }
  }

  setASRConfig(config: Partial<ASRConfig>): void {
    const current = this.getASRConfig()
    const merged = normalizeASRConfig({
      ...current,
      ...config,
      glm: {
        ...current.glm,
        ...config.glm,
        apiKeys: config.glm?.apiKeys
          ? {
              ...current.glm.apiKeys,
              ...config.glm.apiKeys,
            }
          : current.glm.apiKeys,
      },
      volcengine: {
        ...current.volcengine,
        ...config.volcengine,
      },
    })

    merged.glm.apiKeys = {
      cn: this.encryptKey(merged.glm.apiKeys.cn),
      intl: this.encryptKey(merged.glm.apiKeys.intl),
    }
    merged.volcengine.accessKey = this.encryptKey(merged.volcengine.accessKey)
    this.store.set('asr', merged)
  }

  getLLMRefineConfig(): LLMRefineConfig {
    const config = normalizeLLMRefineConfig(this.store.get('llmRefine', defaultConfig.llmRefine))
    return {
      ...config,
      apiKey: this.decryptKey(config.apiKey),
    }
  }

  setLLMRefineConfig(config: Partial<LLMRefineConfig>): void {
    const current = this.getLLMRefineConfig()
    const merged = normalizeLLMRefineConfig({ ...current, ...config })
    this.store.set('llmRefine', {
      ...merged,
      apiKey: this.encryptKey(merged.apiKey),
    })
  }

  getHotkeyConfig(): HotkeyConfig {
    return this.store.get('hotkey', defaultConfig.hotkey)
  }

  setHotkeyConfig(config: Partial<HotkeyConfig>): void {
    const current = this.getHotkeyConfig()
    this.store.set('hotkey', { ...current, ...config })
  }

  reset(): void {
    this.store.clear()
  }

  isValid(): boolean {
    const asr = this.getASRConfig()
    if (asr.provider === 'volcengine') {
      return Boolean(asr.volcengine.appKey.trim() && asr.volcengine.accessKey.trim())
    }

    const region = asr.glm.region || 'cn'
    const key = asr.glm.apiKeys?.[region]
    return Boolean(key && key.length > 0)
  }
}

export const configManager = new ConfigManager()
