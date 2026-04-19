import fs from 'fs'
import path from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { gunzipSync, gzipSync } from 'node:zlib'
import WebSocket from 'ws'
import { VOLCENGINE_ASR } from '../../shared/constants'
import type { ASRConfig } from '../../shared/types'
import type { ASRProvider, TranscribeAudioOptions, TranscriptionResult } from '../asr-provider'
import { convertToPCM } from '../audio/converter'

export type StreamingTranscriptCallback = (text: string, isFinal: boolean) => void

type VolcengineServerMessage = {
  isLast: boolean
  text: string
  error?: string
}

type ConnectedSocket = {
  ws: WebSocket
  resourceId: string
}

export class VolcengineASRProvider implements ASRProvider {
  private streamingSocket: WebSocket | null = null

  constructor(private readonly config: ASRConfig) {}

  async transcribe(
    audioFilePath: string,
    options: TranscribeAudioOptions = {},
  ): Promise<TranscriptionResult> {
    const settings = this.config.volcengine
    validateVolcengineConfig(settings, { requireResourceId: false })

    const preferredInputPath = options.sourceAudioFilePath || audioFilePath

    if (!fs.existsSync(preferredInputPath)) {
      throw new Error('Audio file not found')
    }

    const tempPcmPath = path.join(app.getPath('temp'), `voice-key-volc-${randomUUID()}.pcm`)

    try {
      await convertToPCM(preferredInputPath, tempPcmPath, {
        sampleRate: VOLCENGINE_ASR.AUDIO_RATE,
        channels: VOLCENGINE_ASR.AUDIO_CHANNELS,
      })

      const pcmBuffer = fs.readFileSync(tempPcmPath)
      const response = await this.streamPCM(pcmBuffer, options)

      return {
        text: response.text.trim(),
        id: options.requestId || randomUUID(),
        created: Date.now(),
        model: VOLCENGINE_ASR.MODEL,
      }
    } finally {
      if (fs.existsSync(tempPcmPath)) {
        fs.unlinkSync(tempPcmPath)
      }
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      validateVolcengineConfig(this.config.volcengine, { requireResourceId: false })
      const { ws } = await this.openSocket()
      await this.probeConnection(ws)
      return true
    } catch (error) {
      console.error('Volcengine connection test failed:', error)
      return false
    }
  }

  async startStreamingTranscription(onTranscript: StreamingTranscriptCallback): Promise<void> {
    const { ws } = await this.openSocket()
    this.streamingSocket = ws

    let latestText = ''

    ws.on('message', (rawData: WebSocket.RawData) => {
      try {
        const message = parseServerMessage(asBuffer(rawData))
        if (message.error) {
          console.error('[VolcengineASR] Streaming error:', message.error)
          onTranscript(latestText, true)
          return
        }

        if (message.text) {
          latestText = message.text
          onTranscript(message.text, false)
        }

        if (message.isLast) {
          onTranscript(latestText, true)
        }
      } catch (error) {
        console.error('[VolcengineASR] Failed to parse streaming message:', error)
      }
    })

    ws.on('error', (error: Error) => {
      console.error('[VolcengineASR] Streaming socket error:', error)
      onTranscript(latestText, true)
    })

    ws.on('close', () => {
      onTranscript(latestText, true)
    })

    const metadata = buildFullClientRequest({
      user: { uid: `voice-key-streaming-${randomUUID()}` },
      audio: {
        format: 'pcm',
        codec: 'raw',
        rate: VOLCENGINE_ASR.AUDIO_RATE,
        bits: VOLCENGINE_ASR.AUDIO_BITS,
        channel: VOLCENGINE_ASR.AUDIO_CHANNELS,
      },
      request: {
        model_name: VOLCENGINE_ASR.MODEL,
        enable_itn: true,
        enable_punc: true,
        show_utterances: true,
      },
    })

    ws.send(metadata)
  }

  sendStreamingAudioChunk(pcmBuffer: Buffer, isLast: boolean): void {
    if (!this.streamingSocket || this.streamingSocket.readyState !== WebSocket.OPEN) {
      console.warn('[VolcengineASR] Streaming socket not ready, dropping chunk')
      return
    }

    console.log(`[VolcengineASR] Sending audio chunk: ${pcmBuffer.length} bytes, isLast=${isLast}`)

    const chunkSize = Math.max(
      1,
      Math.floor(
        (VOLCENGINE_ASR.AUDIO_RATE *
          VOLCENGINE_ASR.AUDIO_CHANNELS *
          (VOLCENGINE_ASR.AUDIO_BITS / 8) *
          VOLCENGINE_ASR.FRAME_DURATION_MS) /
          1000,
      ),
    )

    let chunksSent = 0
    for (let offset = 0; offset < pcmBuffer.length; offset += chunkSize) {
      const isChunkLast = offset + chunkSize >= pcmBuffer.length || isLast
      const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length))
      this.streamingSocket.send(buildAudioPacket(chunk, isChunkLast && isLast))
      chunksSent++
    }

    console.log(`[VolcengineASR] Sent ${chunksSent} frame(s)`)

    if (pcmBuffer.length === 0 && isLast) {
      this.streamingSocket.send(buildAudioPacket(Buffer.alloc(0), true))
      console.log('[VolcengineASR] Sent final empty chunk')
    }
  }

  stopStreamingTranscription(): void {
    if (this.streamingSocket) {
      this.streamingSocket.close()
      this.streamingSocket = null
    }
  }

  private async streamPCM(
    pcmBuffer: Buffer,
    options: TranscribeAudioOptions,
  ): Promise<VolcengineServerMessage> {
    const { ws, resourceId } = await this.openSocket()

    return await new Promise<VolcengineServerMessage>((resolve, reject) => {
      let latestText = ''
      let settled = false

      const cleanup = () => {
        ws.removeAllListeners('message')
        ws.removeAllListeners('close')
      }

      const finish = (message: VolcengineServerMessage) => {
        if (settled) return
        settled = true
        cleanup()
        ws.close()
        resolve({
          ...message,
          text: message.text || latestText,
        })
      }

      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        ws.close()
        reject(error)
      }

      ws.on('message', (rawData: WebSocket.RawData) => {
        try {
          const message = parseServerMessage(asBuffer(rawData))
          if (message.error) {
            fail(new Error(message.error))
            return
          }

          if (message.text) {
            latestText = message.text
          }

          if (message.isLast) {
            finish(message)
          }
        } catch (error) {
          fail(error)
        }
      })

      ws.on('error', (error: Error) => {
        if (settled) return
        fail(error)
      })
      ws.on('close', () => {
        if (!settled) {
          if (latestText) {
            finish({ isLast: true, text: latestText })
          } else {
            fail(new Error('Volcengine socket closed before final transcript arrived'))
          }
        }
      })

      const metadata = buildFullClientRequest({
        user: { uid: options.requestId || 'voice-key-desktop' },
        audio: {
          format: 'pcm',
          codec: 'raw',
          rate: VOLCENGINE_ASR.AUDIO_RATE,
          bits: VOLCENGINE_ASR.AUDIO_BITS,
          channel: VOLCENGINE_ASR.AUDIO_CHANNELS,
        },
        request: {
          model_name: VOLCENGINE_ASR.MODEL,
          enable_itn: true,
          enable_punc: true,
          show_utterances: true,
        },
        corpus: options.prompt
          ? {
              context: JSON.stringify({
                context_type: 'dialog_ctx',
                context_data: [{ text: options.prompt }],
              }),
            }
          : undefined,
      })

      console.log(`[VolcengineASR] Using resourceId: ${resourceId}`)

      ws.send(metadata)

      const chunkSize = Math.max(
        1,
        Math.floor(
          (VOLCENGINE_ASR.AUDIO_RATE *
            VOLCENGINE_ASR.AUDIO_CHANNELS *
            (VOLCENGINE_ASR.AUDIO_BITS / 8) *
            VOLCENGINE_ASR.FRAME_DURATION_MS) /
            1000,
        ),
      )

      for (let offset = 0; offset < pcmBuffer.length; offset += chunkSize) {
        const isLast = offset + chunkSize >= pcmBuffer.length
        const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length))
        ws.send(buildAudioPacket(chunk, isLast))
      }

      if (pcmBuffer.length === 0) {
        ws.send(buildAudioPacket(Buffer.alloc(0), true))
      }
    })
  }

  private async probeConnection(ws: WebSocket): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        ws.removeAllListeners('message')
        ws.removeAllListeners('close')
      }

      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        ws.close()
        resolve()
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        ws.close()
        reject(error)
      }

      ws.once('message', (rawData: WebSocket.RawData) => {
        try {
          const message = parseServerMessage(asBuffer(rawData))
          if (message.error) {
            fail(new Error(message.error))
            return
          }

          finish()
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Invalid Volcengine response'))
        }
      })
      ws.on('error', (error: Error) => {
        if (settled) return
        fail(error)
      })
      ws.once('close', (code: number, reason: Buffer) => {
        if (code === 1000) {
          finish()
          return
        }

        fail(new Error(`Volcengine socket closed: ${code} ${reason.toString()}`))
      })

      ws.send(
        buildFullClientRequest({
          user: { uid: 'voice-key-test' },
          audio: {
            format: 'pcm',
            codec: 'raw',
            rate: VOLCENGINE_ASR.AUDIO_RATE,
            bits: VOLCENGINE_ASR.AUDIO_BITS,
            channel: VOLCENGINE_ASR.AUDIO_CHANNELS,
          },
          request: {
            model_name: VOLCENGINE_ASR.MODEL,
            enable_itn: true,
            enable_punc: true,
            show_utterances: true,
          },
        }),
      )
      ws.send(buildAudioPacket(Buffer.alloc(0), true))
    })
  }

  private async openSocket(): Promise<ConnectedSocket> {
    const settings = this.config.volcengine
    const endpoint = settings.endpoint || VOLCENGINE_ASR.ENDPOINT
    const resourceIds = resolveResourceIdCandidates(settings.resourceId)

    let lastError: Error | null = null

    for (const resourceId of resourceIds) {
      try {
        const ws = await this.openSocketWithResourceId(endpoint, settings, resourceId)
        return { ws, resourceId }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        console.warn(`[VolcengineASR] Resource ID failed: ${resourceId}`, lastError.message)
      }
    }

    throw lastError ?? new Error('No usable Volcengine Resource ID found')
  }

  private async openSocketWithResourceId(
    endpoint: string,
    settings: ASRConfig['volcengine'],
    resourceId: string,
  ): Promise<WebSocket> {
    return await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(endpoint, {
        headers: {
          'X-Api-App-Key': settings.appKey,
          'X-Api-Access-Key': settings.accessKey,
          'X-Api-Resource-Id': resourceId,
          'X-Api-Connect-Id': randomUUID(),
        },
        handshakeTimeout: VOLCENGINE_ASR.CONNECT_TIMEOUT_MS,
      })

      let settled = false

      const cleanupOpenListeners = () => {
        ws.removeAllListeners('open')
        ws.removeAllListeners('error')
        ws.removeAllListeners('close')
        ws.removeAllListeners('unexpected-response')
      }

      const resolveSocket = () => {
        if (settled) return
        settled = true
        cleanupOpenListeners()
        resolve(ws)
      }

      const rejectSocket = (error: Error) => {
        if (settled) return
        settled = true
        cleanupOpenListeners()
        reject(error)
      }

      // Use on() + settled guard instead of once() + cleanup().
      // ws timeout emits 'close' then 'error' synchronously — once('close')
      // would remove the error listener before it fires.
      ws.once('open', resolveSocket)

      ws.on('error', (error: Error) => rejectSocket(error))
      ws.once('close', (code: number, reason: Buffer) => {
        rejectSocket(new Error(`Volcengine socket closed: ${code} ${reason.toString()}`))
      })
      ws.once('unexpected-response', (_request: unknown, response: IncomingMessage) => {
        rejectSocket(
          new Error(`Volcengine unexpected response: ${response.statusCode ?? 'unknown'}`),
        )
      })
    })
  }
}

function validateVolcengineConfig(
  config: ASRConfig['volcengine'],
  options: { requireResourceId?: boolean } = {},
): void {
  if (!config.appKey.trim()) {
    throw new Error('Volcengine App Key is required')
  }
  if (!config.accessKey.trim()) {
    throw new Error('Volcengine Access Key is required')
  }
  if ((options.requireResourceId ?? true) && !config.resourceId.trim()) {
    throw new Error('Volcengine Resource ID is required')
  }
}

function resolveResourceIdCandidates(resourceId: string): string[] {
  const candidates = [
    resourceId,
    VOLCENGINE_ASR.RESOURCE_ID,
    VOLCENGINE_ASR.RESOURCE_ID_CONCURRENT,
    VOLCENGINE_ASR.RESOURCE_ID_COMPAT,
    VOLCENGINE_ASR.RESOURCE_ID_COMPAT_CONCURRENT,
  ]
    .map((value) => value.trim())
    .filter(Boolean)

  return Array.from(new Set(candidates))
}

function buildFullClientRequest(payload: object): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const compressed = gzipSync(json)
  const header = Buffer.from([0x11, 0x10, 0x11, 0x00])
  const size = Buffer.allocUnsafe(4)
  size.writeUInt32BE(compressed.length, 0)
  return Buffer.concat([header, size, compressed])
}

function buildAudioPacket(audio: Buffer, isLast: boolean): Buffer {
  const compressed = gzipSync(audio)
  const header = Buffer.from([0x11, isLast ? 0x22 : 0x20, 0x01, 0x00])
  const size = Buffer.allocUnsafe(4)
  size.writeUInt32BE(compressed.length, 0)
  return Buffer.concat([header, size, compressed])
}

function parseServerMessage(data: Buffer): VolcengineServerMessage {
  const msgType = (data[1] >> 4) & 0x0f
  const flags = data[1] & 0x0f
  const compression = data[2] & 0x0f

  if (msgType === 0b1111) {
    const errCode = data.readUInt32BE(4)
    const errMsgSize = data.readUInt32BE(8)
    const errPayload = data.subarray(12, 12 + errMsgSize)
    const errMsg = decodePayload(errPayload, compression).toString('utf8')
    return { isLast: true, text: '', error: `Error ${errCode}: ${errMsg}` }
  }

  const hasSequence = flags === 0b0001 || flags === 0b0011
  const sizeOffset = hasSequence ? 8 : 4
  const payloadOffset = hasSequence ? 12 : 8
  const payloadSize = data.readUInt32BE(sizeOffset)
  const payloadBuffer = data.subarray(payloadOffset, payloadOffset + payloadSize)
  const payload = JSON.parse(decodePayload(payloadBuffer, compression).toString('utf8')) as {
    is_last_package?: boolean
    result?: { text?: string }
  }

  return {
    isLast: Boolean(flags & 0b0010 || payload.is_last_package),
    text: payload.result?.text ?? '',
  }
}

function decodePayload(payload: Buffer, compression: number): Buffer {
  if (compression === 0b0001) {
    return gunzipSync(payload)
  }

  return payload
}

function asBuffer(rawData: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(rawData)) {
    return rawData
  }
  if (Array.isArray(rawData)) {
    return Buffer.concat(rawData)
  }
  return Buffer.from(rawData)
}
