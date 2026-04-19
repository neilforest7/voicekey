import { IPC_CHANNELS, type RecordingStartPayload, type VoiceSession } from '../../shared/types'
import { showOverlay, hideOverlay, updateOverlay, showErrorAndHide } from '../window/overlay'
import { getBackgroundWindow } from '../window/background'
import { t } from '../i18n'
import {
  startStreamingSession,
  finalizeStreamingSession,
  cancelStreamingSession,
} from './processor'

let currentSession: VoiceSession | null = null

const SPEECH_DETECTION_LEVEL_THRESHOLD = 0.08

type HandleStopRecordingOptions = {
  willRunRefine?: boolean
  asrConfig?: { streamingMode?: boolean; provider?: string; lowVolumeMode?: boolean }
}

export function getCurrentSession(): VoiceSession | null {
  return currentSession
}

export function setSessionError(): void {
  if (currentSession) {
    currentSession.status = 'error'
  }
}

export function clearSession(): void {
  currentSession = null
}

export function recordSessionAudioLevel(level: number): void {
  if (!currentSession || currentSession.status !== 'recording') {
    return
  }

  const normalizedLevel = Number.isFinite(level) ? Math.max(0, Math.min(level, 1)) : 0
  currentSession.maxAudioLevel = Math.max(currentSession.maxAudioLevel ?? 0, normalizedLevel)

  if (normalizedLevel >= SPEECH_DETECTION_LEVEL_THRESHOLD) {
    currentSession.speechDetected = true
  }
}

export function updateSession(updates: Partial<VoiceSession>): void {
  if (currentSession) {
    Object.assign(currentSession, updates)
  }
}

export async function handleStartRecording(asrConfig?: {
  streamingMode?: boolean
  provider?: string
  lowVolumeMode?: boolean
}): Promise<void> {
  const startTimestamp = Date.now()
  console.log('[Audio:Session] handleStartRecording triggered')

  if (currentSession && currentSession.status === 'recording') {
    console.log('[Audio:Session] Already recording, ignoring')
    return
  }

  try {
    showOverlay({ status: 'recording' })

    currentSession = {
      id: `session-${Date.now()}`,
      startTime: new Date(),
      status: 'recording',
      maxAudioLevel: 0,
      speechDetected: false,
    }

    const bgWindow = getBackgroundWindow()
    if (!bgWindow) {
      console.error('[Audio:Session] backgroundWindow is not available')
      showErrorAndHide(t('errors.internal'))
      currentSession = null
      return
    }

    const isStreamingMode = Boolean(asrConfig?.streamingMode && asrConfig.provider === 'volcengine')

    const payload: RecordingStartPayload = {
      sessionId: currentSession.id,
      streamingMode: isStreamingMode,
      lowVolumeMode: asrConfig?.lowVolumeMode ?? true,
    }
    bgWindow.webContents.send(IPC_CHANNELS.SESSION_START, payload)

    console.log('[Audio:Session] handleStartRecording streaming check:', {
      streamingMode: asrConfig?.streamingMode,
      provider: asrConfig?.provider,
      isStreamingMode,
    })

    if (isStreamingMode) {
      console.log('[Audio:Session] Starting streaming mode')
      await startStreamingSession(currentSession.id)
    }

    const duration = Date.now() - startTimestamp
    console.log(`[Audio:Session] Recording start completed in ${duration}ms`)
  } catch (error) {
    console.error('[Audio:Session] Failed to start recording:', error)
    showErrorAndHide(t('errors.startFailed'))
    currentSession = null
  }
}

export async function handleStopRecording(options: HandleStopRecordingOptions = {}): Promise<void> {
  if (!currentSession || currentSession.status !== 'recording') {
    console.log(
      '[Audio:Session] handleStopRecording: no active recording session, status:',
      currentSession?.status,
    )
    return
  }

  try {
    const recordingDuration = Date.now() - currentSession.startTime.getTime()
    console.log(`[Audio:Session] Recording duration: ${recordingDuration}ms`)

    currentSession.duration = recordingDuration
    currentSession.status = 'processing'

    console.log('[Audio:Session] Checking streaming mode:', {
      hasConfig: !!options.asrConfig,
      streamingMode: options.asrConfig?.streamingMode,
      provider: options.asrConfig?.provider,
    })

    const isStreamingMode = Boolean(
      options.asrConfig?.streamingMode && options.asrConfig.provider === 'volcengine',
    )

    console.log('[Audio:Session] isStreamingMode:', isStreamingMode)

    if (isStreamingMode) {
      console.log('[Audio:Session] Finalizing streaming mode')
      updateOverlay({
        status: 'processing',
        processingStage: options.willRunRefine ? 'refining' : 'transcribing',
        processingTotalStages: options.willRunRefine ? 2 : 1,
      })

      const bgWindow = getBackgroundWindow()
      if (bgWindow) {
        console.log('[Audio:Session] Sending SESSION_STOP to backgroundWindow for streaming mode')
        bgWindow.webContents.send(IPC_CHANNELS.SESSION_STOP)
      }

      await finalizeStreamingSession(currentSession.id)
      return
    }

    updateOverlay({
      status: 'processing',
      processingStage: 'transcribing',
      processingTotalStages: options.willRunRefine ? 2 : 1,
    })

    const bgWindow = getBackgroundWindow()
    if (bgWindow) {
      console.log('[Audio:Session] Sending SESSION_STOP to backgroundWindow')
      bgWindow.webContents.send(IPC_CHANNELS.SESSION_STOP)
    } else {
      console.error('[Audio:Session] Cannot send SESSION_STOP: backgroundWindow not available')
      showErrorAndHide(t('errors.stopFailed'))
    }
  } catch (error) {
    console.error('[Audio:Session] Failed to stop recording:', error)
    showErrorAndHide(t('errors.stopFailed'))
  }
}

export async function handleCancelSession(): Promise<void> {
  console.log('[Audio:Session] handleCancelSession triggered')

  hideOverlay()

  if (currentSession) {
    console.log('[Audio:Session] Cancelling session:', currentSession.id)
    cancelStreamingSession(currentSession.id)
    currentSession = null
  }

  const bgWindow = getBackgroundWindow()
  if (bgWindow) {
    bgWindow.webContents.send(IPC_CHANNELS.SESSION_STOP)
  }
}
