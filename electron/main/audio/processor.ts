import { app } from 'electron'
import fs from 'fs'
import path from 'node:path'
import { LOW_VOLUME_GAIN_DB } from '../../shared/constants'
import { IPC_CHANNELS, type ASRConfig, type AudioChunkPayload } from '../../shared/types'
import { t } from '../i18n'
import { historyManager } from '../history-manager'
import type { ASRProvider } from '../asr-provider'
import type { TextRefiner } from '../refine'
import { textInjector } from '../text-injector'
import { getBackgroundWindow } from '../window/background'
import { hideOverlay, updateOverlay } from '../window/overlay'
import { convertToMP3, convertToPCM } from './converter'
import { clearSession, getCurrentSession, updateSession } from './session-manager'
import type {
  VolcengineASRProvider,
  StreamingTranscriptCallback,
} from '../asr-providers/volcengine-provider'

type ProcessorDeps = {
  getAsrProvider: () => ASRProvider | null
  getASRConfig: () => ASRConfig
  initializeASRProvider: () => void
  getRefineService?: () => TextRefiner | null
}

type ChunkSessionState = {
  sessionId: string
  resultsByIndex: Map<number, string>
  pendingCount: number
  finalChunkSeen: boolean
  finalChunkIndex: number | null
  tempFiles: Set<string>
  failed: boolean
  finalized: boolean
  asrProvider: ASRProvider | null
}

type StreamingSessionState = {
  sessionId: string
  latestText: string
  finalized: boolean
  failed: boolean
  asrProvider: VolcengineASRProvider | null
  resolveFinalized?: (text: string) => void
}

const PROMPT_TAIL_MAX_LENGTH = 800

let deps: ProcessorDeps
const chunkSessions = new Map<string, ChunkSessionState>()
const streamingSessions = new Map<string, StreamingSessionState>()

export function initProcessor(dependencies: ProcessorDeps): void {
  deps = dependencies
  console.log('[Audio:Processor] Initialized')
}

export async function handleAudioChunk(payload: AudioChunkPayload): Promise<void> {
  const sessionState = getOrCreateChunkSession(payload.sessionId)

  if (sessionState.failed || sessionState.finalized) {
    console.log(
      `[Audio:Processor] Ignoring chunk ${payload.chunkIndex} for completed/failed session ${payload.sessionId}`,
    )
    return
  }

  sessionState.pendingCount += 1
  if (payload.isFinal) {
    sessionState.finalChunkSeen = true
    sessionState.finalChunkIndex = payload.chunkIndex
  }

  try {
    await processChunk(payload, sessionState)
  } catch (error) {
    failSession(payload.sessionId, sessionState, error)
  } finally {
    sessionState.pendingCount = Math.max(0, sessionState.pendingCount - 1)

    if (!sessionState.failed) {
      try {
        await finalizeSessionIfReady(sessionState)
      } catch (error) {
        failSession(payload.sessionId, sessionState, error)
      }
    }

    releaseChunkSessionIfPossible(sessionState)
  }
}

function getOrCreateChunkSession(sessionId: string): ChunkSessionState {
  const existing = chunkSessions.get(sessionId)
  if (existing) return existing

  const sessionState: ChunkSessionState = {
    sessionId,
    resultsByIndex: new Map(),
    pendingCount: 0,
    finalChunkSeen: false,
    finalChunkIndex: null,
    tempFiles: new Set(),
    failed: false,
    finalized: false,
    asrProvider: null,
  }
  chunkSessions.set(sessionId, sessionState)
  return sessionState
}

async function processChunk(
  payload: AudioChunkPayload,
  sessionState: ChunkSessionState,
): Promise<void> {
  if (!isSessionUsable(payload.sessionId)) {
    console.log(
      `[Audio:Processor] Session ${payload.sessionId} is inactive, skipping chunk ${payload.chunkIndex}`,
    )
    return
  }

  const timestamp = Date.now()
  const inputExtension = resolveAudioExtension(payload.mimeType)
  const tempInputPath = path.join(
    app.getPath('temp'),
    `voice-key-${payload.sessionId}-${payload.chunkIndex}-${timestamp}.${inputExtension}`,
  )
  const tempMp3Path = path.join(
    app.getPath('temp'),
    `voice-key-${payload.sessionId}-${payload.chunkIndex}-${timestamp}.mp3`,
  )
  sessionState.tempFiles.add(tempInputPath)
  sessionState.tempFiles.add(tempMp3Path)

  const inputBuffer = Buffer.from(payload.buffer)
  console.log(
    `[Audio:Processor] Received chunk ${payload.chunkIndex} for ${payload.sessionId}: ${inputBuffer.length} bytes`,
  )

  try {
    fs.writeFileSync(tempInputPath, inputBuffer)

    const asrConfig = deps.getASRConfig()
    const lowVolumeModeEnabled = asrConfig.lowVolumeMode ?? true
    await convertToMP3(tempInputPath, tempMp3Path, {
      gainDb: lowVolumeModeEnabled ? LOW_VOLUME_GAIN_DB : undefined,
    })

    if (sessionState.failed || !isSessionUsable(payload.sessionId)) {
      return
    }

    const asrProvider = getOrCreateSessionAsrProvider(sessionState)
    const prompt = buildPromptForChunk(sessionState, payload.chunkIndex)
    const requestId = `${payload.sessionId}-chunk-${payload.chunkIndex}`

    const transcription = await asrProvider.transcribe(tempMp3Path, {
      prompt,
      requestId,
      sourceAudioFilePath: tempInputPath,
      sourceMimeType: payload.mimeType,
    })

    if (sessionState.failed || !isSessionUsable(payload.sessionId)) {
      return
    }

    sessionState.resultsByIndex.set(payload.chunkIndex, transcription.text)
    console.log(
      `[Audio:Processor] Chunk ${payload.chunkIndex} transcription received (length: ${transcription.text.length})`,
    )
  } finally {
    cleanupTempFiles(sessionState, tempInputPath, tempMp3Path)
  }
}

function getInitializedAsrProvider(): ASRProvider {
  let asrProvider = deps.getAsrProvider()
  if (asrProvider) return asrProvider

  console.log('[Audio:Processor] Initializing ASR provider...')
  deps.initializeASRProvider()
  asrProvider = deps.getAsrProvider()
  if (!asrProvider) {
    throw new Error('ASR Provider initialization failed')
  }

  return asrProvider
}

function getOrCreateSessionAsrProvider(sessionState: ChunkSessionState): ASRProvider {
  if (sessionState.asrProvider) {
    return sessionState.asrProvider
  }

  const asrProvider = getInitializedAsrProvider()
  sessionState.asrProvider = asrProvider
  return asrProvider
}

async function finalizeSessionIfReady(sessionState: ChunkSessionState): Promise<void> {
  if (sessionState.finalized || sessionState.failed) return
  if (!sessionState.finalChunkSeen || sessionState.finalChunkIndex === null) return
  if (sessionState.pendingCount > 0) return

  for (let index = 0; index <= sessionState.finalChunkIndex; index += 1) {
    if (!sessionState.resultsByIndex.has(index)) {
      return
    }
  }

  const currentSession = getCurrentSession()
  if (
    !currentSession ||
    currentSession.id !== sessionState.sessionId ||
    currentSession.status === 'error'
  ) {
    console.log(
      `[Audio:Processor] Session ${sessionState.sessionId} is no longer active during finalize, skipping`,
    )
    return
  }

  sessionState.finalized = true

  const orderedTexts: string[] = []
  for (let index = 0; index <= sessionState.finalChunkIndex; index += 1) {
    orderedTexts.push(sessionState.resultsByIndex.get(index) ?? '')
  }

  const rawText = mergeTranscriptSegments(orderedTexts)

  if (shouldSkipSessionOutput(currentSession, rawText)) {
    console.log('[Audio:Processor] No speech detected, skipping history and text injection')
    updateSession({
      transcription: '',
      status: 'completed',
    })
    hideOverlay()
    clearSession()
    return
  }

  let finalText = rawText

  const refineService = deps.getRefineService?.() ?? null
  if (refineService?.isEnabled()) {
    if (refineService.hasValidConfig()) {
      if (!isSessionUsable(sessionState.sessionId)) return

      try {
        updateOverlay({
          status: 'processing',
          processingStage: 'refining',
          processingTotalStages: 2,
        })
        console.log('[Audio:Processor] Refining aggregated transcription...')
        const refined = await refineService.refineText(rawText)
        if (refined.trim().length > 0) {
          finalText = refined
        } else {
          console.warn(
            '[Audio:Processor] Text refinement returned empty text, using raw transcription',
          )
        }
      } catch (error) {
        console.error('[Audio:Processor] Text refinement failed, using raw transcription:', error)
      }
    } else {
      console.warn('[Audio:Processor] Text refinement enabled but config is incomplete, skipped')
    }
  }

  if (!isSessionUsable(sessionState.sessionId)) {
    return
  }

  if (shouldSkipSessionOutput(getCurrentSession(), finalText)) {
    console.log('[Audio:Processor] Final text is empty after processing, skipping output')
    updateSession({
      transcription: '',
      status: 'completed',
    })
    hideOverlay()
    clearSession()
    return
  }

  const lineBreakCount = countLineBreaks(finalText)
  console.log('[Audio:Processor] Final text formatting:', {
    length: finalText.length,
    hasLineBreaks: lineBreakCount > 0,
    lineBreakCount,
  })

  updateSession({
    transcription: finalText,
    status: 'completed',
  })

  historyManager.add({
    text: finalText,
    duration: getCurrentSession()?.duration,
  })

  if (!isSessionUsable(sessionState.sessionId)) {
    return
  }

  console.log('[Audio:Processor] Injecting final text...')
  await textInjector.injectText(finalText)

  updateOverlay({ status: 'success' })
  setTimeout(() => hideOverlay(), 800)
  clearSession()
}

function failSession(sessionId: string, sessionState: ChunkSessionState, error: unknown): void {
  if (sessionState.failed) return
  sessionState.failed = true

  const message = error instanceof Error ? error.message : t('errors.generic')
  console.error(`[Audio:Processor] Session ${sessionId} failed:`, error)

  cleanupAllSessionTempFiles(sessionState)

  const currentSession = getCurrentSession()
  if (!currentSession || currentSession.id !== sessionId) {
    return
  }

  const wasRecording = currentSession.status === 'recording'
  updateSession({ status: 'error', error: message })

  if (wasRecording) {
    const bgWindow = getBackgroundWindow()
    if (bgWindow) {
      bgWindow.webContents.send(IPC_CHANNELS.SESSION_STOP)
    }
  }

  updateOverlay({
    status: 'error',
    message,
  })
  setTimeout(() => hideOverlay(), 2000)
}

function releaseChunkSessionIfPossible(sessionState: ChunkSessionState): void {
  if (sessionState.pendingCount > 0) return

  const currentSession = getCurrentSession()
  const isCurrentSession = currentSession?.id === sessionState.sessionId
  const shouldRelease = sessionState.finalized || sessionState.failed || !isCurrentSession

  if (!shouldRelease) return

  cleanupAllSessionTempFiles(sessionState)
  chunkSessions.delete(sessionState.sessionId)
}

function cleanupAllSessionTempFiles(sessionState: ChunkSessionState): void {
  if (sessionState.tempFiles.size === 0) return
  cleanupTempFiles(sessionState, ...sessionState.tempFiles)
}

function cleanupTempFiles(sessionState: ChunkSessionState, ...paths: string[]): void {
  for (const filePath of paths) {
    try {
      sessionState.tempFiles.delete(filePath)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`[Audio:Processor] Cleaned up: ${path.basename(filePath)}`)
      }
    } catch (error) {
      console.error(`[Audio:Processor] Cleanup failed for ${filePath}:`, error)
    }
  }
}

function buildPromptForChunk(
  sessionState: ChunkSessionState,
  chunkIndex: number,
): string | undefined {
  if (chunkIndex <= 0) return undefined

  const readyTexts: string[] = []
  for (let index = 0; index < chunkIndex; index += 1) {
    const text = sessionState.resultsByIndex.get(index)
    if (!text) {
      return undefined
    }
    readyTexts.push(text)
  }

  const prompt = mergeTranscriptSegments(readyTexts).slice(-PROMPT_TAIL_MAX_LENGTH)
  return prompt.length > 0 ? prompt : undefined
}

function mergeTranscriptSegments(segments: string[]): string {
  let merged = ''

  for (const segment of segments) {
    const normalizedSegment = segment.trim()
    if (!normalizedSegment) continue

    if (!merged) {
      merged = normalizedSegment
      continue
    }

    const left = merged.replace(/\s+$/u, '')
    const right = normalizedSegment.replace(/^\s+/u, '')
    const leftLastChar = left.length > 0 ? left[left.length - 1] : undefined
    const needsSpace = isAsciiWordBoundary(leftLastChar, right[0])
    merged = needsSpace ? `${left} ${right}` : `${left}${right}`
  }

  return merged
}

function countLineBreaks(text: string): number {
  return text.match(/\r\n|\r|\n/gu)?.length ?? 0
}

function isAsciiWordBoundary(left?: string, right?: string): boolean {
  return isAsciiWordChar(left) && isAsciiWordChar(right)
}

function isAsciiWordChar(value?: string): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_]$/.test(value)
}

function resolveAudioExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('webm')) return 'webm'
  return 'webm'
}

function isSessionUsable(sessionId: string): boolean {
  const currentSession = getCurrentSession()
  return Boolean(
    currentSession && currentSession.id === sessionId && currentSession.status !== 'error',
  )
}

function shouldSkipSessionOutput(
  session: ReturnType<typeof getCurrentSession>,
  text: string,
): boolean {
  if (!text.trim()) {
    return true
  }

  return Boolean(session && session.speechDetected === false)
}

export async function startStreamingSession(sessionId: string): Promise<void> {
  const currentSession = getCurrentSession()
  if (!currentSession || currentSession.id !== sessionId) {
    console.log('[Audio:Processor] Streaming session mismatch, ignoring')
    return
  }

  const asrConfig = deps.getASRConfig()
  if (!asrConfig.streamingMode) {
    console.log('[Audio:Processor] Streaming mode disabled, ignoring')
    return
  }

  if (asrConfig.provider !== 'volcengine') {
    console.log('[Audio:Processor] Streaming mode only supports Volcengine, ignoring')
    return
  }

  const asrProvider = deps.getAsrProvider()
  if (!asrProvider || asrProvider.constructor.name !== 'VolcengineASRProvider') {
    console.error('[Audio:Processor] Volcengine ASR provider not available for streaming')
    return
  }

  const volcProvider = asrProvider as VolcengineASRProvider

  const sessionState: StreamingSessionState = {
    sessionId,
    latestText: '',
    finalized: false,
    failed: false,
    asrProvider: volcProvider,
  }
  streamingSessions.set(sessionId, sessionState)

  const onTranscript: StreamingTranscriptCallback = (text, isFinal) => {
    console.log(
      `[Audio:Processor] Streaming transcript received: isFinal=${isFinal}, text="${text}"`,
    )
    if (sessionState.failed || sessionState.finalized) return

    sessionState.latestText = text

    if (isFinal) {
      sessionState.finalized = true
      console.log('[Audio:Processor] Streaming session finalized, resolving promise')
      sessionState.resolveFinalized?.(text)
    }
  }

  try {
    await volcProvider.startStreamingTranscription(onTranscript)
    console.log('[Audio:Processor] Streaming transcription started')
  } catch (error) {
    console.error('[Audio:Processor] Failed to start streaming:', error)
    sessionState.failed = true
    streamingSessions.delete(sessionId)
  }
}

export async function handleStreamingAudioChunk(
  sessionId: string,
  buffer: Buffer,
  isFinal = false,
  mimeType = 'audio/webm',
): Promise<void> {
  const sessionState = streamingSessions.get(sessionId)
  if (!sessionState || sessionState.failed || sessionState.finalized) {
    return
  }

  if (!sessionState.asrProvider) {
    console.error('[Audio:Processor] No ASR provider for streaming session')
    return
  }

  console.log('[Audio:Processor] Received streaming audio chunk:', buffer.length, 'bytes', {
    isFinal,
    mimeType,
  })

  if (mimeType === 'audio/pcm') {
    sessionState.asrProvider.sendStreamingAudioChunk(buffer, isFinal)
    return
  }

  if (isFinal && buffer.length === 0) {
    sessionState.asrProvider.sendStreamingAudioChunk(Buffer.alloc(0), true)
    return
  }

  try {
    const timestamp = Date.now()
    const inputExtension = resolveAudioExtension(mimeType)
    const tempInputPath = path.join(
      app.getPath('temp'),
      `voice-key-streaming-${sessionId}-${timestamp}.${inputExtension}`,
    )
    const tempPcmPath = path.join(
      app.getPath('temp'),
      `voice-key-streaming-${sessionId}-${timestamp}.pcm`,
    )

    fs.writeFileSync(tempInputPath, buffer)

    const asrConfig = deps.getASRConfig()
    const lowVolumeModeEnabled = asrConfig.lowVolumeMode ?? true

    console.log('[Audio:Processor] Converting audio chunk to PCM...')
    await convertToPCM(tempInputPath, tempPcmPath, {
      gainDb: lowVolumeModeEnabled ? LOW_VOLUME_GAIN_DB : undefined,
    })

    const pcmBuffer = fs.readFileSync(tempPcmPath)
    console.log('[Audio:Processor] Sending PCM chunk:', pcmBuffer.length, 'bytes')
    sessionState.asrProvider.sendStreamingAudioChunk(pcmBuffer, isFinal)

    try {
      if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath)
      if (fs.existsSync(tempPcmPath)) fs.unlinkSync(tempPcmPath)
    } catch (cleanupError) {
      console.error('[Audio:Processor] Cleanup failed:', cleanupError)
    }
  } catch (error) {
    console.error('[Audio:Processor] Failed to convert streaming audio chunk:', error)
  }
}

export async function finalizeStreamingSession(sessionId: string): Promise<string> {
  const sessionState = streamingSessions.get(sessionId)
  if (!sessionState) {
    console.log('[Audio:Processor] No streaming session found')
    return ''
  }

  console.log(
    '[Audio:Processor] Finalizing streaming session, latest text:',
    sessionState.latestText,
  )

  // Create a promise that resolves when the streaming session is finalized
  const finalizedPromise = new Promise<string>((resolve) => {
    sessionState.resolveFinalized = resolve
  })

  // Wait for the final response with a timeout after renderer sends the final chunk
  // Wait for the final response with a timeout
  const FINALIZE_TIMEOUT_MS = 5000
  let rawText = sessionState.latestText

  try {
    rawText = await Promise.race([
      finalizedPromise,
      new Promise<string>((resolve) =>
        setTimeout(() => {
          console.warn(
            '[Audio:Processor] Streaming finalize timeout, using latest text:',
            sessionState.latestText,
          )
          resolve(sessionState.latestText)
        }, FINALIZE_TIMEOUT_MS),
      ),
    ])
    console.log('[Audio:Processor] Streaming session finalized with text:', rawText)
  } catch (error) {
    console.error('[Audio:Processor] Error waiting for streaming finalize:', error)
  }

  const currentSession = getCurrentSession()
  if (!currentSession || currentSession.id !== sessionId) {
    console.log('[Audio:Processor] Session mismatch during finalize')
    streamingSessions.delete(sessionId)
    return rawText
  }

  if (shouldSkipSessionOutput(currentSession, rawText)) {
    console.log('[Audio:Processor] No speech detected in streaming session, skipping output')
    updateSession({
      transcription: '',
      status: 'completed',
    })
    hideOverlay()
    clearSession()
    streamingSessions.delete(sessionId)
    return ''
  }

  let finalText = rawText

  const refineService = deps.getRefineService?.() ?? null
  if (refineService?.isEnabled() && refineService.hasValidConfig()) {
    try {
      updateOverlay({
        status: 'processing',
        processingStage: 'refining',
        processingTotalStages: 2,
      })
      console.log('[Audio:Processor] Refining streaming transcription...')
      const refined = await refineService.refineText(rawText)
      if (refined.trim().length > 0) {
        finalText = refined
      } else {
        console.warn(
          '[Audio:Processor] Text refinement returned empty text, using raw transcription',
        )
      }
    } catch (error) {
      console.error('[Audio:Processor] Text refinement failed, using raw transcription:', error)
    }
  }

  if (shouldSkipSessionOutput(getCurrentSession(), finalText)) {
    console.log('[Audio:Processor] Final text is empty after processing, skipping output')
    updateSession({
      transcription: '',
      status: 'completed',
    })
    hideOverlay()
    clearSession()
    streamingSessions.delete(sessionId)
    return ''
  }

  updateSession({
    transcription: finalText,
    status: 'completed',
  })

  historyManager.add({
    text: finalText,
    duration: getCurrentSession()?.duration,
  })

  console.log('[Audio:Processor] Injecting streaming text...')
  await textInjector.injectText(finalText)

  updateOverlay({ status: 'success' })
  setTimeout(() => hideOverlay(), 800)
  clearSession()

  streamingSessions.delete(sessionId)
  return finalText
}

export function cancelStreamingSession(sessionId: string): void {
  const sessionState = streamingSessions.get(sessionId)
  if (sessionState?.asrProvider) {
    sessionState.asrProvider.stopStreamingTranscription()
  }
  streamingSessions.delete(sessionId)
}

export const __testUtils = {
  buildPromptForChunk,
  mergeTranscriptSegments,
  resolveAudioExtension,
  shouldSkipSessionOutput,
  resetChunkSessions: () => {
    chunkSessions.clear()
  },
  getChunkSession: (sessionId: string) => chunkSessions.get(sessionId),
}
