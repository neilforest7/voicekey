# refine/

文本润色模块，负责将 `llmRefine` 配置解析为统一的 OpenAI Chat Completions 请求；默认配置预置为智谱 OpenAI-compatible 接口，并执行润色与连接校验。

## 文件

- `index.ts` - 统一导出润色服务、OpenAI-compatible client 与配置解析工具。
- `service.ts` - `RefineService` 维护内存术语表缓存；每次调用都读取最新 `llmRefine` 配置，使用固定 transcript 包装、明确禁止回显 transcript 标记，并执行润色和连接校验。
- `glossary-cache.ts` - 以内置术语表初始化内存缓存，按需拉取远程纯文本术语表，做 UTF-8、空行/注释过滤、去重与失败回退。
- `config-resolver.ts` - 将润色 Base URL 归一化后补全为 `/chat/completions` 请求参数，并按润色配置与传入术语表生成最终 system prompt；默认配置可直接指向智谱兼容接口。
- `openai-client.ts` - OpenAI Chat Completions HTTP client，负责请求发送、错误与消息内容解析；提取响应时会强制清理 BEGIN_TRANSCRIPT/END_TRANSCRIPT 标记，避免它们泄漏到最终输出。
