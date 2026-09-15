# 官方插件

在软件的 **设置 → 插件商店** 中安装、更新或卸载插件。当前提供四个可独立安装的插件：

- **音效增强**：十段均衡器、环境混响、环绕音效、变调，以及原有的个人音效预设。
- **音频可视化 1.2.0**：提供经典频谱、柔波曲线、audioMotion 环形频谱三种样式，播放详情页和桌面歌词可分别选择、开关。
- **Folia 歌词动效 1.2.0**：将 Folia 的 13 种原版歌词渲染器接入播放详情页，动效铺满页面，控制栏随鼠标靠近显示，支持逐字动效、样式预览和独立开关。
- **音频标签编辑 1.0.0**：选择已完成的下载或本地 MP3、FLAC 文件，修改标题、艺术家、专辑、年份、流派、备注等标签，保留音频、封面与歌词。

插件安装后立即生效，卸载后对应按钮、设置和功能退出运行，并删除插件文件。歌曲继续播放，其他插件可继续使用。原有音效参数、个人预设和插件开关保留，重新安装后恢复使用。升级到插件商店版本时，需要在商店中安装所需插件。

点击播放详情页的音频可视化按钮，会打开样式选择窗口。窗口内可预览并选择样式，选择后自动启用；没有播放音乐时显示演示预览，播放时使用当前音乐的频谱。可视化开关位于窗口右上方，也可在商店的「插件设置」中调整。支持方向键选择、Esc 关闭及键盘焦点返回。

已有 1.0.0 插件的用户，在商店刷新后点击「更新」即可升级，无需重新安装主程序。样式选择保存在 `LxDatas/plugins/preferences/audio-visualizer.json`，更新、卸载及重启都会保留；桌面歌词即时同步自己的样式选择。

1.2.0 移除律动音柱、镜像光谱、旧环形脉冲和星点跃动。旧环形脉冲的选择自动迁移到 audioMotion，其余已移除的样式回到经典频谱。新圆环位于播放详情的歌词区域内，避开封面和播放按钮；桌面歌词使用适合其窗口大小的圆环，保持背景透明。三种样式的预览与实际绘制共用实现。

环形频谱使用 [audioMotion-analyzer 4.5.4](https://github.com/hvianna/audioMotion-analyzer) 和 8192 点 FFT，依赖随插件打包，离线可用。插件包附带 AGPL-3.0-or-later 许可与来源说明，见 [NOTICE.md](../src/optional-plugins/audio-visualizer/NOTICE.md)。`build-config/plugins/audiomotion-loader.js` 为固定上游版本增加单帧绘制入口，并补全卸载时的监听器及延迟任务清理。播放分析仍在主窗口完成，通过原有字节数组通道将采样率与频谱同步到桌面歌词，宿主接口版本保持为 1。

## Folia 歌词动效

1.2.0 增加控制栏自动收起：鼠标靠近页面顶部时显示窗口按钮和样式选择，靠近底部时显示播放条与操作按钮，离开约半秒后淡出。拖动进度条、打开音量或倍速面板、展开播放列表以及键盘焦点所在的控件会保持显示。中间的歌词区域仍可交互，触屏设备和设置预览保持控制栏可见。

1.1.0 将播放详情页改为沉浸式布局：移除动效面板的外边距、圆角和最大宽度限制，整个渲染画面延伸到窗口边缘，窗口按钮、样式选择与播放控制叠放在画面上，并使用适合深色背景的配色。底部字幕根据播放栏的实际高度自动上移，缩放、最大化和全屏时随页面铺开。插件设置中的预览仍保留独立面板；切回标准歌词、打开评论或选词时自动恢复原页面。已有 Folia 的用户可通过商店更新插件，无需重新安装主程序。

安装后默认启用「流光」。在插件设置中可无声预览全部样式，在播放详情页顶部可直接切换样式；详情页底部的 **F** 按钮以及插件设置中的开关可启用或停用 Folia。选择保存在 `LxDatas/plugins/preferences/folia-lyrics.json`，重启、更新和卸载都会保留。

| 样式 | 样式 | 样式 |
| --- | --- | --- |
| 流光 Luminous | 浮名 Fume | 云阶 Partita |
| 倾诉 Tilt | 心象 Mindscape | 群唱 Cappella |
| 回环 Claddagh | 镜台 Diorama | 莫奈 Monet |
| 时计 Pendolo | 商籁 Sonnet | 凝彩 Tempera |
| 静止 Still | | |

动效沿用当前歌曲、封面及软件解析后的歌词。歌曲有逐字时间轴时使用逐字动效，普通 LRC 按整行时间显示；暂停、跳转、倍速和歌词偏移跟随播放器。Folia 接管播放详情页的歌词区域，评论、播放控制和标准歌词仍可使用；桌面歌词保持原有显示。镜台、商籁、凝彩需要 WebGL，无可用上下文时会提示切换样式。插件也会遵循软件的减少动态效果设置。

来源为 [Folia 0.7.4](https://github.com/chthollyphile/folia-major)。原始渲染器、素材和注释保存在 `src/optional-plugins/folia-lyrics/engine/vendor`，`upstream.json` 记录来源文件的 SHA-256。插件只适配外围布局、播放时钟和数据接口，未接入 Folia 的账号、AI 服务或自定义背景图库。React、Motion、PixiJS、Three.js 等依赖随插件打包。插件包内包含 AGPL-3.0 许可、依赖许可、来源说明和完整插件源码压缩包，见 [NOTICE.md](../src/optional-plugins/folia-lyrics/NOTICE.md)。

构建时还通过 `engine/adapters/pausedCamera.mjs` 为浮名补上暂停时的镜头定位，避免在暂停状态切换样式或跳转时，当前歌词留在画面之外。该适配保留原始文件和注释，匹配位置变化时会中止构建以便检查。

## 音频标签编辑

在商店安装后，打开「音频标签编辑」设置页，或点击插件卡片上的「插件设置」。左侧可搜索并选择已完成的 MP3、FLAC 下载，也可通过「选择音频文件」打开本地文件。编辑完成后点击「保存标签」，或按 `Ctrl / Command + S`；修改会写入音频文件，可在系统文件属性及其他播放器中查看。

支持标题、副标题、艺术家、专辑艺术家、专辑、年份／日期、曲目序号、光盘序号、流派、作曲者、发行者、编码人员、版权和备注。清空输入框并保存即可移除对应文本。文件名保持原样；「还原修改」恢复本次打开或上次保存时的标签。切换文件时会提示处理未保存的修改，切换设置页面会保留当前编辑草稿。

保存只替换修改过的标签，保留 MP3 的其他原始帧、FLAC 的其他元数据块以及音频数据。先写入同目录临时文件并校验，再替换原文件；文件被其他程序修改、缺失或无法替换时显示错误。支持软件生成的普通 ID3v2.3、ID3v2.4 MP3 和原生 FLAC；旧版、带扩展头或整体非同步编码的 ID3 标签暂不支持编辑，读取时会明确提示。

此插件使用现有宿主接口 2 和下载列表、文件选择接口，无需升级主程序。依赖随插件打包，安装后可离线编辑。构建命令为 `npm run build:plugins -- audio-tag-editor`，文件读写测试为 `node --test tests/audio-tag-editor.test.cjs`，界面测试为 `node --test tests/audio-tag-editor.electron.test.cjs`。

## 下载来源和存储

商店从本仓库 `master` 分支的 [官方目录](https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/official/catalog-v2.json) 获取版本和包地址。首次安装及更新需要连接 GitHub；启动时只校验并加载本地已安装插件，离线时可继续使用。刷新目录失败会显示提示，下载或校验失败保留原有安装。

安装文件位于用户数据目录的 `LxDatas/plugins` 下，`installed.json` 记录已安装版本，`catalog-cache.json` 保存最近一次有效目录。离线重启后仍显示缓存的插件名称与介绍；从目录移除的已安装插件仍可使用和卸载。音效和可视化的实现、样式、混响资源及变调处理器均由插件包提供，应用安装包只保留商店、加载接口和基础播放功能。

本体根据官方目录动态发现插件，无需在本体代码中登记新 ID、名称或介绍。安装仅接受当前官方目录中的插件，继续校验下载来源、路径和文件哈希。插件代码在应用渲染进程中运行，使用应用提供的 Vue、播放器和设置接口；此接口供仓库内的官方插件使用，不是第三方插件沙箱。Folia 的 React 渲染器运行在独立 iframe 内，关闭 Node 集成，通过消息接收歌词、播放时钟和频谱。

使用固定插件名单的旧主程序需要升级一次，才能获得动态商店。此后使用现有接口的新插件和插件更新，都可通过「刷新商店」直接发现、安装和即时加载。只有插件需要本体尚未提供的接口时，才会提示升级主程序；不兼容的新包不会替换仍可运行的本地版本，较旧的目录版本也不会显示为更新。

Folia 使用宿主接口 2，新宿主同时兼容接口 1 的音效和可视化插件。旧版主程序继续读取 `catalog.json`，该目录仅保留原有两个插件，避免未知 ID 导致旧商店无法加载；动态宿主固定读取 `catalog-v2.json`。

## 新增插件

在 `src/optional-plugins/<id>` 中添加 `manifest.json`、`index.ts` 和 `store.json` 即可。构建脚本会自动发现含有清单的目录。ID 使用小写字母开头的小写字母、数字和连字符组合，最多 64 个字符，不能使用系统保留名称。

`manifest.json` 声明 `id`、`version`、`apiVersion`、`entry: "renderer.js"` 和 `styles`；有桌面歌词代码时增加 `lyricEntry: "lyric.js"` 及对应的 `lyric.ts`。版本使用三段数字，例如 `1.2.0`。

`store.json` 的显示信息同时写入目录和新插件包，示例：

```json
{
  "name": { "zh-cn": "新歌词插件", "en-us": "New lyrics" },
  "description": { "zh-cn": "插件的功能说明", "en-us": "What this plugin does" },
  "icon": "#icon-lyric"
}
```

名称和介绍也可直接写成字符串；缺少当前语言时依次尝试语言前缀、英文、简体中文和首个翻译。未提供名称时显示插件 ID，未提供图标时使用默认图标。文本按普通文字显示。

`index.ts` 默认导出插件模块，可使用以下入口注册界面，不需要给本体添加专用组件：

| 入口 | 用途 |
| --- | --- |
| `components.Settings` | 商店中的插件设置面板 |
| `slots.playDetailControls` | 播放详情页控制栏的按钮或控件 |
| `playDetail: { component, enabled }` | 可由 Vue ref 开关的完整歌词显示区域 |
| `slots.desktopLyricOverlay` | 在 `lyric.ts` 导出模块中注册桌面歌词叠加内容 |
| `activate(context)` | 初始化功能，返回停止监听、释放资源的清理函数 |

初始化上下文提供 `id`、插件 `version`、宿主 `apiVersion`、`assetUrl(name)` 和 `readAsset(name)`。主窗口仍通过 `window.__lxPluginHost` 提供共享 Vue、播放器、歌曲信息、歌词时钟和设置接口；桌面歌词窗口提供共享 Vue、歌词状态与主窗口频谱通道。使用上述动态界面入口的插件声明 `apiVersion: 2`。

运行 `npm run build:plugins -- <id>` 后，将源码、`catalog-v2.json` 和新的 `.lxplugin` 包发布到官方仓库。兼容插件的发布过程不需要重新构建主程序。

## 构建和发布

在仓库根目录执行：

```sh
npm ci --prefix src/optional-plugins/folia-lyrics/engine
npm run build:plugins
```

只更新可视化插件时，可以保留其他插件的目录记录和包：

```sh
npm run build:plugins -- audio-visualizer
```

只构建 Folia 时使用 `npm run build:plugins -- folia-lyrics`。仓库已包含所需 Folia 源码，无需额外下载原项目；更新来源时可运行 `node build-config/plugins/import-folia.cjs /path/to/folia-major`，并检查生成的文件及哈希清单。

源代码在 `src/optional-plugins/<id>`。每个插件的 `manifest.json` 声明版本、接口版本和入口，`store.json` 提供可随插件发布的多语言显示信息。构建产物先写入 `build/optional-plugins`，随后生成：

```text
plugins/official/catalog.json
plugins/official/catalog-v2.json
plugins/official/<id>/<version>/<sha256>.lxplugin
```

`.lxplugin` 是 gzip 压缩的 JSON，包含清单和 Base64 编码的文件。目录声明整包大小及 SHA-256，清单声明每个文件的大小及 SHA-256。安装时先验证完整下载和全部文件，再切换安装记录；启动时重新检查本地文件。损坏的安装可在商店中重新安装修复。

修改插件后递增其版本并重新构建，将源码、目录和生成的插件包一起提交到 `dev` 并同步 `master`，商店即可发现新版本。发布后保留旧的哈希文件，避免正在使用旧目录的客户端下载失败。修改宿主接口时，同时维护 `src/common/optionalPlugins.ts` 的 `PLUGIN_API_VERSION` 和插件清单的 `apiVersion`；不兼容的包会阻止安装并提示更新软件。

应用本身仍按原有流程构建。`build:plugins` 不构建 Windows 安装包，也不会清理已有版本的安装包。

## 验证

先生成插件包，再执行安装管理测试：

```sh
node --test tests/optional-plugins.test.cjs
node --test tests/folia-lyrics.test.cjs
```

构建主进程、主界面和桌面歌词后，可执行真实 Electron 集成测试：

```sh
npm run build:main
npm run build:renderer
npm run build:renderer-lyric
node --test tests/plugin-store.electron.test.cjs
node --test tests/audio-visualizer.electron.test.cjs
node --test tests/folia-lyrics.electron.test.cjs
node --test tests/dynamic-plugin-store.electron.test.cjs
```

集成测试使用隔离的临时用户目录，拦截 GitHub 请求并提供实际构建的插件包，验证独立安装、播放中的卸载、重复安装、频谱绘制、离线重启和不同窗口尺寸下的布局。测试音频在输出前静音。

可视化测试还验证从 1.1.1 更新到当前版本、旧样式迁移、三种样式预览与绘制、主界面和桌面歌词分别保存及同步、键盘操作和关闭预览后释放分析器。

Folia 测试逐个检查 13 种样式，使用软件 WebGL 渲染验证三种画布样式，并检查播放时钟、暂停、歌词偏移、切歌、无歌词、开关和离线重启。截图保存在测试输出的临时目录中。

动态商店测试生成本体从未见过的随机插件 ID，在同一个应用进程中发现、安装和更新插件，验证通用播放控件、歌词区域和桌面歌词入口，随后检查离线重启、接口不兼容、目录回退以及下架后的卸载。
