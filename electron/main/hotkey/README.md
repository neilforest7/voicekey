# hotkey/

主进程快捷键解析与 PTT 行为绑定模块。

## 文件

- `index.ts` - 快捷键模块统一导出。
- `parser.ts` - 解析 Electron Accelerator 对应的主键与修饰键；无法识别的主键返回 null 而非静默回退。
- `ptt-handler.ts` - 注册 PTT 与设置快捷键，绑定录音开始/停止行为；导出 `clearPendingDebounce` 供重注册时清理防抖计时器。
