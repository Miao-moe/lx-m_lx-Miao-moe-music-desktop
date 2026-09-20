# Windows 7 兼容版

兼容版固定 Electron **22.3.27**，内含 Node **16.17.1**、Chromium **108.0.5359.215**。普通版继续使用原来的 Electron 版本，两套依赖互不覆盖，功能共用同一份源码。

Electron 22 是官方支持 Windows 7/8/8.1 的最后一个大版本，现已停止维护。此兼容版固定旧内核，目标环境为 Windows 7 SP1；不能获得普通版新内核的更新。

## 构建与产物

在 Windows 10/11 上使用 Node 22 或更新版本、npm 和项目现有构建环境；用户运行安装包不需要安装 Node。不要在 Win7 上执行开发依赖安装。

```powershell
npm ci
npm run build:win7
npm run test:win7
npm run pack:win7:setup:x64
npm run pack:win7:7z:x64
npm run pack:win7:setup:x86
npm run pack:win7:7z:x86
```

- `build/win7/workspace/`：自动生成的隔离工作区，不能作为日常源码编辑目录。
- `build/win7/artifacts/`：安装版 `win7_x64-Setup.exe` / `win7_x86-Setup.exe`，绿色版 `win7_x64-green.7z` / `win7_x86-green.7z`。
- `npm run pack:win7`：重新构建并生成上述四个包。
- `npm run prepare:win7`：准备隔离依赖并恢复 x64 原生绑定，不编译应用。
- `npm run test:win7 -- --core`：核心逻辑与真实 Electron 22 原生依赖检查；完整命令还执行界面回归，使用临时用户数据。
- x86 打包会替换隔离工作区的 SQLite 和歌词解码绑定；之后若要重新运行 x64 测试，先执行 `npm run prepare:win7`，同时恢复这两项绑定。已生成的 x64 包不受影响。

构建先复制当前源码，再依次编译主进程、主界面、迷你播放器和脚本界面，避免多个大型编译任务争抢内存。源码指纹用于阻止遗漏重新编译的旧产物进入打包。

## 适配内容

| 范围 | 具体方法 |
| --- | --- |
| 内核与语法 | Electron 精确锁为 22.3.27；打包目标 Electron 22.3、Chrome 108，TypeScript 目标 ES2022。 |
| 网络、代理、下载、更新 | Undici 固定 5.29.0；共享兼容层处理相对重定向、重试、取消和二进制响应，避免调用新版专有的拦截器接口。 |
| 更新渠道 | Win7 运行时只选择带 `win7_` 的对应架构安装包，普通版排除 Win7 包；发布元数据使用独立 `win7` 渠道。 |
| SQLite、歌单、回收站与缓存 | better-sqlite3 固定 9.6.0，按 Electron ABI 110 为 x64/x86 分别准备原生绑定；保留现有数据库迁移、事务和 30 天回收规则。 |
| 本地音频、封面和内嵌歌词 | music-metadata 固定 8.3.0、strtok3 固定 7.0.0，保持 Buffer 解析协议；兼容字符串与对象形式的歌词标签。 |
| 音效、音量均衡与输出设备 | 保留 Web Audio 处理链；Chrome 108 缺少 AudioContext.setSinkId 时，通过 MediaStream 和 HTMLAudioElement.setSinkId 选择输出设备，串行处理切换并保留失败前的输出。默认设备继续走原输出路径。 |
| 登录与浏览器协作 | Playwright 固定 1.29.2，避免运行依赖要求 Node 18 或更新版本。 |
| 插件商店与源码 ZIP | 固定可在 Node 16 运行的编译工具版本；Tailwind 扫描器、Lightning CSS 使用 WASM，避免新版 Windows 原生库；将嵌套 CSS 和新颜色语法转换为 Chrome 108 可用的规则和回退颜色；为主编译进程和扫描工作线程补齐 WASI 开关，使用管道标准输入。保留 LXPlugin、ZIP 导入及内置功能标识。 |
| 32 位源码编译 | 限制 WASM 初始和最大内存预约，避免 32 位地址空间不足导致工作线程启动失败。 |
| 迷你播放器 | 真实元素替代歌词拖动伪元素，解决 Electron 22 原生拖动区域侵入标题栏；歌词遮罩增加 Chrome 108 支持的 WebKit 前缀；保留透明、隐藏控制、锁定恢复、尺寸记忆和两种歌词布局。 |
| 动态背景、歌词与设置 | 保留现有 WebGL 渲染和性能挡位、动画、搜索、选中项记忆与可展开选项，使用旧内核执行界面回归。 |

## 维护与检查

版本配置位于 `build-config/win7/profile.cjs`，完整依赖树锁定在同目录 `package-lock.json`。需要调整兼容依赖时运行 `npm run lock:win7`，随后重新构建、测试、打包；不要直接修改生成工作区或降低普通版的依赖版本。

每次构建会核对实际进入应用包的依赖以及随包分发的插件编译依赖是否声明支持 Node 16，并输出 `dist/win7-*-audit.json`、`dist/win7-build.json`。这些检查和类型编译用于发现依赖/API 兼容问题，不能代替操作系统测试。

自动化覆盖包括：重定向/取消/重试、播放衔接与定时停止、队列失效、元数据解析、数据库迁移和回收、真实音量均衡、音效、标签编辑、插件导入/编译/导出、歌词样式、迷你播放器、设置交互、动态背景、WebDAV 和更新选择。网络场景使用本地模拟响应，不修改真实平台账号。

最终源码构建通过全部四个编译目标以及全项目 ESLint。最终核心回归为 462 项通过、0 项失败；新增 CSS 转换后的插件界面复测为 15 项通过、0 项失败。迷你播放器及音频兼容路径的 29 项复测、普通版的 24 项界面回归均通过。各组有重叠，不按组相加计算独立测试数量。

成品验证使用 `tests/win7-package.electron.test.cjs`：将 `LX_TEST_WIN7_PACKAGE` 设为待检查的 `win-unpacked` 或 `win-ia32-unpacked` 绝对路径后运行。检查启动发行版自带的 EXE/DLL、加载实际 ASAR、SQLite 歌单读写、本地 WAV 播放、音量均衡、迷你播放器，以及不依赖系统 Node/npm 的离线源码插件编译。测试使用临时用户数据，并阻止注册协议和修改系统登录项。

2026-09-20 生成的 x64、x86 成品均通过上述检查及歌词解码原生库加载检查，实际运行版本均为 Electron 22.3.27 / Node 16.17.1 / Chromium 108.0.5359.215。两份绿色压缩包通过完整性校验；四个包对应的 SHA-256 在 `build/win7/artifacts/SHA256SUMS.txt`，机器可读的架构、版本、源码指纹及验证结果在同目录 `verification.json`。打包 x86 后恢复 x64 开发测试环境的 5 项复测也已通过。

本次旧内核验证在当前 Windows 构建机器上进行，尚未在 Windows 7 实机或虚拟机验收。发布为经过 Win7 实机验证的版本之前，还需确认：安装/卸载和重启、真实声卡输出切换、旧显卡动态背景、中文字体/输入法、热键与托盘、实际平台登录及 HTTPS、系统缩放下的迷你播放器。实机上的操作系统、驱动和服务端登录限制不能仅靠源码检查保证。

## 官方依据

- [Electron 22.3.27 运行时版本](https://releases.electronjs.org/release/v22.3.27)
- [Electron 对 Windows 7/8/8.1 的支持范围](https://www.electronjs.org/blog/windows-7-to-8-1-deprecation-notice)
- [Undici 的 Node 版本兼容表](https://github.com/nodejs/undici)
