import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULT_HOTKEYS, LLM_REFINE } from '../../shared/constants'

type StoreData = Record<string, unknown>

const getByPath = (data: StoreData, key: string): unknown => {
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, data)
}

const setByPath = (data: StoreData, key: string, value: unknown): void => {
  const parts = key.split('.')
  let current = data as Record<string, unknown>
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value
      return
    }
    const next = current[part]
    if (!next || typeof next !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  })
}

const deleteByPath = (data: StoreData, key: string): void => {
  const parts = key.split('.')
  let current = data as Record<string, unknown>
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      delete current[part]
      return
    }
    const next = current[part]
    if (!next || typeof next !== 'object') {
      return
    }
    current = next as Record<string, unknown>
  })
}

let seedData: StoreData = {}

vi.mock('electron-store', () => ({
  default: class MockStore {
    private data: StoreData

    constructor(options?: { defaults?: StoreData }) {
      this.data = options?.defaults ? structuredClone(options.defaults) : {}
      Object.assign(this.data, structuredClone(seedData))
    }

    get<T>(key: string, defaultValue?: T): T {
      const value = getByPath(this.data, key)
      return (value === undefined ? defaultValue : value) as T
    }

    set(key: string, value: unknown) {
      setByPath(this.data, key, value)
    }

    delete(key: string) {
      deleteByPath(this.data, key)
    }

    clear() {
      this.data = {}
    }
  },
}))

describe('ConfigManager', () => {
  const createManager = async () => {
    const module = await import('../config-manager')
    return new module.ConfigManager()
  }

  beforeEach(() => {
    seedData = {}
    vi.resetModules()
  })

  it('returns default hotkeys', async () => {
    const configManager = await createManager()
    const config = configManager.getHotkeyConfig()
    expect(config.pttKey).toBe(DEFAULT_HOTKEYS.PTT)
    expect(config.toggleSettings).toBe(DEFAULT_HOTKEYS.SETTINGS)
  })

  it('persists partial app config', async () => {
    const configManager = await createManager()
    configManager.setAppConfig({ autoLaunch: true })
    expect(configManager.getAppConfig().autoLaunch).toBe(true)
  })

  it('returns default llm refine config', async () => {
    const configManager = await createManager()
    const config = configManager.getLLMRefineConfig()
    expect(config.enabled).toBe(LLM_REFINE.ENABLED)
  })

  it('persists partial llm refine config', async () => {
    const configManager = await createManager()
    configManager.setLLMRefineConfig({
      enabled: false,
    })
    expect(configManager.getLLMRefineConfig()).toMatchObject({
      enabled: false,
    })
  })

  it('enables low volume mode by default for new installs', async () => {
    const configManager = await createManager()
    expect(configManager.getASRConfig().lowVolumeMode).toBe(true)
  })

  it('migrates existing users to low volume mode disabled', async () => {
    seedData = {
      asr: {
        provider: 'glm',
        region: 'cn',
        apiKeys: { cn: 'legacy', intl: '' },
        endpoint: '',
        language: 'auto',
      },
    }
    const configManager = await createManager()
    expect(configManager.getASRConfig().lowVolumeMode).toBe(false)
  })
})
