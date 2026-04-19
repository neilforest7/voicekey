import { ipcMain } from 'electron'
import { IPC_CHANNELS, type AudioChunkPayload, type VoiceSession } from '../../shared/types'
import { handleStreamingAudioChunk } from '../audio/processor'

export type SessionHandlersDeps = {
  handleStartRecording: () => Promise<void>
  handleStopRecording: () => Promise<void>
  handleAudioChunk: (payload: AudioChunkPayload) => Promise<void>
  handleCancelSession: () => Promise<void>
  getCurrentSession: () => VoiceSession | null
  isStreamingMode: () => boolean
}

let deps: SessionHandlersDeps

export function initSessionHandlers(dependencies: SessionHandlersDeps): void {
  deps = dependencies
}

export function registerSessionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_START, async () => {
    await deps.handleStartRecording()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async () => {
    await deps.handleStopRecording()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_STATUS, () => {
    return deps.getCurrentSession()?.status || 'idle'
  })

  ipcMain.on(IPC_CHANNELS.AUDIO_DATA, (_event, payload: AudioChunkPayload) => {
    const session = deps.getCurrentSession()
    const isStreaming = session?.id === payload.sessionId && deps.isStreamingMode()

    if (isStreaming) {
      const buffer = Buffer.from(payload.buffer)
      console.log(`[IPC:Session] Routing to streaming handler: ${payload.sessionId}`)
      void handleStreamingAudioChunk(
        payload.sessionId,
        buffer,
        payload.isFinal,
        payload.mimeType,
      ).catch((error) => {
        console.error('[IPC:Session] Streaming audio chunk failed:', error)
      })
    } else {
      void deps.handleAudioChunk(payload).catch((error) => {
        console.error('[IPC:Session] Audio chunk processing failed:', error)
      })
    }
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_SESSION, () => deps.handleCancelSession())
}
