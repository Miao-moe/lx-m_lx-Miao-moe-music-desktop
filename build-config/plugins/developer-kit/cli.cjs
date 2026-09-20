const { version, initProject, packProject, checkProject, unpackProject } = require('./project.cjs')
const { vendorProject } = require('./dependencies.cjs')

const help = `LX-M 插件开发工具包 ${version}

node lx-plugin.cjs init <新目录> [插件ID]       创建 Vue / TypeScript 示例
node lx-plugin.cjs pack <插件目录> [输出.zip]  生成可导入的源码 ZIP
node lx-plugin.cjs check <目录或.zip>         校验结构、文件清单和完整性
node lx-plugin.cjs unpack <输入.zip> <新目录> 解包为可编辑的插件项目
node lx-plugin.cjs vendor <插件目录> [main|engine] 收集已安装的依赖（默认 main）

打包默认输出到插件目录旁的同名 ZIP，修改后可再次打包。
校验不执行插件代码；运行效果请在 LX-M 的插件商店中导入验证。
Windows 可将插件文件夹拖到 pack.cmd，将文件夹或 ZIP 拖到 check.cmd。
`

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); return }
  if (['version', '--version', '-v'].includes(command)) { console.log(version); return }
  const counts = { init: [1, 2], pack: [1, 2], check: [1, 1], unpack: [2, 2], vendor: [1, 2] }
  if (!counts[command] || args.length < counts[command][0] || args.length > counts[command][1]) throw new Error(help)
  if (command === 'init') console.log('已创建插件：' + await initProject(args[0], args[1], __dirname))
  if (command === 'pack') {
    const result = await packProject(args[0], args[1], __dirname)
    console.log(`已打包 ${result.manifest.id} ${result.manifest.version}（${result.bytes} 字节）\n${result.output}`)
  }
  if (command === 'check') {
    const { manifest, files } = await checkProject(args[0], __dirname)
    console.log(`校验通过：${manifest.id} ${manifest.version}，API ${manifest.apiVersion}，${files.size} 个文件`)
  }
  if (command === 'unpack') console.log('已解包：' + await unpackProject(args[0], args[1]))
  if (command === 'vendor') console.log('已收集依赖：' + await vendorProject(args[0], args[1]))
}

main().catch(error => { console.error('操作失败：' + error.message); process.exitCode = 1 })
