# LX-M 纯源码插件 ZIP 规范（版本 1）

插件包是标准 ZIP，包含原始 JavaScript、TypeScript、Vue 单文件组件及资源。软件在用户确认导入后，通过内置编译器在独立进程中构建，验证产物后切换安装；用户无需安装 Node.js、npm 或构建工具。依赖代码随包附带，因此可以离线导入。运行时不执行包内的 npm scripts、Webpack 配置或 Vite 配置。

## 目录

```text
my-plugin-1.0.0.zip
├── plugin.json           # 格式、插件信息、入口和全部文件的 SHA-256
├── src/                  # 插件源码及原始资源
│   ├── index.ts          # 默认导出插件模块
│   ├── Settings.vue
│   └── ...
├── sdk/                  # 可选：随插件提供的宿主组件源码
├── vendor/               # 可选：锁定版本的第三方依赖代码和许可证
│   ├── main/             # 主界面及桌面歌词依赖
│   └── engine/           # 独立浏览器引擎依赖
├── LICENSE
├── DEVELOPMENT.md        # 独立开发和重新打包说明
├── types/lx-m-plugin.d.ts # 插件 API 类型
├── package.json          # 可选的编辑器开发依赖
├── tsconfig.json
└── README.md
```

`plugin.json` 位于 ZIP 根目录，也允许整个包外面再包一层目录。多层或多个插件混装的 ZIP 不支持。源码包不提供预编译的 `renderer.js`、`lyric.js` 或引擎产物；第三方依赖使用其锁定版本的发行代码，保留许可证。

## 清单

```json
{
  "format": "lx-m-plugin-source",
  "formatVersion": 1,
  "id": "my-plugin",
  "version": "1.0.0",
  "apiVersion": 3,
  "name": { "zh-cn": "我的插件", "en-us": "My Plugin" },
  "description": "插件介绍",
  "icon": "#icon-tune-variant",
  "entry": "src/index.ts",
  "files": []
}
```

`files` 由打包工具生成，必须覆盖除 `plugin.json` 自身以外的全部文件。每项包含 `path`、`bytes` 和 `sha256`。修改源码后必须重新打包，以更新清单。

| 字段 | 规则 |
| --- | --- |
| `id` | 小写字母开头，可含小写字母、数字和连字符，最多 64 字符；禁止系统保留名 |
| `version` | 三段数字版本，例如 `1.2.0` |
| `apiVersion` | 当前宿主支持 1、2、3；新接口需由宿主提供 |
| `entry` | `src/` 内的 `.js`、`.ts`、`.jsx`、`.tsx`、`.mjs` 或 `.cjs` 入口 |
| `lyricEntry` | 可选，桌面歌词源码入口，与主入口规则相同 |
| `name`、`description` | 普通文本或语言 ID 到文本的映射 |
| `assets` | 可选数组：`{ "from": "src/filters", "to": "filters" }`，复制静态资源到运行目录 |
| `browser` | 可选，独立浏览器引擎，见下文 |

Vue、播放器、设置和歌词接口由宿主提供，见 [插件接口说明](README.md#新增插件)。第三方包按 npm 的目录结构放在 `vendor/main/`；依赖的嵌套 `node_modules` 结构须保留。编译器不联网安装依赖，缺失依赖会报错。

编译器桥接 `vue`、`@common/utils/vueTools`、`@renderer/plugins/player`、`@renderer/store/setting`、`@renderer/store/player/state`、`@renderer/store/player/lyric`、`@renderer/store/player/playProgress`、`@renderer/utils/ipc`、`@renderer/plugins/Dialog`、`@renderer/utils/downloadFiles`、`@renderer/core/lyric`、`@lyric/store/state` 和 `@lyric/core/mainWindowChannel` 到宿主实例。其余别名导入需要对应的 sdk 源码；新插件优先使用文档中的通用 PluginModule 接口。

## 构建行为

- 支持 TypeScript、JSX、Vue 单文件组件、Pug、CSS、Less，以及图片、字体和音频资源。
- Vue 和播放器接口使用宿主实例；插件 SDK 辅助源码放在 `sdk/common`、`sdk/renderer` 等目录，保持原有别名和相对路径。
- 主界面和桌面歌词生成独立入口。插件的 `activate`、设置组件、下载菜单和卸载清理规则保持一致。
- 编译完成后检查全部运行文件，再原子切换安装。语法错误、依赖缺失、编译超时或写入失败保留旧安装及个人设置。
- 下载 ZIP 在内存中校验和解压，安装后不保留压缩包；无论成功或失败都清理编译临时目录。`.source/` 保留解压后的源码与依赖，导出时校验并重新打包，不包含构建缓存或个人设置。用户选择导入的原始 ZIP 保持不变。商店同时支持预编译 `.lxplugin`，默认选择该格式；预编译安装无需源码或编译器，导出时仍为 `.lxplugin`。本规范描述源码 ZIP 通道，两种格式不能通过改名相互转换。

独立浏览器引擎采用声明式配置，例如 Folia：

```json
{
  "browser": {
    "entry": "src/engine/main.tsx",
    "output": "engine",
    "tailwind": true,
    "aliases": { "@": "src/engine/vendor/src" },
    "replacements": [
      { "from": "src/engine/vendor/src/components/Shell", "to": "src/engine/adapters/Shell.tsx" }
    ]
  }
}
```

依赖放在 `vendor/engine/`，样式从入口源码导入。编译器生成 `engine/index.html`，包含 `#root`、`engine.js` 和 `engine.css`；通过 `context.assetUrl('engine/index.html')` 取得地址。

## 打包

仓库内四个官方插件各有一个 `src/optional-plugins/<id>/plugin.json`。它提供源码入口和版本，`store.json` 提供显示信息；打包时自动收集插件源码、所需 SDK、依赖及许可证：

```sh
npm run build:plugins -- audio-tag-editor
```

构建同时输出 `plugins/store/<id>/<version>/<sha256>.zip` 和 `.lxplugin`。`catalog.json` 仍是 UTF-8 文字列表，使用 `schemaVersion: 2`；插件条目的 `path`、`bytes`、`sha256` 保留 ZIP 地址、大小和哈希，`packages.lxplugin` 提供预编译包的对应信息。新版默认安装 `.lxplugin`，可在卡片中选择 ZIP；只有 ZIP 的条目仍可安装。预编译包由该源码 ZIP 编译生成，ZIP 安装与本地导入使用同一编译流程。仓库 `plugins/official/` 下的旧包和旧目录文件继续保留。

从 [最小模板](template) 开始，或修改已解压的源码包后，在仓库执行：

```sh
node build-config/plugins/pack-source.cjs ./plugins/template ./my-plugin.zip
```

输出 ZIP 应保存在源码目录之外。此命令只生成源码包及校验清单，不生成插件运行文件。

## 边界

ZIP 最大 64 MiB，解压后的文件总量最大 256 MiB，最多 16,000 项；编译产物沿用 40 MiB、100 个文件的限制。拒绝路径穿越、符号链接、大小写重名、文件与目录冲突、加密 ZIP、错误 CRC 和不匹配的 SHA-256。编译最长 180 秒。

源码包编译成功后仍是可以访问本机文件的插件，校验和用于检查完整性，不代表作者可信。只导入可信来源的包。
