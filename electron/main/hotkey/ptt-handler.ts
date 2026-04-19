import { configManager } from '../config-manager'
import { hotkeyManager } from '../hotkey-manager'
import { ioHookManager } from '../iohook-manager'
import { createSettingsWindow } from '../window'
import {
  handleStartRecording,
  handleStopRecording,
  getCurrentSession,
} from '../audio/session-manager'
import { parseAccelerator } from './parser'

type RegisterGlobalHotkeysOptions = {
  getWillRunRefine?: () => boolean
}

let activeDebounceTimer: NodeJS.Timeout | null = null
let lastPttState = false

export function registerGlobalHotkeys(options: RegisterGlobalHotkeysOptions = {}): void {
  clearPendingDebounce()

  const hotkeyConfig = configManager.getHotkeyConfig()
  const pttKey = hotkeyConfig.pttKey

  const pttConfig = parseAccelerator(pttKey)
  console.log('[PTT] Registering hotkey:', pttKey, pttConfig)

  if (pttConfig) {
    const DEBOUNCE_MS = 50

    const checkPTT = () => {
      const isPressed = ioHookManager.isPressed(pttConfig.modifiers, pttConfig.key)
      const session = getCurrentSession()

      if (isPressed !== lastPttState) {
        console.log(
          `[PTT] State changed: pressed=${isPressed}, session=${session?.status ?? 'none'}`,
        )
        lastPttState = isPressed
      }

      if (isPressed && (!session || session.status !== 'recording') && !activeDebounceTimer) {
        activeDebounceTimer = setTimeout(() => {
          if (ioHookManager.isPressed(pttConfig.modifiers, pttConfig.key)) {
            const asrConfig = configManager.getASRConfig()
            console.log('[PTT] Starting recording with config:', {
              streamingMode: asrConfig.streamingMode,
              provider: asrConfig.provider,
            })
            handleStartRecording(asrConfig)
          }
          activeDebounceTimer = null
        }, DEBOUNCE_MS)
      }

      if (!isPressed && activeDebounceTimer) {
        clearTimeout(activeDebounceTimer)
        activeDebounceTimer = null
      }

      if (!isPressed && session && session.status === 'recording') {
        const asrConfig = configManager.getASRConfig()
        console.log('[PTT] Stopping recording with config:', {
          streamingMode: asrConfig.streamingMode,
          provider: asrConfig.provider,
        })
        handleStopRecording({
          willRunRefine: options.getWillRunRefine?.() ?? false,
          asrConfig,
        })
      }
    }

    ioHookManager.on('keydown', checkPTT)
    ioHookManager.on('keyup', checkPTT)
  } else {
    console.warn('[PTT] Failed to parse PTT key:', pttKey)
  }

  hotkeyManager.register(hotkeyConfig.toggleSettings, () => {
    createSettingsWindow()
  })
}

export function clearPendingDebounce(): void {
  if (activeDebounceTimer) {
    clearTimeout(activeDebounceTimer)
    activeDebounceTimer = null
  }
  lastPttState = false
}
