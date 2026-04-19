/**
 * IOHook Manager
 *
 * Manages the uiohook-napi keyboard hook via an isolated utility process.
 * This avoids Electron bug #33976 where getUserMedia() breaks
 * SetWindowsHookEx(WH_KEYBOARD_LL) cross-process keyboard capture on Windows.
 *
 * The utility process (hook-worker.ts) runs uIOhook directly and sends
 * keydown/keyup events via IPC. This manager exposes the same EventEmitter
 * API as before, tracking pressed keys for the PTT isPressed() check.
 */

import { createRequire } from 'node:module'
import { utilityProcess } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'events'
import { configManager } from './config-manager'
import { parseAccelerator } from './hotkey/parser'

// Only load UiohookKey constants (no hook runtime side effects)
const { UiohookKey } = createRequire(import.meta.url)(
  'uiohook-napi',
) as typeof import('uiohook-napi')
export { UiohookKey }

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MODIFIERS = {
  SHIFT: new Set([UiohookKey.Shift, UiohookKey.ShiftRight]),
  CTRL: new Set([UiohookKey.Ctrl, UiohookKey.CtrlRight]),
  ALT: new Set([UiohookKey.Alt, UiohookKey.AltRight]),
  META: new Set([UiohookKey.Meta, UiohookKey.MetaRight]),
}

const ALL_MODIFIER_KEYS: Set<number> = new Set([
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
])

type WorkerMessage =
  | { type: 'keydown'; keycode: number }
  | { type: 'keyup'; keycode: number }
  | { type: 'started'; ok: boolean; error?: string }
  | { type: 'stopped' }

export class IOHookManager extends EventEmitter {
  private pressedKeys: Set<number> = new Set()
  private isListening = false
  private child: Electron.UtilityProcess | null = null
  private pttRelatedKeys: Set<number> | null = null

  start() {
    if (this.isListening) return

    const workerPath = path.join(__dirname, 'hook-worker.mjs')
    console.log('[IOHook] Forking utility process:', workerPath)

    this.child = utilityProcess.fork(workerPath, [], {
      serviceName: 'hook-worker',
      allowLoadingNativeModules: true,
    } as Electron.ForkOptions & { allowLoadingNativeModules?: boolean })

    this.child.on('message', (msg: WorkerMessage) => {
      this.handleWorkerMessage(msg)
    })

    this.child.on('exit', (code) => {
      console.log(`[IOHook] Utility process exited with code ${code}`)
      this.isListening = false
      this.child = null
    })

    this.child.postMessage({ type: 'start' })
  }

  stop() {
    if (!this.child) return
    this.child.postMessage({ type: 'stop' })
    this.pressedKeys.clear()
    this.isListening = false
    setTimeout(() => {
      this.child?.kill()
      this.child = null
    }, 1000)
    console.log('[IOHook] Stopped')
  }

  private handleWorkerMessage(msg: WorkerMessage) {
    switch (msg.type) {
      case 'keydown':
        this.pressedKeys.add(msg.keycode)
        this.logIfPttRelated('KeyDown', msg.keycode)
        this.emit('keydown', msg.keycode)
        break
      case 'keyup':
        this.pressedKeys.delete(msg.keycode)
        this.logIfPttRelated('KeyUp', msg.keycode)
        this.emit('keyup', msg.keycode)
        break
      case 'started':
        if (msg.ok) {
          this.isListening = true
          console.log('[IOHook] Utility process started successfully')
        } else {
          console.error('[IOHook] Utility process failed to start:', msg.error)
        }
        break
      case 'stopped':
        console.log('[IOHook] Utility process stopped')
        break
    }
  }

  private logIfPttRelated(direction: string, keycode: number): void {
    if (!this.pttRelatedKeys) {
      const config = configManager.getHotkeyConfig()
      const parsed = parseAccelerator(config.pttKey)
      if (parsed) {
        const keys = new Set<number>([parsed.key])
        const MODS = {
          SHIFT: new Set([UiohookKey.Shift, UiohookKey.ShiftRight]),
          CTRL: new Set([UiohookKey.Ctrl, UiohookKey.CtrlRight]),
          ALT: new Set([UiohookKey.Alt, UiohookKey.AltRight]),
          META: new Set([UiohookKey.Meta, UiohookKey.MetaRight]),
        }
        for (const mod of parsed.modifiers) {
          const set = MODS[mod.toUpperCase() as keyof typeof MODS]
          if (set) for (const k of set) keys.add(k)
        }
        this.pttRelatedKeys = keys
      }
    }
    if (this.pttRelatedKeys?.has(keycode)) {
      console.log(
        `[IOHook] ${direction} keycode=0x${keycode.toString(16).toUpperCase()} ` +
          `pressedKeys=[${Array.from(this.pressedKeys)
            .map((k) => `0x${k.toString(16).toUpperCase()}`)
            .join(',')}]`,
      )
    }
  }

  isPressed(modifiers: string[], key: number): boolean {
    if (!this.pressedKeys.has(key)) return false

    for (const mod of modifiers) {
      if (!this.hasModifier(mod)) return false
    }

    const requiredModifierKeys = this.getRequiredModifierKeys(modifiers)
    for (const pressedKey of this.pressedKeys) {
      if (pressedKey === key) continue
      if (ALL_MODIFIER_KEYS.has(pressedKey) && !requiredModifierKeys.has(pressedKey)) {
        return false
      }
    }

    return true
  }

  private getRequiredModifierKeys(modifiers: string[]): Set<number> {
    const keys = new Set<number>()
    for (const mod of modifiers) {
      const modSet = MODIFIERS[mod.toUpperCase() as keyof typeof MODIFIERS]
      if (modSet) {
        for (const k of modSet) {
          keys.add(k)
        }
      }
    }
    return keys
  }

  private hasModifier(mod: string): boolean {
    const modSet = MODIFIERS[mod.toUpperCase() as keyof typeof MODIFIERS]
    if (!modSet) return false
    for (const key of modSet) {
      if (this.pressedKeys.has(key)) return true
    }
    return false
  }
}

export const ioHookManager = new IOHookManager()
