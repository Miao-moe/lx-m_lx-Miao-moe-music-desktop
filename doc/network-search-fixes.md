# 网络与搜索问题修复记录

对应 B01—B22，日期：2026-09-21。

## 逐项处理

| 编号 | 处理结果 | 主要回归覆盖 |
| --- | --- | --- |
| B01 | 普通数据请求的总超时覆盖连接、重定向及完整正文；收到响应头后停滞或持续滴流也会结束请求。主进程、搜索请求和自定义音源共用相应的超时处理。 | `request.production`、`win7-compat`、`user-api-network.electron` |
| B02 | 相同音源、平台、歌曲、音质及刷新状态的播放地址请求共享进行中的任务；失败后允许重新请求。 | `music-network` |
| B03 | 酷狗分组子项按自己的歌曲标识与文件哈希去重，保留父项之后的不同歌曲。 | `search-network` |
| B04 | QQ 桌面与移动搜索各最多三次，建议搜索一次、批量详情一次；最坏路径最多八次请求，并受搜索总超时约束。 | `search-network`、`qq-search`、`qq-search.electron` |
| B05 | QQ 建议搜索将至多十首歌曲详情合为一次请求；保留返回顺序，跳过缺失或标识不匹配的单项。 | `search-network` |
| B06 | 咪咕按实际接口页共享请求和短期缓存，跨页请求最多三个并发，复用交叠页。 | `search-network`、`search-fallback.electron` |
| B07 | 咪咕封面与歌词复用歌曲详情，详情缓存 60 秒；已有有效封面时直接使用。 | `search-network` |
| B08 | 酷我缺少歌曲标识或标题的单项被跳过，可选字段缺失不影响其余结果；不再重复请求同一主接口。 | `search-network` |
| B09 | 网易云歌单完整快照缓存 30 秒，按歌单和凭据隔离；分页复用快照，权限与歌曲匹配改用索引。 | `search-network` |
| B10 | 酷狗、咪咕批量歌曲详情共用四个请求的并发上限，取消后的排队任务及时移除。 | `search-network`、`request-context` |
| B11 | 区分权限、限流、资源不存在、服务器故障及其他业务错误；仅对可恢复故障有限重试。 | `search-network`、`qq-search` |
| B12 | 聚合搜索随各平台完成更新列表，快平台的结果立即可见，不再被整批加载模式或封面加载阻塞。 | `list-loading`、`list-loading.electron`、`search-network.electron` |
| B13 | 搜索替换、切歌、预加载变更、页面退出和封面卸载会取消相关请求或排队任务；共享任务在最后一个使用者取消后终止。补齐自定义音源取消消息。 | `request-context`、`preload-queue`、`cover-network`、`music-cover-cache`、`search-network.electron`、`user-api-network.electron` |
| B14 | 搜索成功结果短期缓存 30 秒，限制查询与页数，返回副本；过期及主动刷新重新请求，旧请求不能覆盖新一轮结果。 | `search-network`、`search-fallback` |
| B15 | 播放地址的音质降级、重试和换源共用 30 秒总预算；单个平台搜索链为 20 秒，跨平台匹配为 15 秒。取消时停止退避等待及后续尝试。 | `request-context`、`music-network`、`list-loading` |
| B16 | 跨平台匹配找到可用候选便返回并取消其他搜索；若候选地址不可用，继续查找尚未尝试的平台。 | `request-context`、`music-network` |
| B17 | 换源缓存改为歌曲稳定标识、元数据、音源和排除平台组成的键；强制刷新贯穿搜索，旧任务晚返回不会覆盖刷新结果。 | `music-network` |
| B18 | 使用请求库已解压、解码的正文，仅解析一次 JSON，同时保留原始数据。 | `request.production` |
| B19 | 按代理与目标协议复用连接池，启用连接保持；更改代理时释放旧池，普通版与 Win7 依赖锁同步更新。 | `request.production`、`win7-compat` |
| B20 | 网络层转换用户可读错误时保留原始原因、错误码、状态和重试分类，供上层判断与定位。 | `request.production`、`search-network` |
| B21 | 聚合搜索展示各平台状态、完成耗时和总体进度；失败平台可以单独重试，其他平台仍可继续加载。 | `list-loading`、`search-network.electron` |
| B22 | 歌曲搜索增加可选的跨平台同曲合并；按歌名、歌手、版本和时长保守匹配，合并后优先保留当前音源支持的歌曲。根据后续反馈移除版本筛选下拉框，搜索展示全部版本。 | `search-music-filter`、`search-network.electron`、`music-toggle` |

表中测试名均对应 `tests/<名称>.test.cjs`。

## 使用与边界

- 同曲合并依据歌曲标题中的版本标记区分不同版本。未标注的现场、翻唱等版本无法可靠识别，不进行音频指纹判断。
- “合并跨平台同曲”默认关闭；关闭后恢复全部原始结果。缺少歌手、时长或匹配把握不足的歌曲保持独立。
- 错误不会作为成功搜索结果缓存；强制刷新跳过相应缓存。歌单快照按凭据隔离，避免跨账号复用。
- 自定义音源通过宿主 `lx.request` 发出的请求支持正文总超时。Chromium 跨隔离环境的异步调用丢失归属时，保守地将请求关联到当前调用集合，待所有相关调用结束后取消，避免误伤另一首歌。
- 流式下载仍使用正文空闲超时，持续正常传输的大文件不受普通数据请求的绝对时限截断。
- 本轮验证主要使用本地可控服务与平台响应样例；QQ 建议搜索及详情批量接口另做了真实接口检查。平台实时可用性仍取决于上游服务。
- 生产编译与 Electron 运行环境验证不等同于重新生成安装包，也不等同于在 Windows 7 操作系统上实机验证。

## 回归记录

- 请求、缓存、分页、播放、歌词与兼容性回归：176 / 176 通过。
- Electron 界面及自定义音源回归：41 个用例通过，覆盖普通版和 Win7 版 Electron 运行环境。首次整组执行中的列表可见性检查过早，已改为等待实际行绘制；该用例重跑通过，并增加两种操作按钮布局下的合并来源标签检查。
- `main`、`renderer`、`renderer-scripts` 的生产编译通过；新增搜索界面已截图检查。
- 本轮网络与搜索修改的 ESLint 检查通过。包含先前本地修改的全部文件检查仍有一项原有问题：`src/renderer/components/common/PlayQueueBtn.vue:133` 的 Promise 未处理拒绝；该行不属于本轮网络修改，未将此检查记为全部通过。
- `git diff --check` 通过；构建输出均在忽略目录中，没有新增受版本管理的构建文件。本轮代码保留在本地工作区，未提交或推送。

新增问题的重点回归可单独运行：

```powershell
node --test --test-concurrency=1 tests/request.production.test.cjs tests/request-context.test.cjs tests/search-network.test.cjs tests/music-network.test.cjs tests/cover-network.test.cjs tests/search-music-filter.test.cjs
node --test --test-concurrency=1 tests/search-network.electron.test.cjs tests/user-api-network.electron.test.cjs
```

界面用例使用本地生产编译结果；Win7 自定义音源用例需要已经准备好的 `build/win7/workspace` 运行环境。
