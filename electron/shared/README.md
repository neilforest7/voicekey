# shared/

主进程与渲染进程共享的类型、常量与多语言资源。

## 文件列表

- `types.ts` - 跨进程类型定义与 IPC 通道常量（含语言快照、ASR/LLM 润色配置、Overlay 状态、历史记录、更新信息、日志 payload、ASR 低音量模式字段）。
- `constants.ts` - GLM ASR 配置、GLM LLM 配置、默认快捷键、录音参数、低音量模式固定增益、历史与日志保留/大小限制。
- `i18n.ts` - 共享 i18n 资源与语言解析工具（resolveLanguage/getLocale）。
- `locales/en.json` - 英文文案资源。
- `locales/zh.json` - 中文文案资源。
