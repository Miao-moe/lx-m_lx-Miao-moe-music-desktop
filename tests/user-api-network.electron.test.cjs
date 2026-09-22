const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const { _electron } = require('playwright-core')

for (const [edition, requireDependency] of [['regular', require], ['win7', createRequire(path.resolve('build/win7/workspace/package.json'))]]) {
  test(`${edition}: custom source body deadlines and per-song cancellation cross the isolated script bridge`, { timeout: 20000 }, async t => {
    const directory = await fs.mkdtemp(path.resolve('.npm/user-api-network-'))
    const started = new Set(), closed = new Set(), held = new Map()
    const server = http.createServer((req, res) => {
      started.add(req.url)
      res.on('close', () => closed.add(req.url))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url === '/keep') { held.set(req.url, () => res.end('{"url":"https://audio.test/keep"}')); return }
      res.write('{')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const script = `lx.on(lx.EVENT_NAMES.request, async ({info}) => {
      await Promise.resolve();
      if (info.musicInfo.delay) await new Promise(resolve => setTimeout(resolve, info.musicInfo.delay));
      return new Promise((resolve,reject) => lx.request(info.musicInfo.url, {timeout:info.musicInfo.timeout}, (error,response,body) => error ? reject(error) : resolve(body.url)));
    }); lx.send(lx.EVENT_NAMES.inited, {sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`
    const wrapper = path.join(directory, 'main.cjs')
    await fs.writeFile(wrapper, `const {app,BrowserWindow,ipcMain}=require('electron');
      app.disableHardwareAcceleration();
      app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
      global.results=[]; global.inited=false; global.errors=[];
      ipcMain.on('userApi_init',(_event,response)=>{global.inited=response.status});
      ipcMain.on('userApi_response',(_event,response)=>{global.results.push(response)});
      app.whenReady().then(()=>{
        const win=global.testWindow=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false,preload:${JSON.stringify(path.resolve('dist/user-api-preload.js'))}}});
        win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)global.errors.push(message)});
        win.webContents.on('preload-error',(_event,path,error)=>global.errors.push(error.message));
        win.webContents.on('did-finish-load',()=>win.webContents.send('userApi_initEnv',{name:'Network fixture',script:${JSON.stringify(script)},proxy:{host:'',port:''}}));
        win.loadURL('data:text/html,<title>Network fixture</title>');
      });`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    let app
    const wait = async predicate => {
      const start = Date.now()
      while (!await predicate()) {
        if (Date.now() - start > 3000) throw Error('script network condition did not settle')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    try {
      app = await _electron.launch({ executablePath: requireDependency('electron'), args: [wrapper], env })
      await wait(() => app.evaluate(() => global.inited))
      const send = async(key, url, timeout = 10000, delay = 0) => app.evaluate((_electron, {key,url,timeout,delay}) => global.testWindow.webContents.send('userApi_request', {requestKey:key,data:{source:'kw',action:'musicUrl',info:{type:'128k',musicInfo:{url,timeout,delay}}}}), { key, url: base + url, timeout, delay })
      await send('timeout', '/timeout', 100)
      await wait(() => app.evaluate(() => global.results.some(result => result.data.requestKey === 'timeout')))
      const timeout = await app.evaluate(() => global.results.find(result => result.data.requestKey === 'timeout'))
      assert.equal(timeout.status, false)
      assert.match(timeout.message, /超时/)
      await wait(() => closed.has('/timeout'))
      await send('cancelled', '/cancelled')
      await send('keep', '/keep')
      await wait(() => started.has('/cancelled') && started.has('/keep'))
      await app.evaluate(() => global.testWindow.webContents.send('userApi_cancelRequest', 'cancelled'))
      await wait(() => closed.has('/cancelled'))
      assert.equal(closed.has('/keep'), false, 'one song cancellation leaves the other transport open')
      held.get('/keep')()
      await wait(() => app.evaluate(() => global.results.some(result => result.data.requestKey === 'keep')))
      const results = await app.evaluate(() => global.results)
      assert.equal(results.filter(result => result.data.requestKey === 'timeout').length, 1)
      assert.equal(results.find(result => result.data.requestKey === 'keep').data.result.data.url, 'https://audio.test/keep')
      // Main-world timers lose Node async context. Conservatively shared work
      // survives one cancellation and is closed after the last consumer exits.
      await send('shared-a', '/shared-a', 10000, 100)
      await send('shared-b', '/shared-b', 10000, 100)
      await wait(() => started.has('/shared-a') && started.has('/shared-b'))
      await app.evaluate(() => global.testWindow.webContents.send('userApi_cancelRequest', 'shared-a'))
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(closed.has('/shared-b'), false)
      await app.evaluate(() => global.testWindow.webContents.send('userApi_cancelRequest', 'shared-b'))
      await wait(() => closed.has('/shared-a') && closed.has('/shared-b'))
    } catch (error) {
      t.diagnostic(JSON.stringify({ started: [...started], closed: [...closed], state: await app?.evaluate(() => ({results:global.results, errors:global.errors})).catch(() => null) }))
      throw error
    } finally {
      if (app) await app.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      const resolved = await fs.realpath(directory)
      assert.equal(path.dirname(resolved), await fs.realpath('.npm'))
      assert(path.basename(resolved).startsWith('user-api-network-'))
      await fs.rm(resolved, { recursive: true, force: true })
    }
  })
}
