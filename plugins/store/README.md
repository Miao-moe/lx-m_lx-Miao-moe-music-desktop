# LX-M 插件商店（源码 ZIP）

新版软件直接读取本目录的 [catalog.json](catalog.json) 文本获取插件列表、名称、介绍、版本和下载位置。

目录地址：<https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/store/catalog.json>

## 目录结构

```text
plugins/store/
├── catalog.json
└── <插件 ID>/<版本>/<SHA-256>.zip
```

`catalog.json` 使用 UTF-8 JSON，`schemaVersion` 为 `2`。每个插件条目的 `path` 是相对于本目录的 ZIP 路径，`bytes` 和 `sha256` 用于验证下载完整性；`apiVersion` 表示所需宿主接口。

ZIP 包包含 `plugin.json`、原始源码、资源及离线构建所需依赖和许可证。软件下载、校验并自动编译后安装；不保留下载的压缩包，安装成功或失败都会清理临时文件。安装目录保留解压后的源码，便于离线导出和重新导入。用户手动导入的原始 ZIP 不会被删除。

## 发布更新

1. 修改插件源码和 `src/optional-plugins/<id>/plugin.json` 中的版本。
2. 执行 `npm run build:plugins -- <id>`，或 `npm run build:plugins` 更新所有插件。
3. 将本目录中新 ZIP 和更新后的 `catalog.json` 一起提交到 `master`。已发布的哈希 ZIP 保留，避免缓存目录的客户端无法下载。
4. 用户在软件中刷新商店即可获取更新。使用已有宿主接口的插件无需重新发布主程序。

旧版软件继续使用 `plugins/official/` 下的目录及 `.lxplugin`。本目录独立维护，不替换或删除旧版文件。
