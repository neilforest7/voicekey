import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AppListener = (...args: unknown[]) => void

const appState = vi.hoisted(() => ({
  listeners: new Map<string, AppListener>(),
  readyPromise: null as Promise<void> | null,
  readyResolve: null as null | (() => void),
}))

const mockWhenReady = vi.hoisted(() =>
  vi.fn(() => {
    if (!appState.readyPromise) {
      appState.readyPromise = new Promise((resolve) => {
        appState.readyResolve = resolve
      })
    }
    return appState.readyPromise
  }),
)

const mockAppOn = vi.hoisted(() =>
  vi.fn((event: string, listener: AppListener) => {
    appState.listeners.set(event, listener)
  }),
)

const mockSetLoginItemSettings = vi.hoisted(() => vi.fn())
const mockGetLoginItemSettings = vi.hoisted(() => vi.fn(() => ({ wasOpenedAsHidden: false })))
const mockSetName = vi.hoisted(() => vi.fn())
const mockDockSetIcon = vi.hoisted(() => vi.fn())
const mockGetAllWindows = vi.hoisted(() => vi.fn((): any[] => []))
const mockSetApplicationMenu = vi.hoisted(() => vi.fn())
const mockCreateFromPath = vi.hoisted(() => vi.fn(() => ({})))

const mockInitEnv = vi.hoisted(() => vi.fn())
const mockInitializeLogger = vi.hoisted(() => vi.fn())
const mockInitMainI18n = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockSyncSystemLocaleIfNeeded = vi.hoisted(() => vi.fn().mockResolvedValue(false))
const mockBroadcastLanguageSnapshot = vi.hoisted(() => vi.fn())
const mockSendLanguageSnapshotToWindow = vi.hoisted(() => vi.fn())
const mockT = vi.hoisted(() => vi.fn((key: string) => `t:${key}`))

const mockGetAppConfig = vi.hoisted(() => vi.fn(() => ({ language: 'en', autoLaunch: true })))
const mockGetASRConfig = vi.hoisted(() =>
  vi.fn(() => ({ provider: 'glm', region: 'cn', apiKeys: {}, lowVolumeMode: true })),
)
const mockGetLLMRefineConfig = vi.hoisted(() =>
  vi.fn(() => ({
    enabled: true,
  })),
)
const mockASRProviderCtor = vi.hoisted(() => vi.fn())
const mockLLMProviderCtor = vi.hoisted(() => vi.fn())

const mockRegisterGlobalHotkeys = vi.hoisted(() => vi.fn())
const mockHotkeyUnregisterAll = vi.hoisted(() => vi.fn())
const mockIoHookStart = vi.hoisted(() => vi.fn())
const mockIoHookStop = vi.hoisted(() => vi.fn())

const mockCreateTray = vi.hoisted(() => vi.fn())
const mockRefreshLocalizedUi = vi.hoisted(() => vi.fn())
const mockCreateBackgroundWindow = vi.hoisted(() => vi.fn())
const mockCreateSettingsWindow = vi.hoisted(() => vi.fn())
const mockGetSettingsWindow = vi.hoisted(() => vi.fn((): any => null))
const mockFocusSettingsWindow = vi.hoisted(() => vi.fn())

const mockInitProcessor = vi.hoisted(() => vi.fn())
const mockInitIPCHandlers = vi.hoisted(() => vi.fn())
const mockRegisterAllIPCHandlers = vi.hoisted(() => vi.fn())

const mockCheckForUpdates = vi.hoisted(() => vi.fn())
const mockCheckPermissions = vi.hoisted(() => vi.fn())
const mockShowNotification = vi.hoisted(() => vi.fn())

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

vi.mock('electron', () => ({
  app: {
    whenReady: mockWhenReady,
    on: mockAppOn,
    setLoginItemSettings: mockSetLoginItemSettings,
    getLoginItemSettings: mockGetLoginItemSettings,
    setName: mockSetName,
    dock: {
      setIcon: mockDockSetIcon,
    },
  },
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  Menu: {
    setApplicationMenu: mockSetApplicationMenu,
  },
  nativeImage: {
    createFromPath: mockCreateFromPath,
  },
}))

vi.mock('../env', () => ({
  initEnv: mockInitEnv,
  VITE_DEV_SERVER_URL: 'http://localhost:5173',
}))

vi.mock('../logger', () => ({
  initializeLogger: mockInitializeLogger,
}))

vi.mock('../i18n', () => ({
  initMainI18n: mockInitMainI18n,
  syncSystemLocaleIfNeeded: mockSyncSystemLocaleIfNeeded,
  broadcastLanguageSnapshot: mockBroadcastLanguageSnapshot,
  sendLanguageSnapshotToWindow: mockSendLanguageSnapshotToWindow,
  t: mockT,
}))

vi.mock('../config-manager', () => ({
  configManager: {
    getAppConfig: mockGetAppConfig,
    getASRConfig: mockGetASRConfig,
    getLLMRefineConfig: mockGetLLMRefineConfig,
  },
}))

vi.mock('../asr-provider', () => ({
  ASRProvider: mockASRProviderCtor,
}))

vi.mock('../llm-provider', () => ({
  LLMProvider: mockLLMProviderCtor,
}))

vi.mock('../hotkey', () => ({
  registerGlobalHotkeys: mockRegisterGlobalHotkeys,
}))

vi.mock('../hotkey-manager', () => ({
  hotkeyManager: { unregisterAll: mockHotkeyUnregisterAll },
}))

vi.mock('../iohook-manager', () => ({
  ioHookManager: { start: mockIoHookStart, stop: mockIoHookStop },
}))

vi.mock('../tray', () => ({
  createTray: mockCreateTray,
  refreshLocalizedUi: mockRefreshLocalizedUi,
}))

vi.mock('../window', () => ({
  createBackgroundWindow: mockCreateBackgroundWindow,
  createSettingsWindow: mockCreateSettingsWindow,
  getSettingsWindow: mockGetSettingsWindow,
  focusSettingsWindow: mockFocusSettingsWindow,
}))

vi.mock('../notification', () => ({
  showNotification: mockShowNotification,
}))

vi.mock('../ipc', () => ({
  initIPCHandlers: mockInitIPCHandlers,
  registerAllIPCHandlers: mockRegisterAllIPCHandlers,
}))

vi.mock('../audio', () => ({
  handleStartRecording: vi.fn(),
  handleStopRecording: vi.fn(),
  handleAudioData: vi.fn(),
  handleCancelSession: vi.fn(),
  getCurrentSession: vi.fn(() => null),
  setSessionError: vi.fn(),
  initProcessor: mockInitProcessor,
}))

vi.mock('../updater-manager', () => ({
  UpdaterManager: { checkForUpdates: mockCheckForUpdates },
}))

vi.mock('../text-injector', () => ({
  textInjector: {
    checkPermissions: mockCheckPermissions,
  },
}))

const importMain = async () => {
  await import('../main')
}

const runReady = async () => {
  appState.readyResolve?.()
  if (appState.readyPromise) {
    await appState.readyPromise
  }
  await flush()
}

describe('main startup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    appState.listeners.clear()
    appState.readyPromise = null
    appState.readyResolve = null
    process.env.VITE_PUBLIC = '/tmp'
    mockCheckPermissions.mockResolvedValue({
      hasPermission: true,
      message: '',
    })
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
  })

  const originalPlatform = process.platform
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
  })

  it('runs startup sequence on app ready', async () => {
    await importMain()
    await runReady()

    expect(mockInitEnv).toHaveBeenCalled()
    expect(mockInitializeLogger).toHaveBeenCalled()
    expect(mockGetAppConfig).toHaveBeenCalled()
    expect(mockInitMainI18n).toHaveBeenCalledWith('en')
    expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
    })
    expect(mockGetASRConfig).toHaveBeenCalled()
    expect(mockASRProviderCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'cn',
        apiKeys: {},
        lowVolumeMode: true,
      }),
    )
    expect(mockLLMProviderCtor).toHaveBeenCalledWith(
      {
        enabled: true,
      },
      {
        getASRConfig: expect.any(Function),
      },
    )
    expect(mockCreateBackgroundWindow).toHaveBeenCalled()
    expect(mockCreateTray).toHaveBeenCalled()
    expect(mockInitProcessor).toHaveBeenCalledWith(
      expect.objectContaining({
        getAsrProvider: expect.any(Function),
        getASRConfig: expect.any(Function),
        initializeASRProvider: expect.any(Function),
        getLlmProvider: expect.any(Function),
        initializeLLMProvider: expect.any(Function),
      }),
    )
    expect(mockInitIPCHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.any(Object),
        session: expect.any(Object),
        overlay: expect.any(Object),
      }),
    )
    expect(mockRegisterAllIPCHandlers).toHaveBeenCalled()
    expect(mockCheckForUpdates).toHaveBeenCalled()
    expect(mockRegisterGlobalHotkeys).toHaveBeenCalled()
    expect(mockIoHookStart).toHaveBeenCalled()
    expect(mockCreateSettingsWindow).toHaveBeenCalled()
  })

  it('syncs system locale on browser window focus', async () => {
    mockSyncSystemLocaleIfNeeded.mockResolvedValueOnce(true)
    await importMain()
    await runReady()

    appState.listeners.get('browser-window-focus')?.()
    await flush()

    expect(mockSyncSystemLocaleIfNeeded).toHaveBeenCalled()
    expect(mockBroadcastLanguageSnapshot).toHaveBeenCalled()
    expect(mockRefreshLocalizedUi).toHaveBeenCalled()
  })

  it('sends language snapshot to window on did-finish-load', async () => {
    await importMain()
    await runReady()

    const onHandlers: Record<string, () => void> = {}
    const window = {
      webContents: {
        on: vi.fn((event: string, handler: () => void) => {
          onHandlers[event] = handler
        }),
      },
    }

    appState.listeners.get('browser-window-created')?.(null, window)
    onHandlers['did-finish-load']?.()

    expect(mockSendLanguageSnapshotToWindow).toHaveBeenCalledWith(window)
  })

  it('cleans up on before-quit', async () => {
    await importMain()

    appState.listeners.get('before-quit')?.()

    expect(mockHotkeyUnregisterAll).toHaveBeenCalled()
    expect(mockIoHookStop).toHaveBeenCalled()
  })

  it('opens settings window on activate when missing', async () => {
    mockGetAllWindows.mockReturnValueOnce([])
    await importMain()

    appState.listeners.get('activate')?.()
    expect(mockCreateSettingsWindow).toHaveBeenCalled()
  })

  it('focuses settings window when present on activate', async () => {
    mockGetAllWindows.mockReturnValueOnce([{} as unknown as Electron.BrowserWindow])
    mockGetSettingsWindow.mockReturnValueOnce({} as unknown as Electron.BrowserWindow)
    await importMain()

    appState.listeners.get('activate')?.()
    expect(mockFocusSettingsWindow).toHaveBeenCalled()
  })

  it('shows permission notification when missing on macOS', async () => {
    mockCheckPermissions.mockResolvedValueOnce({
      hasPermission: false,
      message: 'need permission',
    })
    await importMain()
    await runReady()
    await flush()

    expect(mockShowNotification).toHaveBeenCalledWith(
      't:notification.permissionTitle',
      'need permission',
    )
  })
})
