# LX-M 插件商店（LXPlugin / 源码 ZIP）

新版软件直接读取本目录的 [catalog.json](catalog.json) 文本获取插件列表、名称、介绍、版本和下载位置。

音效增强和音频标签编辑已由新版软件自带，商店显示「自带」，不再提供安装、更新、卸载、导出或设置按钮。音效增强从歌曲详情页播放条上方、桌面歌词按钮右侧打开；标签编辑从下载列表右键打开。其旧包及目录条目继续保留供旧主程序使用，新版优先使用随软件发布的实现与介绍，离线也能显示这两项。

目录地址：<https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/store/catalog.json>

## 目录结构

```text
plugins/store/
├── catalog.json
└── <插件 ID>/<版本>/
    ├── <SHA-256>.lxplugin
    └── <SHA-256>.zip
```

`catalog.json` 仍使用 UTF-8 JSON 文字列表，`schemaVersion` 为 `2`。官方条目的 `path`、`bytes` 和 `sha256` 保留源码 ZIP 的信息，兼容源码客户端；`packages.lxplugin` 用相同三个字段声明默认安装的预编译包。路径均相对于本目录，`apiVersion` 表示所需宿主接口。读取列表只请求此文本，不扫描或下载插件包。

点击商店卡片的安装、更新或重新安装按钮，直接下载并校验 `.lxplugin` 后安装，无需选择格式或本机编译。卡片显示 `.lxplugin` 的下载大小。

「导入插件」支持 `.lxplugin` 和 `.zip`：LXPlugin 校验后直接安装，源码 ZIP 自动编译后安装。

ZIP 包包含 `plugin.json`、原始源码、资源及离线构建所需依赖和许可证。软件导入、校验并自动编译后安装，安装成功或失败都会清理临时文件。安装目录保留解压后的源码，便于离线导出和重新导入。用户手动导入的原始 ZIP 不会被删除。

## 发布更新

1. 修改插件源码和 `src/optional-plugins/<id>/plugin.json` 中的版本。
2. 执行 `npm run build:plugins -- <id>`，或 `npm run build:plugins` 更新所有插件。
3. 将本目录中新 `.lxplugin`、ZIP 和更新后的 `catalog.json` 一起提交到 `master`。已发布的哈希包保留，避免缓存目录的客户端无法下载。
4. 用户在软件中刷新商店即可获取更新。使用已有宿主接口的插件无需重新发布主程序。

旧版软件继续使用 `plugins/official/` 下的目录及 `.lxplugin`。本目录独立维护，不替换或删除旧版文件。
