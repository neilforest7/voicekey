# shared/

主进程与渲染进程共享的类型、常量与多语言资源。

## 文件列表

- `types.ts` - 跨进程类型定义与 IPC 通道常量；包含语言快照、配置、Overlay、历史、日志、`RecordingStartPayload` 与 `AudioChunkPayload`。
- `constants.ts` - GLM ASR / 文本润色默认值、静态术语表驱动的 refine system prompt、中英混排空格规则、29 秒单请求限制、3 分钟会话限制、默认快捷键、录音参数与日志限制。
- `i18n.ts` - 共享 i18n 资源与语言解析工具。
- `locales/en.json` - 英文文案资源。
- `locales/zh.json` - 中文文案资源。
