import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Key } from '@nut-tree-fork/nut-js'

const clipboardMock = {
  availableFormats: vi.fn(),
  readText: vi.fn(),
  readHTML: vi.fn(),
  readRTF: vi.fn(),
  readImage: vi.fn(),
  write: vi.fn(),
  writeText: vi.fn(),
}

const keyboardMock = {
  config: { autoDelayMs: 0 },
  type: vi.fn(),
  pressKey: vi.fn(),
  releaseKey: vi.fn(),
}

const KeyMock = {
  LeftCmd: 'LeftCmd',
  LeftControl: 'LeftControl',
  V: 'V',
}

vi.mock('electron', () => ({
  clipboard: clipboardMock,
}))

vi.mock('@nut-tree-fork/nut-js', () => ({
  keyboard: keyboardMock,
  Key: KeyMock,
}))

const loadInjector = async () => {
  const module = await import('../text-injector')
  return module
}

describe('TextInjector', () => {
  const originalPlatform = process.platform

  const setPlatform = (platform: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    })
  }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    clipboardMock.availableFormats.mockReturnValue([])
    clipboardMock.readImage.mockReturnValue({ isEmpty: () => true })
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  it('skips injection on empty text', async () => {
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()
    await injector.injectText('   ')
    expect(keyboardMock.type).not.toHaveBeenCalled()
    expect(clipboardMock.writeText).not.toHaveBeenCalled()
  })

  it('types single-line text on macOS', async () => {
    setPlatform('darwin')
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()
    await injector.injectText('hello')
    expect(keyboardMock.type).toHaveBeenCalledWith('hello')
    expect(clipboardMock.writeText).not.toHaveBeenCalled()
  })

  it('pastes multiline text on macOS to preserve line breaks', async () => {
    setPlatform('darwin')
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()

    await injector.injectText('first line\nsecond line')

    expect(keyboardMock.type).not.toHaveBeenCalled()
    expect(clipboardMock.writeText).toHaveBeenCalledWith('first line\nsecond line')
    expect(keyboardMock.pressKey).toHaveBeenCalledWith(KeyMock.LeftCmd, KeyMock.V)
    expect(keyboardMock.releaseKey).toHaveBeenCalledWith(KeyMock.LeftCmd, KeyMock.V)
  })

  it('uses clipboard paste on windows', async () => {
    setPlatform('win32')
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()

    await injector.injectText('hello')

    expect(keyboardMock.type).not.toHaveBeenCalled()
    expect(clipboardMock.writeText).toHaveBeenCalledWith('hello')
    expect(keyboardMock.pressKey).toHaveBeenCalledWith(KeyMock.LeftControl, KeyMock.V)
    expect(keyboardMock.releaseKey).toHaveBeenCalledWith(KeyMock.LeftControl, KeyMock.V)
  })

  it('pressKey triggers keyboard press and release', async () => {
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()
    const testKey = KeyMock.V as unknown as Key
    await injector.pressKey(testKey)
    expect(keyboardMock.pressKey).toHaveBeenCalled()
    expect(keyboardMock.releaseKey).toHaveBeenCalled()
  })

  it('checkPermissions returns false when macOS permission is missing', async () => {
    setPlatform('darwin')
    keyboardMock.type.mockRejectedValueOnce(new Error('no permission'))
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()
    const result = await injector.checkPermissions()
    expect(result.hasPermission).toBe(false)
    expect(result.message).toContain('Accessibility')
  })

  it('pasteFromClipboard preserves clipboard content', async () => {
    setPlatform('darwin')
    const { TextInjector } = await loadInjector()
    const injector = new TextInjector()

    clipboardMock.availableFormats.mockReturnValue([
      'text/plain',
      'text/html',
      'text/rtf',
      'image/png',
    ])
    clipboardMock.readText.mockReturnValue('old')
    clipboardMock.readHTML.mockReturnValue('<p>old</p>')
    clipboardMock.readRTF.mockReturnValue('{\\rtf1 old}')
    clipboardMock.readImage.mockReturnValue({ isEmpty: () => false })

    await (
      injector as unknown as { pasteFromClipboard: (text: string) => Promise<void> }
    ).pasteFromClipboard('new')

    expect(clipboardMock.writeText).toHaveBeenCalledWith('new')
    expect(keyboardMock.pressKey).toHaveBeenCalledWith(KeyMock.LeftCmd, KeyMock.V)
    expect(keyboardMock.releaseKey).toHaveBeenCalledWith(KeyMock.LeftCmd, KeyMock.V)
    expect(clipboardMock.write).toHaveBeenCalledWith({
      text: 'old',
      html: '<p>old</p>',
      rtf: '{\\rtf1 old}',
      image: expect.any(Object),
    })
  })
})
