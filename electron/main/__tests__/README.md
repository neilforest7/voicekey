# **tests**/

主进程模块测试。

- `config-manager.test.ts` - 配置管理器单元测试。
- `asr-provider.test.ts` - ASR Provider 请求与错误映射测试。
- `refine/__tests__/service.test.ts` - 文本润色服务的手动配置解析、endpoint 规范化、列表逐行 prompt 规则、错误映射与连接测试。
- `text-injector.test.ts` - 文本注入、macOS 多行粘贴保留换行、Windows 粘贴路径与权限检查测试。
- `iohook-manager.test.ts` - 按键状态判定与修饰键精确匹配测试。
- `history-manager.test.ts` - 历史记录增删清理与保留天数裁剪测试。
- `updater-manager.test.ts` - 更新检查、版本比较与 release URL 清洗测试。
- `hotkey-manager.test.ts` - 全局快捷键注册/注销与重复注册防护测试。
- `logger.test.ts` - 日志初始化、写入分流与尾部读取测试。
- `main.test.ts` - 应用启动流程、事件监听与退出清理测试。
- `env.test.ts` - 环境变量初始化与路径 getter 测试。
- `i18n.test.ts` - 主进程 i18n 初始化、同步与广播测试。
