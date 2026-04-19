# main/

Electron 主进程目录，负责窗口管理、IPC、录音编排、ASR/润色调用与文本注入。

## 文件列表

- `main.ts` - 应用入口，初始化窗口、托盘、IPC、服务与录音流程。
- `i18n.ts` - 主进程 `i18next` 初始化与语言广播。
- `env.ts` - 开发/生产环境资源路径解析。
- `config-manager.ts` - 基于 `electron-store` 的配置持久化，处理多 ASR 提供商迁移并加密 GLM / 火山凭证与润色 API Key。
- `logger.ts` - `electron-log` 初始化与日志保留策略。
- `history-manager.ts` - 转录历史存储与统计。
- `hotkey-manager.ts` - Electron `globalShortcut` 管理。
- `iohook-manager.ts` - `uiohook-napi` 键盘监听。
- `asr-provider.ts` - ASR 提供商接口与工厂，根据当前配置选择具体识别实现。
- `asr-providers/` - 具体 ASR 提供商实现，当前包含 GLM HTTP 转写与火山引擎流式 ASR 2.0 WebSocket 客户端。
- `refine/` - 文本润色模块，使用 OpenAI-compatible Chat Completions 做后处理、动态 prompt 组装、远程术语表缓存刷新与连接校验。
- `text-injector.ts` - 基于 `@nut-tree-fork/nut-js` 的文本注入，优先保证多行文本的换行保真。
- `updater-manager.ts` - GitHub Releases 更新检查。
- `audio/` - 录音会话与分段转写流水线，包含基于实时音频电平的无语音跳过逻辑，避免静音 PTT 会话注入占位文本。
- `hotkey/` - 快捷键解析与 PTT 行为绑定。
- `tray/` - 托盘菜单与本地化刷新。
- `window/` - 后台窗口、设置窗口与 HUD 管理。
- `notification/` - 系统通知封装。
- `ipc/` - IPC 处理器模块。
