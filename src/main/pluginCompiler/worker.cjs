process.env.NODE_ENV = 'production'
process.on('message', async({ source, output, manifest }) => {
  try {
    await require('./compile.cjs')(source, output, manifest)
    process.send({ success: true }, () => process.exit(0))
  } catch (error) {
    process.send({ success: false, message: String(error?.stack ?? error).slice(0, 6000) }, () => process.exit(1))
  }
})
