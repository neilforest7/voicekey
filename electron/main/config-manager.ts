import { safeStorage } from 'electron'
import Store from 'electron-store'
import {
  AppConfig,
  AppPreferences,
  ASRConfig,
  HotkeyConfig,
  LLMRefineConfig,
} from '../shared/types'
import { DEFAULT_HOTKEYS, LLM_REFINE } from '../shared/constants'

const ENCRYPTED_PREFIX = 'enc:'

// 配置Schema
interface ConfigSchema {
  app: AppPreferences
  asr: ASRConfig
  llmRefine: LLMRefineConfig
  hotkey: HotkeyConfig
}

// 默认配置
const defaultConfig: AppConfig = {
  app: {
    language: 'system',
    autoLaunch: false,
  },
  asr: {
    provider: 'glm',
    region: 'cn',
    apiKeys: {
      cn: '',
      intl: '',
    },
    lowVolumeMode: true,
    // apiKey: '',  // Deprecated, removed from default
    endpoint: '',
    language: 'auto',
  },
  llmRefine: {
    enabled: LLM_REFINE.ENABLED,
  },
  hotkey: {
    pttKey: DEFAULT_HOTKEYS.PTT,
    toggleSettings: DEFAULT_HOTKEYS.SETTINGS,
  },
}

// 配置管理器
export class ConfigManager {
  private store: Store<ConfigSchema>

  constructor() {
    this.store = new Store<ConfigSchema>({
      defaults: defaultConfig,
      name: 'voice-key-config',
    })
    this.migrate()
  }

  // 加密 API Key（返回 'enc:' + base64）
  private encryptKey(plainText: string): string {
    if (!plainText) return plainText
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plainText)
        return ENCRYPTED_PREFIX + encrypted.toString('base64')
      }
    } catch (e) {
      console.error('[ConfigManager] Failed to encrypt API key:', e)
    }
    return plainText
  }

  // 解密 API Key（自动识别是否已加密）
  private decryptKey(value: string): string {
    if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value
    try {
      const base64 = value.slice(ENCRYPTED_PREFIX.length)
      const buffer = Buffer.from(base64, 'base64')
      return safeStorage.decryptString(buffer)
    } catch (e) {
      console.error('[ConfigManager] Failed to decrypt API key:', e)
      return ''
    }
  }

  // 迁移旧配置
  private migrate(): void {
    // 检查是否有旧的 apiKey，如果有且 cn key 为空，则迁移
    // 使用 any 绕过类型检查，因为 we want to check raw store content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asrConfig = this.store.get('asr') as any
    if (asrConfig && asrConfig.apiKey) {
      const currentApiKeys = this.store.get('asr.apiKeys', { cn: '', intl: '' })
      if (!currentApiKeys.cn) {
        this.store.set('asr.apiKeys.cn', asrConfig.apiKey)
        this.store.delete('asr.apiKey' as any) // 迁移后删除旧字段
      }
    }

    // 低音量模式迁移策略：
    // - 新安装：defaultConfig 中已包含 lowVolumeMode=true，不处理
    // - 旧用户升级：若 asr 存在但无该字段，则显式写入 false
    if (
      asrConfig &&
      typeof asrConfig === 'object' &&
      !Object.prototype.hasOwnProperty.call(asrConfig, 'lowVolumeMode')
    ) {
      this.store.set('asr.lowVolumeMode', false)
    }

    // API Key 加密迁移：将明文 key 加密存储
    this.migrateApiKeysEncryption()
  }

  // 将未加密的 API Key 迁移为加密存储
  private migrateApiKeysEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) return

    const apiKeys = this.store.get('asr.apiKeys', { cn: '', intl: '' })
    for (const region of ['cn', 'intl'] as const) {
      const key = apiKeys[region]
      if (key && !key.startsWith(ENCRYPTED_PREFIX)) {
        apiKeys[region] = this.encryptKey(key)
      }
    }
    this.store.set('asr.apiKeys', apiKeys)
  }

  // 获取完整配置
  getConfig(): AppConfig {
    return {
      app: this.getAppConfig(),
      asr: this.getASRConfig(),
      llmRefine: this.getLLMRefineConfig(),
      hotkey: this.getHotkeyConfig(),
    }
  }

  // 获取 App 配置
  getAppConfig(): AppPreferences {
    return this.store.get('app', defaultConfig.app)
  }

  // 设置 App 配置
  setAppConfig(config: Partial<AppPreferences>): void {
    const current = this.getAppConfig()
    this.store.set('app', { ...current, ...config })
  }

  // 获取ASR配置
  getASRConfig(): ASRConfig {
    const config = this.store.get('asr', defaultConfig.asr)
    // 确保 apiKeys 存在 (防止旧的部分配置覆盖)
    if (!config.apiKeys) {
      config.apiKeys = { cn: '', intl: '' }
    }
    // 解密 API Keys
    config.apiKeys = {
      cn: this.decryptKey(config.apiKeys.cn),
      intl: this.decryptKey(config.apiKeys.intl),
    }
    // 确保 region 存在
    if (!config.region) {
      config.region = 'cn'
    }
    // 确保 lowVolumeMode 存在
    if (typeof config.lowVolumeMode !== 'boolean') {
      config.lowVolumeMode = defaultConfig.asr.lowVolumeMode
    }
    return config
  }

  // 设置ASR配置
  setASRConfig(config: Partial<ASRConfig>): void {
    const current = this.getASRConfig()
    const merged = { ...current, ...config }
    // 加密 API Keys 后再存储
    if (merged.apiKeys) {
      merged.apiKeys = {
        cn: this.encryptKey(merged.apiKeys.cn),
        intl: this.encryptKey(merged.apiKeys.intl),
      }
    }
    this.store.set('asr', merged)
  }

  // 获取 LLM 润色配置
  getLLMRefineConfig(): LLMRefineConfig {
    const config = this.store.get('llmRefine', defaultConfig.llmRefine)
    return {
      ...defaultConfig.llmRefine,
      enabled:
        typeof config.enabled === 'boolean' ? config.enabled : defaultConfig.llmRefine.enabled,
    }
  }

  // 设置 LLM 润色配置
  setLLMRefineConfig(config: Partial<LLMRefineConfig>): void {
    const current = this.getLLMRefineConfig()
    this.store.set('llmRefine', { ...current, ...config })
  }

  // 获取快捷键配置
  getHotkeyConfig(): HotkeyConfig {
    return this.store.get('hotkey', defaultConfig.hotkey)
  }

  // 设置快捷键配置
  setHotkeyConfig(config: Partial<HotkeyConfig>): void {
    const current = this.getHotkeyConfig()
    this.store.set('hotkey', { ...current, ...config })
  }

  // 重置为默认配置
  reset(): void {
    this.store.clear()
  }

  // 检查配置是否有效
  isValid(): boolean {
    const asr = this.getASRConfig()
    const region = asr.region || 'cn'
    const key = asr.apiKeys?.[region]
    return !!key && key.length > 0
  }
}

// 导出单例
export const configManager = new ConfigManager()
