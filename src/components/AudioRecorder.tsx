import { useEffect, useRef } from 'react'
import { GLM_ASR } from '@electron/shared/constants'
import type { RecordingStartPayload } from '@electron/shared/types'

type StopMeta = {
  chunkIndex: number
  isFinal: boolean
  rotateAfterStop: boolean
}

const STREAMING_TIMESLICE_MS = 200
const STREAMING_SAMPLE_RATE = 16000
const STREAMING_CHUNK_SAMPLES = (STREAMING_SAMPLE_RATE * STREAMING_TIMESLICE_MS) / 1000

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === STREAMING_SAMPLE_RATE) {
    return input
  }

  const ratio = inputSampleRate / STREAMING_SAMPLE_RATE
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)

  let outputIndex = 0
  let inputIndex = 0
  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio))
    let sum = 0
    let count = 0

    for (let i = inputIndex; i < nextInputIndex; i += 1) {
      sum += input[i]
      count += 1
    }

    output[outputIndex] = count > 0 ? sum / count : input[Math.min(inputIndex, input.length - 1)]
    outputIndex += 1
    inputIndex = nextInputIndex
  }

  return output
}

function float32ToInt16Buffer(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length)

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  return output.buffer
}

function takeQueuedSamples(queue: Float32Array[], sampleCount: number): Float32Array | null {
  if (sampleCount <= 0) {
    return null
  }

  const parts: Float32Array[] = []
  let total = 0
  let remaining = sampleCount

  while (remaining > 0 && queue.length > 0) {
    const first = queue[0]

    if (first.length <= remaining) {
      parts.push(first)
      total += first.length
      remaining -= first.length
      queue.shift()
      continue
    }

    parts.push(first.subarray(0, remaining))
    queue[0] = first.subarray(remaining)
    total += remaining
    remaining = 0
  }

  if (total === 0) {
    return null
  }

  const merged = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }

  return merged
}

export function AudioRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamingProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const streamingSilenceGainRef = useRef<GainNode | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopMetaRef = useRef<StopMeta | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const currentChunkIndexRef = useRef(0)
  const currentMimeTypeRef = useRef('audio/webm')
  const isRecordingRef = useRef(false)
  const isSessionEndingRef = useRef(false)
  const isStreamingModeRef = useRef(false)
  const pcmQueueRef = useRef<Float32Array[]>([])
  const pcmQueuedSamplesRef = useRef(0)

  const clearChunkTimer = () => {
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current)
      chunkTimerRef.current = null
    }
  }

  const clearSessionMaxTimer = () => {
    if (sessionMaxTimerRef.current) {
      clearTimeout(sessionMaxTimerRef.current)
      sessionMaxTimerRef.current = null
    }
  }

  const disconnectNode = (node: AudioNode | null) => {
    if (!node) return

    try {
      node.disconnect()
    } catch {
      // ignore teardown errors
    }
  }

  const releaseStreamingNodes = () => {
    disconnectNode(sourceNodeRef.current)
    disconnectNode(streamingProcessorRef.current)
    disconnectNode(streamingSilenceGainRef.current)
    sourceNodeRef.current = null
    streamingProcessorRef.current = null
    streamingSilenceGainRef.current = null
    pcmQueueRef.current = []
    pcmQueuedSamplesRef.current = 0
  }

  const releaseResources = () => {
    clearChunkTimer()
    clearSessionMaxTimer()

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    releaseStreamingNodes()

    if (audioContextRef.current) {
      void audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    analyserRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    stopMetaRef.current = null
    currentSessionIdRef.current = null
    currentChunkIndexRef.current = 0
    currentMimeTypeRef.current = 'audio/webm'
    isRecordingRef.current = false
    isSessionEndingRef.current = false
    isStreamingModeRef.current = false
  }

  const sendAudioLevel = () => {
    const analyser = analyserRef.current
    if (!analyser) return

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(dataArray)
    const sum = dataArray.reduce((a, b) => a + b, 0)
    const average = sum / dataArray.length
    const normalized = Math.min(average / 128, 1)
    window.electronAPI.sendAudioLevel(normalized)
    animationFrameRef.current = requestAnimationFrame(sendAudioLevel)
  }

  const sendStreamingPcmChunk = (samples: Float32Array) => {
    const sessionId = currentSessionIdRef.current
    if (!sessionId || samples.length === 0) {
      return
    }

    window.electronAPI.sendAudioChunk({
      sessionId,
      chunkIndex: currentChunkIndexRef.current,
      isFinal: false,
      mimeType: 'audio/pcm',
      buffer: float32ToInt16Buffer(samples),
    })
    currentChunkIndexRef.current += 1
  }

  const flushStreamingQueue = (isFinal: boolean) => {
    while (pcmQueuedSamplesRef.current >= STREAMING_CHUNK_SAMPLES) {
      const chunk = takeQueuedSamples(pcmQueueRef.current, STREAMING_CHUNK_SAMPLES)
      if (!chunk) {
        break
      }

      pcmQueuedSamplesRef.current -= chunk.length
      sendStreamingPcmChunk(chunk)
    }

    if (!isFinal) {
      return
    }

    const tail = takeQueuedSamples(pcmQueueRef.current, pcmQueuedSamplesRef.current)
    pcmQueuedSamplesRef.current = 0

    if (tail && tail.length > 0) {
      sendStreamingPcmChunk(tail)
    }

    const sessionId = currentSessionIdRef.current
    if (!sessionId) {
      return
    }

    window.electronAPI.sendAudioChunk({
      sessionId,
      chunkIndex: currentChunkIndexRef.current,
      isFinal: true,
      mimeType: 'audio/pcm',
      buffer: new ArrayBuffer(0),
    })
    currentChunkIndexRef.current += 1
  }

  const appendStreamingSamples = (input: Float32Array) => {
    const downsampled = downsampleTo16k(input, audioContextRef.current?.sampleRate ?? 48000)
    if (downsampled.length === 0) {
      return
    }

    pcmQueueRef.current.push(downsampled)
    pcmQueuedSamplesRef.current += downsampled.length
    flushStreamingQueue(false)
  }

  const handleRecorderStop = async () => {
    const sessionId = currentSessionIdRef.current
    const mimeType = currentMimeTypeRef.current
    const stopMeta = stopMetaRef.current ?? {
      chunkIndex: currentChunkIndexRef.current,
      isFinal: isSessionEndingRef.current,
      rotateAfterStop: !isSessionEndingRef.current,
    }
    stopMetaRef.current = null

    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []

    if (sessionId && blob.size > 0) {
      const buffer = await blob.arrayBuffer()
      window.electronAPI.sendAudioChunk({
        sessionId,
        chunkIndex: stopMeta.chunkIndex,
        isFinal: stopMeta.isFinal,
        mimeType,
        buffer,
      })
    } else if (stopMeta.isFinal && sessionId) {
      window.electronAPI.sendAudioChunk({
        sessionId,
        chunkIndex: stopMeta.chunkIndex,
        isFinal: true,
        mimeType,
        buffer: new ArrayBuffer(0),
      })
    } else {
      console.warn('[Renderer] Skipping empty audio chunk')
    }

    if (stopMeta.isFinal || isSessionEndingRef.current) {
      releaseResources()
      console.log('[Renderer] Final chunk sent, resources released')
      return
    }

    currentChunkIndexRef.current = stopMeta.chunkIndex + 1
    startChunkRecorder()
  }

  const requestRecorderStop = (nextStopMeta: StopMeta) => {
    if (nextStopMeta.isFinal) {
      isSessionEndingRef.current = true
    }

    const existingStopMeta = stopMetaRef.current
    if (existingStopMeta) {
      if (nextStopMeta.isFinal) {
        existingStopMeta.isFinal = true
        existingStopMeta.rotateAfterStop = false
      }
      return
    }

    const recorder = mediaRecorderRef.current
    if (!recorder) {
      if (nextStopMeta.isFinal) {
        releaseResources()
      }
      return
    }

    clearChunkTimer()
    stopMetaRef.current = {
      chunkIndex: nextStopMeta.chunkIndex,
      isFinal: nextStopMeta.isFinal,
      rotateAfterStop: nextStopMeta.rotateAfterStop && !nextStopMeta.isFinal,
    }

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  const scheduleChunkRotation = () => {
    clearChunkTimer()
    chunkTimerRef.current = setTimeout(() => {
      if (!isSessionEndingRef.current) {
        requestRecorderStop({
          chunkIndex: currentChunkIndexRef.current,
          isFinal: false,
          rotateAfterStop: true,
        })
      }
    }, GLM_ASR.REQUEST_MAX_DURATION_SECONDS * 1000)
  }

  const startStreamingCapture = (
    audioContext: AudioContext,
    source: MediaStreamAudioSourceNode,
  ) => {
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const silenceGain = audioContext.createGain()
    silenceGain.gain.value = 0

    processor.onaudioprocess = (event) => {
      if (isSessionEndingRef.current) {
        return
      }

      const input = event.inputBuffer.getChannelData(0)
      const copied = new Float32Array(input.length)
      copied.set(input)
      appendStreamingSamples(copied)
    }

    source.connect(processor)
    processor.connect(silenceGain)
    silenceGain.connect(audioContext.destination)

    streamingProcessorRef.current = processor
    streamingSilenceGainRef.current = silenceGain

    console.log('[Renderer] Streaming recording started')
  }

  const startChunkRecorder = () => {
    const stream = streamRef.current
    if (!stream) return

    const mediaRecorder = new MediaRecorder(stream, { mimeType: currentMimeTypeRef.current })
    mediaRecorderRef.current = mediaRecorder
    chunksRef.current = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      void handleRecorderStop()
    }

    mediaRecorder.onerror = (event) => {
      console.error('[Renderer] MediaRecorder error:', event)
      window.electronAPI.sendError(`MediaRecorder error: ${event}`)
      releaseResources()
    }

    mediaRecorder.start()
    scheduleChunkRotation()
    console.log(`[Renderer] Recording chunk ${currentChunkIndexRef.current} started`)
  }

  const startRecordingSession = async (payload: RecordingStartPayload) => {
    if (isRecordingRef.current) {
      console.warn('[Renderer] Already recording, ignoring start request')
      return
    }

    try {
      releaseResources()

      currentSessionIdRef.current = payload.sessionId
      currentChunkIndexRef.current = 0
      isRecordingRef.current = true
      isSessionEndingRef.current = false
      isStreamingModeRef.current = Boolean(payload.streamingMode)
      currentMimeTypeRef.current = isStreamingModeRef.current ? 'audio/pcm' : 'audio/webm'

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      sourceNodeRef.current = source

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      analyserRef.current = analyser

      sendAudioLevel()

      if (isStreamingModeRef.current) {
        startStreamingCapture(audioContext, source)
      } else {
        let mimeType = 'audio/wav'
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/webm'
        }
        currentMimeTypeRef.current = mimeType
        startChunkRecorder()
      }

      sessionMaxTimerRef.current = setTimeout(() => {
        if (!isSessionEndingRef.current && currentSessionIdRef.current === payload.sessionId) {
          void window.electronAPI.stopSession()
        }
      }, GLM_ASR.SESSION_MAX_DURATION_SECONDS * 1000)
    } catch (error) {
      console.error('[Renderer] Failed to start recording:', error)
      window.electronAPI.sendError(`Failed to access microphone: ${error}`)
      releaseResources()
    }
  }

  const stopRecordingSession = () => {
    console.log('[Renderer] onStopRecording triggered')

    if (isStreamingModeRef.current) {
      isSessionEndingRef.current = true
      flushStreamingQueue(true)
      releaseResources()
      console.log('[Renderer] Streaming recorder stopped, resources released')
      return
    }

    requestRecorderStop({
      chunkIndex: currentChunkIndexRef.current,
      isFinal: true,
      rotateAfterStop: false,
    })
  }

  useEffect(() => {
    const removeStartRecordingListener = window.electronAPI.onStartRecording((payload) => {
      void startRecordingSession(payload)
    })

    const removeStopRecordingListener = window.electronAPI.onStopRecording(() => {
      stopRecordingSession()
    })

    return () => {
      removeStartRecordingListener?.()
      removeStopRecordingListener?.()
      releaseResources()
      console.log('[Renderer] Component unmounted, resources released')
    }
  }, [])

  return null
}
