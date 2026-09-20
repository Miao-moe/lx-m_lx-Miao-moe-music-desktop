# 编辑和打包这个插件

这个目录是可独立编辑的 LX-M 源码插件项目。使用 LX-M 插件开发工具包 1.0.0 或兼容版本即可重新打包，不需要主程序仓库。

1. 安装 Node.js 22 或更新版本，解压工具包。
2. 修改本项目的 `src/`，按需更新 `plugin.json` 中的名称、版本和资源声明。
3. 将本项目文件夹拖到工具包的 `pack.cmd`，或执行：

```text
node <工具包目录>/lx-plugin.cjs check <本项目目录>
node <工具包目录>/lx-plugin.cjs pack <本项目目录> <项目目录外的输出.zip>
```

4. 在支持源码插件的 LX-M 中打开「设置 → 插件商店 → 导入插件」，选择生成的 ZIP。主程序会离线编译并加载，安装使用者无需安装 Node.js。

目录约定：

- `plugin.json`：标识、版本、API、入口和资源声明；`files` 校验清单由工具自动更新。
- `src/`：插件源码、样式、资源和许可证。
- `types/lx-m-plugin.d.ts`：插件接口提示，使用 `import type` 引用。
- `sdk/`：可选；官方插件使用的宿主辅助源码，重新打包时保留。
- `vendor/main/`、`vendor/engine/`：可选；随包附带的第三方依赖，重新打包时保留，包括嵌套依赖、产物和许可证。
- `package.json`、`tsconfig.json`：开发时的编辑器配置。打包示例和现有四个插件无需运行 npm install。

增加 npm 依赖时，请阅读工具包 README 的「第三方依赖」部分。工具不自动安装或下载依赖，也不执行插件或 npm 脚本。

不要直接用压缩软件重新压缩修改后的目录：校验清单会过期。`check` 检查包的结构与完整性，实际编译、界面和功能仍需在 LX-M 中验证。API 能力和限制见工具包 `API.md`。

打包会排除本地 node_modules、构建输出、编辑器目录、日志，以及 .env、.npmrc、.yarnrc、.yarnrc.yml、.netrc 和 _netrc 等凭据配置；vendor 中的同名配置也会排除。发布前仍应检查自己加入的源码和资源。保留原插件和第三方依赖的 LICENSE、NOTICE 及署名。
