/**
 * Keyboard hook utility process
 *
 * Runs uiohook-napi in an isolated process to avoid the Electron getUserMedia()
 * bug (#33976) that breaks SetWindowsHookEx(WH_KEYBOARD_LL) cross-process
 * keyboard capture on Windows.
 *
 * Communicates with the main process via process.parentPort IPC.
 */

import { createRequire } from 'node:module'

const { uIOhook } = createRequire(import.meta.url)('uiohook-napi') as typeof import('uiohook-napi')
import type { UiohookKeyboardEvent } from 'uiohook-napi'

const parentPort = process.parentPort!

uIOhook.on('keydown', (e: UiohookKeyboardEvent) => {
  parentPort.postMessage({ type: 'keydown', keycode: e.keycode })
})

uIOhook.on('keyup', (e: UiohookKeyboardEvent) => {
  parentPort.postMessage({ type: 'keyup', keycode: e.keycode })
})

parentPort.on('message', (event: any) => {
  const msg = event.data
  if (msg.type === 'start') {
    try {
      uIOhook.start()
      parentPort.postMessage({ type: 'started', ok: true })
      console.log('[HookWorker] uIOhook started')
    } catch (err) {
      parentPort.postMessage({
        type: 'started',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      console.error('[HookWorker] uIOhook failed to start:', err)
    }
  } else if (msg.type === 'stop') {
    uIOhook.stop()
    parentPort.postMessage({ type: 'stopped' })
    console.log('[HookWorker] uIOhook stopped')
  }
})
