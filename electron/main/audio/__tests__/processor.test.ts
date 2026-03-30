import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import type { AudioChunkPayload } from '@electron/shared/types'

const mockUpdateOverlay = vi.fn()
const mockHideOverlay = vi.fn()
const mockHistoryAdd = vi.fn()
const mockInjectText = vi.fn()
const mockConvertToMP3 = vi.fn()
const mockGetCurrentSession = vi.fn()
const mockUpdateSession = vi.fn()
const mockClearSession = vi.fn()
const mockGetBackgroundWindow = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
  },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const fsMock = {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    unlinkSync: vi.fn(),
  }
  return {
    ...fsMock,
    default: fsMock,
  }
})

vi.mock('../../window/overlay', () => ({
  updateOverlay: mockUpdateOverlay,
  hideOverlay: mockHideOverlay,
}))

vi.mock('../../window/background', () => ({
  getBackgroundWindow: mockGetBackgroundWindow,
}))

vi.mock('../../i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('../../history-manager', () => ({
  historyManager: {
    add: mockHistoryAdd,
  },
}))

vi.mock('../../text-injector', () => ({
  textInjector: {
    injectText: mockInjectText,
  },
}))

vi.mock('../converter', () => ({
  convertToMP3: mockConvertToMP3,
}))

vi.mock('../session-manager', () => ({
  getCurrentSession: mockGetCurrentSession,
  updateSession: mockUpdateSession,
  clearSession: mockClearSession,
}))

const loadProcessor = async () => {
  const module = await import('../processor')
  module.__testUtils.resetChunkSessions()
  return module
}

const createChunk = (overrides: Partial<AudioChunkPayload> = {}): AudioChunkPayload => {
  const audioBuffer = Buffer.from('audio')

  return {
    sessionId: 'session-1',
    chunkIndex: 0,
    isFinal: true,
    mimeType: 'audio/webm',
    buffer: audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ),
    ...overrides,
  }
}

const createSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  startTime: new Date(),
  status: 'processing',
  duration: 1200,
  ...overrides,
})

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('audio processor', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockConvertToMP3.mockResolvedValue(undefined)
    mockGetCurrentSession.mockReturnValue(null)
    mockGetBackgroundWindow.mockReturnValue({
      webContents: {
        send: vi.fn(),
      },
    })
  })

  it('returns early when session is inactive', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    const transcribe = vi.fn()

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
    })

    await handleAudioChunk(createChunk())

    expect(mockConvertToMP3).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
    expect(mockHistoryAdd).not.toHaveBeenCalled()
  })

  it('processes a single final chunk end-to-end', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    const session = createSession()
    mockGetCurrentSession.mockReturnValue(session)

    const transcribe = vi.fn().mockResolvedValue({
      text: 'hello world',
      id: 't-1',
      created: Date.now(),
      model: 'glm',
    })

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({
        provider: 'glm',
        region: 'cn',
        apiKeys: { cn: '', intl: '' },
        lowVolumeMode: true,
      }),
      initializeASRProvider: vi.fn(),
    })

    vi.useFakeTimers()
    const promise = handleAudioChunk(createChunk())
    await promise
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    expect(mockConvertToMP3).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      gainDb: 10,
    })
    expect(transcribe).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        prompt: undefined,
        requestId: 'session-1-chunk-0',
      }),
    )
    expect(mockUpdateSession).toHaveBeenCalledWith({
      transcription: 'hello world',
      status: 'completed',
    })
    expect(mockHistoryAdd).toHaveBeenCalledWith({
      text: 'hello world',
      duration: session.duration,
    })
    expect(mockInjectText).toHaveBeenCalledWith('hello world')
    expect(mockUpdateOverlay).toHaveBeenCalledWith({ status: 'success' })
    expect(mockHideOverlay).toHaveBeenCalled()
    expect(mockClearSession).toHaveBeenCalled()
  })

  it('merges multiple chunks in chunk order before refining and injecting once', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    mockGetCurrentSession.mockReturnValue(createSession())

    const deferredChunk0 = createDeferred<{
      text: string
      id: string
      created: number
      model: string
    }>()
    const transcribe = vi
      .fn()
      .mockImplementationOnce(() => deferredChunk0.promise)
      .mockResolvedValueOnce({
        text: 'world',
        id: 't-2',
        created: Date.now(),
        model: 'glm',
      })
    const refineText = vi.fn().mockResolvedValue('hello world')

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
      getRefineService: () =>
        ({
          isEnabled: () => true,
          hasValidConfig: () => true,
          refineText,
        }) as any,
    })

    const chunk0Promise = handleAudioChunk(createChunk({ chunkIndex: 0, isFinal: false }))
    const chunk1Promise = handleAudioChunk(createChunk({ chunkIndex: 1, isFinal: true }))

    deferredChunk0.resolve({
      text: 'hello',
      id: 't-1',
      created: Date.now(),
      model: 'glm',
    })

    await Promise.all([chunk0Promise, chunk1Promise])

    expect(refineText).toHaveBeenCalledWith('hello world')
    expect(mockHistoryAdd).toHaveBeenCalledTimes(1)
    expect(mockInjectText).toHaveBeenCalledTimes(1)
    expect(mockInjectText).toHaveBeenCalledWith('hello world')
  })

  it('preserves multiline refined text through update, history, and injection', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    const session = createSession()
    mockGetCurrentSession.mockReturnValue(session)

    const transcribe = vi.fn().mockResolvedValue({
      text: 'raw text',
      id: 't-1',
      created: Date.now(),
      model: 'glm',
    })
    const refinedText = '1. first item\n2. second item'
    const refineText = vi.fn().mockResolvedValue(refinedText)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
      getRefineService: () =>
        ({
          isEnabled: () => true,
          hasValidConfig: () => true,
          refineText,
        }) as any,
    })

    try {
      await handleAudioChunk(createChunk())

      expect(mockUpdateSession).toHaveBeenCalledWith({
        transcription: refinedText,
        status: 'completed',
      })
      expect(mockHistoryAdd).toHaveBeenCalledWith({
        text: refinedText,
        duration: session.duration,
      })
      expect(mockInjectText).toHaveBeenCalledWith(refinedText)
      expect(logSpy).toHaveBeenCalledWith('[Audio:Processor] Final text formatting:', {
        length: refinedText.length,
        hasLineBreaks: true,
        lineBreakCount: 1,
      })
    } finally {
      logSpy.mockRestore()
    }
  })

  it('keeps chunk state until missing earlier chunks arrive after the final chunk', async () => {
    const { initProcessor, handleAudioChunk, __testUtils } = await loadProcessor()
    mockGetCurrentSession.mockReturnValue(createSession())

    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'world',
        id: 't-2',
        created: Date.now(),
        model: 'glm',
      })
      .mockResolvedValueOnce({
        text: 'hello',
        id: 't-1',
        created: Date.now(),
        model: 'glm',
      })

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
    })

    await handleAudioChunk(createChunk({ chunkIndex: 1, isFinal: true }))

    expect(mockHistoryAdd).not.toHaveBeenCalled()
    expect(mockInjectText).not.toHaveBeenCalled()
    expect(__testUtils.getChunkSession('session-1')).toBeDefined()

    await handleAudioChunk(createChunk({ chunkIndex: 0, isFinal: false }))

    expect(mockUpdateSession).toHaveBeenCalledWith({
      transcription: 'hello world',
      status: 'completed',
    })
    expect(mockHistoryAdd).toHaveBeenCalledWith({
      text: 'hello world',
      duration: 1200,
    })
    expect(mockInjectText).toHaveBeenCalledWith('hello world')
    expect(__testUtils.getChunkSession('session-1')).toBeUndefined()
  })

  it('uses prompt context when previous chunks are already available', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    mockGetCurrentSession.mockReturnValue(createSession())

    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'hello',
        id: 't-1',
        created: Date.now(),
        model: 'glm',
      })
      .mockResolvedValueOnce({
        text: 'world',
        id: 't-2',
        created: Date.now(),
        model: 'glm',
      })

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
    })

    await handleAudioChunk(createChunk({ chunkIndex: 0, isFinal: false }))
    await handleAudioChunk(createChunk({ chunkIndex: 1, isFinal: true }))

    expect(transcribe).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        prompt: 'hello',
        requestId: 'session-1-chunk-1',
      }),
    )
  })

  it('skips prompt context when previous chunk is not ready yet', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    mockGetCurrentSession.mockReturnValue(createSession())

    const deferredChunk0 = createDeferred<{
      text: string
      id: string
      created: number
      model: string
    }>()
    const transcribe = vi
      .fn()
      .mockImplementationOnce(() => deferredChunk0.promise)
      .mockResolvedValueOnce({
        text: 'world',
        id: 't-2',
        created: Date.now(),
        model: 'glm',
      })

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
    })

    const chunk0Promise = handleAudioChunk(createChunk({ chunkIndex: 0, isFinal: false }))
    const chunk1Promise = handleAudioChunk(createChunk({ chunkIndex: 1, isFinal: true }))
    await Promise.resolve()

    expect(transcribe).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        prompt: undefined,
        requestId: 'session-1-chunk-1',
      }),
    )

    deferredChunk0.resolve({
      text: 'hello',
      id: 't-1',
      created: Date.now(),
      model: 'glm',
    })
    await Promise.all([chunk0Promise, chunk1Promise])
  })

  it('drops finalization when the session is cancelled before completion', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    let statusCallCount = 0
    mockGetCurrentSession.mockImplementation(() => {
      statusCallCount += 1
      return statusCallCount <= 2 ? createSession() : null
    })

    const transcribe = vi.fn().mockResolvedValue({
      text: 'hello world',
      id: 't-1',
      created: Date.now(),
      model: 'glm',
    })

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
    })

    await handleAudioChunk(createChunk())

    expect(mockHistoryAdd).not.toHaveBeenCalled()
    expect(mockInjectText).not.toHaveBeenCalled()
    expect(mockClearSession).not.toHaveBeenCalled()
  })

  it('fails fast on chunk error and stops an active recording session', async () => {
    const { initProcessor, handleAudioChunk } = await loadProcessor()
    const window = {
      webContents: {
        send: vi.fn(),
      },
    }
    mockGetBackgroundWindow.mockReturnValue(window)
    mockGetCurrentSession.mockReturnValue(createSession({ status: 'recording' }))

    const transcribe = vi.fn().mockRejectedValue(new Error('ASR down'))

    initProcessor({
      getAsrProvider: () => ({ transcribe }) as any,
      getASRConfig: () => ({ provider: 'glm', region: 'cn', apiKeys: { cn: '', intl: '' } }),
      initializeASRProvider: vi.fn(),
    })

    vi.useFakeTimers()
    await handleAudioChunk(createChunk())
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    expect(mockUpdateSession).toHaveBeenCalledWith({
      status: 'error',
      error: 'ASR down',
    })
    expect(window.webContents.send).toHaveBeenCalledWith('session:stop')
    expect(mockUpdateOverlay).toHaveBeenCalledWith({
      status: 'error',
      message: 'ASR down',
    })
    expect(mockHistoryAdd).not.toHaveBeenCalled()
    expect(mockInjectText).not.toHaveBeenCalled()
  })
})
