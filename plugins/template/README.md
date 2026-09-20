# 源码插件模板

修改 `plugin.json` 中的 ID、名称和版本，并编辑 `src/` 内的 Vue/TypeScript 源码。

使用独立工具包执行 `node <工具包目录>/lx-plugin.cjs pack <此目录> <输出.zip>`，随后在软件的插件商店导入 ZIP。也可以将插件目录拖到工具包的 `pack.cmd`。输出应位于源码目录之外。模板只使用宿主提供的 Vue，无需额外依赖或主程序仓库。

开发者需要 Node.js 22 或更新版本，安装使用者不需要 Node.js。完整说明见工具包 README.md、API.md 和 SOURCE-FORMAT.md。
