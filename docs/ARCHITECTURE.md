# 架构与数据边界

```text
Creator 扩展启用
  src/main.ts → 本机接收服务 + 采集设置
       │
  preview.browser.settings → plugins/jsList 自动添加采集入口
       │
  server contribution → /plugins/cocos-performance-inspector/auto.js
       │                  /plugins/cocos-performance-inspector/config.json
       ↓
浏览器预览：System.import('cc') → 预编译 runtime/AutoPreview
       ├─ 动态取得连接配置、页面级去重、接管旧 Bootstrap
       ├─ PerformanceInspector → 帧 / 对象 / 资源的有界记录
       └─ 本机 HTTP 增量批次 + 临时 Token → InspectorServer 合并与分析
                                     │
                            面板按需读取 → 导出时组装报告
                                     │
                       项目/extensions/cocos-performance-inspector/PITemp
```

## 预览入口

扩展注册 Creator 3.8 的 `contributions.preview.browser` settings hook 与 server contribution。引擎在初始化自身后，以 `plugins/` 前缀加载 `settings.plugins.jsList`，随后加载项目脚本。因此注入项必须是相对插件路径，而非额外带 `plugins/` 前缀或绝对地址。

发布包内的 `dist/runtime/auto-preview.js` 已将浏览器兼容 TypeScript 编译成自包含脚本。仅将 `cc` 作为外部依赖，通过预览已有的 SystemJS 导入同一引擎。不会向 assets 复制脚本，也不生成场景挂点、常驻节点或预览模板；构建流程没有注入贡献点。

自动入口使用页面全局标识去重，不依赖单份模块的静态字段。切换场景保持同一采集器；重复注入复用同一控制器。针对旧版 Bootstrap，只在预览内临时接管其 onLoad，并清理它已拥有的会话，页面结束时恢复原方法。

## 连接生命周期

配置路由只接受本机预览请求，返回当前随机端口、临时 Token 与经过校验的采集参数；响应禁止缓存。连接信息不写入游戏文件，也不写入导出报告。

每五秒检查配置，变更后停止旧采集器并开始新会话。两次连续失败后停止采集，后续配置恢复则重连；页面 pagehide 时移除回调、计时器和自动入口。每个请求有超时，配置请求不会并发堆积。

采集器停止时只恢复仍归自己所有的方法，避免覆盖后续工具的包装。对象追踪使用弱引用；快照只保存可序列化描述，不保存业务对象实例。

## 增量数据链路

实时协议与离线报告格式独立。`POST /stream` 接收带 `streamId`、递增批次序号和当前会话元数据的增量包，每包上限 256 KiB。样本与资源事件使用绝对记录偏移，快照使用对象、资源的分块偏移及总数。浏览器只序列化当前批次，实时链路不调用全量 `getReport()`、整份报告分析或导出预算处理。

发送端保持单个在途批次，收到匹配确认后推进游标；失败重试原批次。接收端校验后按序提交，同一批次重试不会重复追加数据。快照分块完整且校验通过后才进入可见列表。接收端会话失效时请求重同步，发送端使用新的流标识重新发送当前有界历史。

编辑器按会话保留有界的样本、事件与快照，分析结果按数据版本缓存。面板携带版本与采样偏移查询，未变化的数据不重发，趋势最多显示 240 个点；对象页按需读取当前对比的快照，资源页查询新增事件。切换会话或关闭面板时清理相应明细缓存。

导出时，编辑器将已接收的各类记录组装为离线报告，并在 `src/core/reportBudget.ts` 应用 8 MiB UTF-8 预算。离线 `getReport()` 仍可按明确调用生成报告；旧客户端的 `POST /report` 保留兼容入口。

## 文件与信任边界

`src/editor/storage.ts` 是报告导出和采集设置的统一文件出口。从 `Editor.Project.path` 解析 `extensions/cocos-performance-inspector/PITemp`，不使用进程 cwd 或浏览器提供的路径。报告文件采用唯一命名，HTML 完整转义项目内容。导入 JSON 重新验证结构、数组容量、时间与数值并重算诊断，不执行输入内容。

PITemp 位于插件目录内，删除或替换插件目录前需备份报告与采集设置。

接收服务监听 `127.0.0.1`、校验临时 Token、限制报告大小与会话数量。自动接入范围为本机浏览器预览；没有原生或远程自动连接能力。

## 分析边界

采样缓冲区、对象记录、快照与资源事件都有上限，报告包含截断计数。JS 堆取自可用的 Chromium heap 估计；GPU 数值为引擎设备统计，不是操作系统进程内存。对象数量、资源引用和保留线索均不是 GC 可达性证明，需结合业务生命周期与浏览器堆保留路径确认。
