import { UiohookKey } from '../iohook-manager'

/**
 * 将 Electron Accelerator 格式字符串解析为 uiohook 参数
 *
 * 支持的格式：
 * - 单修饰键：Command, Control, Alt, Shift
 * - 组合键：Command+Space, Control+Shift+A
 * - 功能键：F1-F24
 * - 字母/数字：A-Z, 0-9
 *
 * @param accelerator Electron Accelerator 格式字符串
 * @returns { modifiers: string[], key: number } 或 null
 */
export function parseAccelerator(accelerator: string): { modifiers: string[]; key: number } | null {
  const parts = accelerator.split('+')
  const keyStr = parts.pop()
  if (!keyStr) return null

  const lowerKey = keyStr.toLowerCase()

  // 1. 单独修饰键作为主键的情况（无其他修饰键）
  if (parts.length === 0) {
    if (lowerKey === 'command' || lowerKey === 'cmd' || lowerKey === 'meta') {
      return { modifiers: [], key: UiohookKey.Meta }
    }
    if (lowerKey === 'control' || lowerKey === 'ctrl') {
      return { modifiers: [], key: UiohookKey.Ctrl }
    }
    if (lowerKey === 'alt' || lowerKey === 'option') {
      return { modifiers: [], key: UiohookKey.Alt }
    }
    if (lowerKey === 'shift') {
      return { modifiers: [], key: UiohookKey.Shift }
    }
  }

  // 2. 解析修饰键数组
  const modifiers = parts.map((p) => {
    const lower = p.toLowerCase()
    if (lower === 'command' || lower === 'cmd' || lower === 'meta') return 'meta'
    if (lower === 'control' || lower === 'ctrl') return 'ctrl'
    if (lower === 'alt' || lower === 'option') return 'alt'
    return lower
  })

  // 3. 解析主键
  const key = keyToUiohookCode(keyStr)
  if (key === null) {
    console.warn(`[Hotkey:Parser] Unknown key "${keyStr}", skipping registration`)
    return null
  }

  return { modifiers, key }
}

/**
 * 将按键名称转换为 uiohook keycode
 */
export function keyToUiohookCode(keyStr: string): number | null {
  const upper = keyStr.toUpperCase()
  const lower = keyStr.toLowerCase()

  // 特殊键映射
  const specialKeys: Record<string, number> = {
    SPACE: UiohookKey.Space,
    ENTER: UiohookKey.Enter,
    RETURN: UiohookKey.Enter,
    TAB: UiohookKey.Tab,
    BACKSPACE: UiohookKey.Backspace,
    DELETE: UiohookKey.Delete,
    ESCAPE: UiohookKey.Escape,
    ESC: UiohookKey.Escape,
    UP: UiohookKey.ArrowUp,
    DOWN: UiohookKey.ArrowDown,
    LEFT: UiohookKey.ArrowLeft,
    RIGHT: UiohookKey.ArrowRight,
    HOME: UiohookKey.Home,
    END: UiohookKey.End,
    PAGEUP: UiohookKey.PageUp,
    PAGEDOWN: UiohookKey.PageDown,
    INSERT: UiohookKey.Insert,
    CAPSLOCK: UiohookKey.CapsLock,
    NUMLOCK: UiohookKey.NumLock,
    PRINTSCREEN: UiohookKey.PrintScreen,
    // 标点符号
    COMMA: UiohookKey.Comma,
    PERIOD: UiohookKey.Period,
    SLASH: UiohookKey.Slash,
    BACKSLASH: UiohookKey.Backslash,
    SEMICOLON: UiohookKey.Semicolon,
    QUOTE: UiohookKey.Quote,
    BRACKETLEFT: UiohookKey.BracketLeft,
    BRACKETRIGHT: UiohookKey.BracketRight,
    MINUS: UiohookKey.Minus,
    EQUAL: UiohookKey.Equal,
    BACKQUOTE: UiohookKey.Backquote,
  }

  if (specialKeys[upper]) {
    return specialKeys[upper]
  }

  // F1-F24 功能键
  const fMatch = upper.match(/^F(\d+)$/)
  if (fMatch) {
    const fNum = parseInt(fMatch[1])
    if (fNum >= 1 && fNum <= 24) {
      const fKey = `F${fNum}` as keyof typeof UiohookKey
      if (UiohookKey[fKey] !== undefined) {
        return UiohookKey[fKey]
      }
    }
  }

  // 字母 A-Z
  if (/^[A-Z]$/.test(upper)) {
    const letterKey = upper as keyof typeof UiohookKey
    if (UiohookKey[letterKey] !== undefined) {
      return UiohookKey[letterKey]
    }
  }

  // 数字 0-9（主键盘区）
  if (/^[0-9]$/.test(upper)) {
    // UiohookKey 使用 Num0-Num9 表示主键盘数字
    const numKey = `Num${upper}` as keyof typeof UiohookKey
    if (UiohookKey[numKey] !== undefined) {
      return UiohookKey[numKey]
    }
    // 备用：直接尝试数字
    const directKey = upper as keyof typeof UiohookKey
    if (UiohookKey[directKey] !== undefined) {
      return UiohookKey[directKey]
    }
  }

  // 修饰键作为主键（组合键场景，如 Command+Control）
  if (lower === 'command' || lower === 'cmd' || lower === 'meta') {
    return UiohookKey.Meta
  }
  if (lower === 'control' || lower === 'ctrl') {
    return UiohookKey.Ctrl
  }
  if (lower === 'alt' || lower === 'option') {
    return UiohookKey.Alt
  }
  if (lower === 'shift') {
    return UiohookKey.Shift
  }

  return null
}
