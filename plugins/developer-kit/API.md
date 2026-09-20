# 插件接口（API 3）

入口在 plugin.json 的 `entry` 中指定，例如 `src/index.ts`。入口默认导出一个 `PluginModule`：

```ts
import type { PluginModule } from 'lx-m-plugin'
import Settings from './Settings.vue'

export default {
  components: { Settings },
  activate(context) {
    // 按需使用 context.assetUrl('images/icon.svg') 或 context.readAsset('data.json')。
    // 资源需要先在 plugin.json 的 assets 中声明。
    return () => {
      // 卸载、更新或退出时移除自己创建的监听器、定时器和音频节点。
    }
  },
} satisfies PluginModule
```

`lx-m-plugin` 只提供类型，必须用 `import type`。`vue` 在主窗口和桌面歌词入口由宿主提供；不需要把 Vue 源码放入 vendor/main。

| 成员 | 用途 |
| --- | --- |
| `components` | 必须存在；其中 `Settings` 自动成为设置面板，可留空对象 |
| `activate(context)` | 可选同步初始化；返回同步清理函数 |
| `slots.playDetailControls` | 播放详情页附加控制组件 |
| `playDetail: { component, enabled }` | 播放详情替换视图；enabled 是 Vue 布尔 Ref |
| `slots.desktopLyricOverlay` | 桌面歌词覆盖组件，通常由 lyricEntry 返回 |
| `downloadActions` | API 3 下载任务菜单操作 |

`PluginContext` 包含 `id`、宿主 `apiVersion`、插件 `version`、`assetUrl(name)` 和异步 `readAsset(name)`。资源路径相对于安装后插件目录，使用 manifest.assets 中的 `to` 路径。

下载操作声明 `id`、`name`、`isAvailable(task)` 和异步 `run(taskId, { openSettings })`。task 提供 id、isComplate（沿用宿主拼写）、status、metadata.filePath 和 metadata.fileName；打开设置用于让用户继续操作。完整签名见 `types/lx-m-plugin.d.ts`。

## 独立 ID 和设置

ID 使用小写英文字母、数字和中划线，以字母开头，最长 64 字符。第三方插件无需登记在主程序的固定名单中，安装后根据入口导出的组件显示。ID 是安装和更新依据；创建自己的插件时换成自己的 ID。

Vue 组件可直接使用 ref、computed、onMounted、onUnmounted。界面可使用 `--color-font`、`--color-primary` 等主题变量，样式优先使用 `<style module>` 或 scoped。组件局部状态不会自动持久化；可自行使用按插件 ID 命名的 localStorage 键，并提供适当默认值。

## 资源和桌面歌词

```json
{
  "assets": [{ "from": "src/images", "to": "images" }],
  "lyricEntry": "src/lyric.ts"
}
```

`lyricEntry` 可选，在桌面歌词窗口中单独加载，仍默认导出 PluginModule，components 必须存在。主窗口与歌词窗口的模块状态不共享。

## 当前边界

不修改主程序即可实现设置面板、播放器附加控件、播放详情视图、桌面歌词覆盖和下载任务操作。全新窗口位置、主进程事件或现有 API 没有提供的深层能力，需要宿主增加对应接口。

四个官方示例中的 `@renderer`、`@common` 等导入有两种来源：编译器桥接的宿主模块，或包内 sdk 辅助源码。相关桥接列表见 SOURCE-FORMAT.md；不要把未提供的主程序内部模块当作稳定公开 API。新插件优先使用此页的 PluginModule 接口。

插件当前运行在应用环境中，不是隔离沙箱。工具包的 check 负责结构与文件完整性；它不对代码行为进行审核。
