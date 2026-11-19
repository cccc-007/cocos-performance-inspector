# 资源 / Prefab 体检

面向 **Cocos Creator 3.8.x** 的独立编辑器扩展。集中检查资源引用、Prefab / 场景的丢失引用和脚本，并在清理资源前查看静态影响范围。

## 安装

1. 解压 `release/cocos-resource-inspector.zip`。
2. 将其中的 `cocos-resource-inspector` 文件夹放到项目的 `extensions/` 下。也可以直接复制 `dist/cocos-resource-inspector`。
3. 在 Creator 的扩展管理器中刷新并启用插件，必要时重新打开项目。
4. 从菜单 **扩展 → 资源 / Prefab 体检** 打开面板，点击 **扫描项目**。

无需向 `assets` 添加脚本、挂载组件或配置服务器，也无需在安装后的插件目录运行 npm。

```text
项目/
  assets/
  extensions/
    cocos-resource-inspector/
      package.json
      main.js
      lib/
      panels/
      static/
      RIReports/       ← 导出报告时自动创建
```

## 功能

- **项目体检**：检查 Prefab / 场景等序列化资源中的丢失 UUID 引用、失效脚本 UUID、越界对象引用、JSON / meta 文件异常和重复 UUID。记录资源、节点路径、组件及属性位置。
- **引用定位**：搜索名称、路径或 UUID，查看“谁引用了它”和“它引用了谁”。支持压缩 UUID 与图片等资源的子资源 UUID。
- **删除影响预览**：展示直接引用者和间接影响资源；选择主资源时同时考虑其子资源。插件提供预览，不执行删除或自动修改。
- **资源定位**：在 Creator 资源管理器中选中资源。节点定位需要先打开对应场景或 Prefab；同名路径无法唯一确认时会提示手动确认。
- **HTML / JSON 报告**：导出到插件自己的 `RIReports/`。HTML 可离线浏览，JSON 保留本次扫描结果。
- **后台扫描**：使用独立工作线程，支持进度及取消；面板分页读取结果。资源发生变化时提示重新扫描。

## 推荐工作流

先保存场景和 Prefab，等待 Creator 导入资源结束，然后扫描。

在“体检问题”中先看错误，点击定位资源；打开对应资源后，按报告中的节点和属性检查引用。在左侧选择资源，切换“引用定位”查看上下游关系；准备清理资源时查看“删除影响”，再结合业务代码确认。

修改、移动或重新导入资源后重新扫描。扫描期间发生资源变化时，结果会标记需要更新。插件只读取已保存到磁盘的内容，不包含尚未保存的场景改动。

## 覆盖范围与限制

本插件分析磁盘上的 `assets/`、`.meta` 和可识别的序列化资源，同时利用编辑器资源数据库识别内置资源及子资源。

- **没有查到引用不等于可安全删除**。代码中的动态加载、拼接路径、配置表间接引用、远程资源、自定义导入器依赖不一定能通过静态扫描识别。
- UUID 对应的脚本文件存在，也不代表脚本一定能编译、注册或执行。非 UUID 的自定义类名不用于判断脚本丢失，需要通过 Creator 的编译及运行检查确认。
- 空属性可能是可选配置，插件不会把所有 `null` 都判为丢失引用。
- 资源数据库不可用时退回磁盘扫描，并在结果中提示覆盖限制。
- 脚本的 `import` 关系、二进制模型 / Spine 导入器从路径推导的依赖、未保存的改动及运行时对象不在完整扫描保证范围内。此版本不提供包体分析或自动修复。
- 扫描设置文件大小、引用数量和问题数量上限，达到上限会在结果中明确提示；HTML 每类最多展示 10,000 条，JSON 保留本次扫描已记录的全部结果。

## 开发

开发和自动化测试使用 Node.js 18 或更高版本，无需安装第三方运行时依赖。安装后的插件使用 Creator 内置的 Node.js，兼容 Creator 3.8.3 的 Node.js 14.16。

```sh
npm test
npm run build
npm run package
npm run check:editor -- "D:\creator\Creator\3.8.3\CocosCreator.exe"
```

`build` 校验 JavaScript 语法并生成可安装目录 `dist/cocos-resource-inspector`；`package` 生成带正确顶层目录的 ZIP。

`check:editor` 在构建后使用指定 Creator 的内置 Node.js 校验安装包模块加载、工作线程扫描、引用查询及 HTML / JSON 导出，不打开编辑器窗口。

也可进行独立磁盘扫描：

```sh
npm run scan -- "D:\MyCocosProject" html
```

命令行模式没有 Creator 的资源数据库信息，会提示相应限制。报告仍保存在当前插件源码目录的 `RIReports/`。

扩展接入方式参考 [Cocos Creator 扩展接口](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/contributions.html) 和 [场景脚本](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/scene-script.html)。
