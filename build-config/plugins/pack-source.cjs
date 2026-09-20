const { packProject } = require('./developer-kit/project.cjs')

async function main() {
  const [directory, filename] = process.argv.slice(2)
  if (!directory || !filename) throw new Error('Usage: node build-config/plugins/pack-source.cjs <source-directory> <output.zip>')
  console.log((await packProject(directory, filename)).output)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
