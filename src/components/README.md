# components/

React 组件目录，包含应用级组件与 `ui/` 组件库。

## 子目录

### `ui/`

基于 shadcn/ui 与 Radix UI 的基础组件集合。

## 文件

### `AudioRecorder.tsx`

后台无头录音组件，负责：

- 监听主进程的录音开始/停止事件。
- 在单次会话内保持同一条 `MediaStream` 与 `AudioContext`。
- 标准模式下每 29 秒轮转一次 `MediaRecorder` 并发送独立音频 `chunk`。
- 流式模式下按约 200ms 连续发送音频片段，释放热键时发送最终结束包。
- 在 3 分钟上限时自动请求停止会话。
- 向主进程同步音量电平与录音错误。

### `HUD.tsx`

录音状态浮窗组件，显示录音、识别/润色两步处理、成功与错误状态。

### `HotkeyRecorder.tsx`

快捷键录制组件，用于设置页录制和校验快捷键。

### `Waveform.tsx`

根据实时音频电平渲染波形动画。

### `LogViewerDialog.tsx`

日志查看对话框，负责展示主进程日志尾部内容。

### `InteractiveCharts.tsx`

首页趋势图组件，聚合历史记录并绘制字符识别趋势。
