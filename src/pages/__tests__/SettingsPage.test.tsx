import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SettingsPage from '../SettingsPage'

vi.mock('@/components/HotkeySettings', () => ({
  HotkeySettings: ({ value, onChange, isLoading }: any) => (
    <div>
      <input
        aria-label="ptt"
        disabled={isLoading}
        value={value.pttKey}
        onChange={(e) => onChange({ ...value, pttKey: e.target.value })}
      />
      <input
        aria-label="toggle"
        disabled={isLoading}
        value={value.toggleSettings}
        onChange={(e) => onChange({ ...value, toggleSettings: e.target.value })}
      />
    </div>
  ),
}))

vi.mock('@/components/LogViewerDialog', () => ({
  LogViewerDialog: () => null,
}))

const mockGetConfig = vi.fn()
const mockSetConfig = vi.fn()
const mockTestConnection = vi.fn()
const mockGetUpdateStatus = vi.fn()
const mockCheckForUpdates = vi.fn()
const mockOpenExternal = vi.fn()

const assignElectronAPI = () => {
  window.electronAPI = {
    platform: 'darwin',
    getConfig: mockGetConfig,
    setConfig: mockSetConfig,
    testConnection: mockTestConnection,
    getUpdateStatus: mockGetUpdateStatus,
    checkForUpdates: mockCheckForUpdates,
    openExternal: mockOpenExternal,
  } as unknown as Window['electronAPI']
}

const baseConfig = {
  app: { language: 'system', autoLaunch: false },
  asr: {
    provider: 'glm',
    region: 'cn' as const,
    apiKeys: { cn: 'k-cn', intl: '' },
    lowVolumeMode: true,
    endpoint: '',
    language: 'auto',
  },
  llmRefine: {
    enabled: true,
  },
  hotkey: { pttKey: 'Command+K', toggleSettings: 'Command+,' },
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(globalThis as any).__APP_VERSION__ = '0.1.0'
    assignElectronAPI()
    mockGetConfig.mockResolvedValue(baseConfig)
    mockGetUpdateStatus.mockResolvedValue(null)
  })

  it('loads config and renders fields', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled())
    expect(screen.getByLabelText('ptt')).toHaveValue('Command+K')
    expect(screen.getByLabelText('toggle')).toHaveValue('Command+,')
    expect(screen.getByText('settings.saveConfig')).toBeDisabled()
  })

  it('saves config when hotkeys valid and dirty', async () => {
    mockSetConfig.mockResolvedValue(undefined)
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('ptt'), { target: { value: 'Command+J' } })

    const saveButton = screen.getByText('settings.saveConfig')
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(mockSetConfig).toHaveBeenCalled())
    expect(mockSetConfig.mock.calls[0][0]).toMatchObject({
      app: baseConfig.app,
      asr: baseConfig.asr,
      llmRefine: baseConfig.llmRefine,
      hotkey: { pttKey: 'Command+J', toggleSettings: 'Command+,' },
    })
    expect(screen.getByText('settings.result.saveSuccess')).toBeInTheDocument()
  })

  it('saves low volume mode switch change', async () => {
    mockSetConfig.mockResolvedValue(undefined)
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('switch', { name: 'settings.lowVolumeMode' }))

    const saveButton = screen.getByText('settings.saveConfig')
    await waitFor(() => expect(saveButton).toBeEnabled())
    fireEvent.click(saveButton)

    await waitFor(() => expect(mockSetConfig).toHaveBeenCalled())
    expect(mockSetConfig.mock.calls[0][0]).toMatchObject({
      asr: {
        ...baseConfig.asr,
        lowVolumeMode: false,
      },
    })
  })

  it('shows error when hotkeys invalid', async () => {
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('toggle'), { target: { value: 'Command+K' } })
    fireEvent.click(screen.getByText('settings.saveConfig'))

    expect(mockSetConfig).not.toHaveBeenCalled()
    expect(screen.getByText('settings.result.hotkeyInvalid')).toBeInTheDocument()
  })

  it('requires api key before testing connection', async () => {
    mockGetConfig.mockResolvedValue({
      ...baseConfig,
      asr: { ...baseConfig.asr, apiKeys: { cn: '', intl: '' } },
    })
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled())

    expect(screen.getByText('settings.testConnection')).toBeDisabled()
  })

  it('tests connection success and failure', async () => {
    mockTestConnection.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled())

    fireEvent.click(screen.getByText('settings.testConnection'))
    await waitFor(() =>
      expect(screen.getByText('settings.result.connectionSuccess')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByText('settings.testConnection'))
    await waitFor(() =>
      expect(screen.getByText('settings.result.connectionFailed')).toBeInTheDocument(),
    )
  })

  it('checks update and shows no-update state', async () => {
    mockCheckForUpdates.mockResolvedValue({ hasUpdate: false, latestVersion: '', releaseUrl: '' })
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled())

    fireEvent.click(screen.getByText('settings.checkUpdate'))
    await waitFor(() => expect(mockCheckForUpdates).toHaveBeenCalled())
    expect(screen.getByText('settings.noUpdate')).toBeInTheDocument()
  })

  it('opens release page when update available', async () => {
    mockGetUpdateStatus.mockResolvedValue({
      hasUpdate: true,
      latestVersion: '1.2.0',
      releaseUrl: 'https://example.com',
      releaseNotes: '',
    })
    render(<SettingsPage />)
    await waitFor(() => expect(mockGetUpdateStatus).toHaveBeenCalled())

    fireEvent.click(screen.getByText('settings.downloadUpdate'))
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
  })
})
