# main/

Electron 主进程目录，负责窗口管理、IPC、录音编排、ASR/润色调用与文本注入。

## 文件列表

- `main.ts` - 应用入口；初始化窗口、托盘、IPC、ASR/润色服务与录音流程。
- `i18n.ts` - 主进程 i18next 初始化与语言广播。
- `env.ts` - 开发/生产环境资源路径解析。
- `config-manager.ts` - 基于 `electron-store` 的应用配置持久化。
- `logger.ts` - `electron-log` 初始化与日志保留策略。
- `history-manager.ts` - 转录历史存储与统计。
- `hotkey-manager.ts` - Electron `globalShortcut` 管理。
- `iohook-manager.ts` - `uiohook-napi` 键盘监听。
- `asr-provider.ts` - GLM ASR API 封装；支持 `prompt` 与 `request_id`。
- `refine/` - 文本润色模块；使用 OpenAI-compatible Chat Completions 做轻量后处理，并按内容结构在需要时分段、分行、按需分点，要求列表项逐行输出。
- `text-injector.ts` - 基于 `@nut-tree-fork/nut-js` 的文本注入；Windows 始终走剪贴板粘贴，macOS 的多行文本也改走剪贴板粘贴以保留换行并降低误发送风险。
- `updater-manager.ts` - GitHub Releases 更新检查。
- `audio/` - 录音会话与 29 秒内部切段转写流水线。
- `hotkey/` - 快捷键解析与 PTT 行为绑定。
- `tray/` - 托盘菜单与本地化刷新。
- `window/` - 后台窗口、设置窗口与 HUD 管理。
- `notification/` - 系统通知封装。
- `ipc/` - IPC 处理器模块。
- `__tests__/` - 主进程模块测试。
