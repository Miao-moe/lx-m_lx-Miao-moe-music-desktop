# 源码插件模板

修改 `plugin.json` 中的 ID、名称和版本，并编辑 `src/` 内的 Vue/TypeScript 源码。

在 LX-M 仓库根目录执行 `node build-config/plugins/pack-source.cjs plugins/template example-plugin.zip`，随后在软件的插件商店导入 ZIP。模板只使用宿主提供的 Vue，无需额外依赖。

完整规范见 [SOURCE-FORMAT.md](../SOURCE-FORMAT.md)。
