# 下载问题修复记录

对应 C01—C15，日期：2026-09-21。

## 逐项处理

| 编号 | 处理结果 | 主要回归覆盖 |
| --- | --- | --- |
| C01 | 初始化、目录检查、文件占用和地址获取都检查任务身份；暂停后旧异步结果无法启动下载。暂停等待断点读取句柄关闭，取消时清理尚未使用的新建占位文件。 | `download-lifecycle`、`download-store` |
| C02 | 封面按解析后的 URL 协议选择 HTTP 或 HTTPS，包括代理连接。 | `download-metadata` |
| C03 | FLAC 标签操作返回完整 Promise，等待读取、转换、写入、关闭和替换结束；输入损坏、写入或替换失败均向调用者报告。MP3 同样等待标签操作结束。 | `download-metadata` |
| C04 | 标签先写入同目录的独立临时文件，再直接替换原路径；不再先删除原文件。替换失败保留原文件并清理临时文件。 | `download-metadata` |
| C05 | 音频逐块等待磁盘写入完成再继续读取网络数据；封面使用管道背压，避免慢盘下持续积压。 | `download-lifecycle`、`download-transport` |
| C06 | 任务持有文件路径占用记录，并用独占创建避免并发覆盖。相同文件名自动分配不同后缀，标签处理结束或暂停清理完成后才释放占用。 | `download-lifecycle`、`download-management.electron` |
| C07 | 重试定时器绑定任务实例与下载器实例；暂停和替换时取消定时器，旧回调不能影响新任务。恢复操作结束前不释放原路径。 | `download-lifecycle`、`download-store` |
| C08 | 断点续传读取文件使用 `try/finally` 关闭句柄，读取失败和初始化期间暂停均覆盖。 | `download-lifecycle` |
| C09 | 音频落盘后显示“正在保存歌词与标签”，所有后处理结束才标记完成。失败明确提示音频已保存；重试仅补做后处理，不重新下载音频。暂停后尚未结束的写入仍阻止云同步覆盖下载列表。 | `download-store`、`download-lifecycle`、`download-management.electron` |
| C10 | 嵌入歌词与单独保存歌词共用一次获取结果，分别转换时不修改共享数据。 | `download-lifecycle`、`download-store` |
| C11 | 封面获取增加覆盖完整操作的 15 秒超时、最多 5 次重定向、10 MiB 响应体上限；检查状态和完整性，清理自身创建的残留文件。 | `download-metadata` |
| C12 | FLAC 封面根据实际图片字节识别 MIME，支持 JPEG、PNG、GIF、WebP、BMP、TIFF；无法识别的格式报告错误，不再统一写成 PNG。 | `download-metadata` |
| C13 | 下载设置支持自定义模板及命名预览，增加专辑、平台、音质、歌曲 ID 字段；清理非法文件名和 Windows 保留名称，同名按 `(1)`、`(2)` 等递增分配。 | `download-lifecycle`、`download-management.electron` |
| C14 | 下载错误区分网络、超时、权限、磁盘、HTTP、地址、同名、后处理和其他原因；“出错”页可按原因筛选并集中重试当前结果。 | `download-store`、`download-management.electron` |
| C15 | 右键菜单可调整排队优先级；设置增加每任务限速和恢复联网后继续下载。手动暂停保持暂停，优先级、错误信息和文件处理阶段在重启后保留。 | `download-lifecycle`、`download-store`、`download-management.electron` |

表中测试名对应 `tests/<名称>.test.cjs`。

## 使用方式与边界

- 下载设置 → 文件命名方式：支持原有“歌名”“歌手”及 `{title}`、`{artist}`、`{album}`、`{source}`、`{quality}`、`{id}`；预览与实际下载共用命名规则。
- 开启“跳过已存在文件”时保留已有文件并报告同名；关闭后自动追加序号，不覆盖已有文件。同时创建的不同任务始终分配独立文件名。
- 下载页 → 出错：选择失败原因，点击“重试当前失败任务”。后处理失败的音频可以通过打开文件入口找到；再次开始会补写标签和歌词。
- 右键任务 → 优先下载：影响排队顺序，不打断已运行的任务。
- 下载设置 → 每任务限速：单位为 KiB/s，默认不限速。这是单任务上限，多个任务的总速度取决于并发数量。
- 恢复联网选项利用系统在线/离线事件继续因断网等待的任务，并重试网络连接错误；手动暂停、权限错误及磁盘错误不会自动重试。
- MP3 和 FLAC 支持本轮标签写入；其他现有下载格式仍可单独保存歌词。
- 下载列表数据库升级为版本 5。迁移在事务中保留原记录，并保持现有数据库校验所需的标准表结构；旧任务的已下载大小与进度保留。

## 验证记录

- 下载传输、生命周期、标签、文件恢复、音频标签编辑、云同步和相关网络回归：96 / 96 通过。
- 主进程与主界面生产编译通过；本轮修改的 ESLint 检查通过。
- Electron 界面、旧数据库升级与重启、标签编辑、歌单回收站及云同步：26 个用例通过。首次组合验证发现旧下载记录的显示名称不兼容，已保留旧记录的歌曲名展示规则；修正后标签编辑、云同步及下载管理的 12 个用例重跑通过，回收站的 14 个用例此前已通过。
- 下载筛选、优先级及命名预览已截图检查；`git diff --check` 通过。
- 构建结果仅用于本地验证，确认均在 Git 忽略目录中；本轮未生成安装包，未提交或推送代码。

```powershell
node --test --test-concurrency=1 tests/download-transport.test.cjs tests/download-lifecycle.test.cjs tests/download-metadata.test.cjs tests/download-store.test.cjs tests/download-file-recovery.test.cjs tests/audio-tag-editor.test.cjs tests/audio-tag-editor-downloads.test.cjs tests/webdav.test.cjs tests/request-context.test.cjs tests/music-network.test.cjs tests/search-network.test.cjs
node --test --test-concurrency=1 tests/download-management.electron.test.cjs tests/list-trash.electron.test.cjs tests/audio-tag-editor-downloads.electron.test.cjs tests/webdav.electron.test.cjs
```

界面测试使用本地生产编译和隔离的临时用户目录。网络、慢盘及失败分支使用可控的本地服务与故障注入，不代表对所有在线平台或磁盘设备的实测。
