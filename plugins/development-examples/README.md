# 四个统一后的源码插件

在仓库根目录安装依赖并运行 `npm run build:plugins` 后，这里会生成四个 ZIP 和 `index.json`，生成文件不提交到 Git。ZIP 与构建后的 `../store/catalog.json` 指向的源码包逐字节相同；`index.json` 记录版本、大小和 SHA-256。商店仍默认安装 .lxplugin，列表仍读取文字 catalog.json。

- `sound-effects-1.0.0.zip`：音效增强。
- `audio-visualizer-1.2.0.zip`：音频可视化，包含桌面歌词入口。
- `folia-lyrics-1.2.0.zip`：Folia 歌词动效，包含独立浏览器引擎。
- `audio-tag-editor-1.1.0.zip`：音频标签编辑，包含下载菜单入口。

四个插件共用 [开发工具包](../developer-kit/README.md) 的打包流程，统一带有 plugin.json 校验清单、DEVELOPMENT.md、接口类型及编辑器配置。源码、SDK 辅助源码、离线依赖、素材和原许可证均保留。

直接在 LX-M 的插件商店导入 ZIP 即可使用；开发者可以解包、编辑后再次打包：

```text
node ../developer-kit/lx-plugin.cjs unpack sound-effects-1.0.0.zip ../../my-effects
node ../developer-kit/lx-plugin.cjs pack ../../my-effects ../../my-effects.zip
```

分发自己的改版时设置自己的插件 ID、名称和版本，保留对应许可证与署名。
