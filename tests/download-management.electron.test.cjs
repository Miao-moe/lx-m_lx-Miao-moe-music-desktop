const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const path=require('node:path')
const http=require('node:http')
const NodeID3=require('node-id3')
const {test}=require('node:test')
const {launch,route}=require('./helpers/motion-fixture.cjs')
const {mp3}=require('./helpers/tag-fixtures.cjs')
const invoke=(page,name,params)=>page.evaluate(({name,params})=>require('electron').ipcRenderer.invoke('winMain_download_list_'+name,params),{name,params})
const label=(page,key)=>page.evaluate(key=>window.i18n.t(key),key)
const poll=async(read,predicate)=>{const started=Date.now();while(!predicate(await read())){if(Date.now()-started>7000)throw Error('Persistent task state did not settle');await new Promise(resolve=>setTimeout(resolve,30))}}
test('C06/C09/C13/C14/C15: real downloads, filtering, naming, priority and database migration persist correctly',{timeout:90000},async t=>{
  const bytes=mp3().bytes, requests=[]
  const server=http.createServer((req,res)=>{requests.push(req.url);res.end(bytes)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let f=await launch({rendererPath:path.resolve('dist/index.html')})
  let stderr='', step='upgrade'
  const watch=()=>{f.app.process().stderr.on('data',data=>{stderr=(stderr+data).slice(-10000)})}
  watch()
  const profilePath=f.output
  try{
    f.page.setDefaultTimeout(10000)
    const legacy={id:'legacy',isComplate:false,status:'pause',statusText:'paused',downloaded:250,total:1000,progress:25,speed:'',writeQueue:0,metadata:{musicInfo:{id:'legacy',name:'Legacy song',singer:'Singer',source:'kw',interval:'01:00',meta:{}},quality:'128k',ext:'mp3',fileName:'legacy.mp3',filePath:'',url:null}}
    await invoke(f.page,'add',{list:[legacy],addMusicLocationType:'bottom'})
    // Exercise an actual version 4 upgrade without touching the user's profile.
    await f.app.evaluate(({app})=>{
      const req=process.mainModule.require('node:module').createRequire(app.getAppPath()+'/package.json')
      const db=new (req('better-sqlite3'))(req('node:path').join(global.lxDataPath,'lx.data.db'))
      try{db.exec("ALTER TABLE download_list DROP COLUMN taskOptions; UPDATE db_info SET field_value='4' WHERE field_name='version'")}finally{db.close()}
    })
    const exited=new Promise(resolve=>f.app.process().once('exit',resolve))
    await f.app.close();await exited;step='relaunch';f=await launch({profilePath,rendererPath:path.resolve('dist/index.html')})
    watch()
    const upgraded=await invoke(f.page,'get')
    assert.equal(upgraded[0].metadata.musicInfo.name,'Legacy song')
    assert.equal(upgraded[0].downloaded,250)
    assert.equal(upgraded[0].progress,25)
    step='seed'
    const {page}=f
    page.setDefaultTimeout(10000)
    const savePath=path.join(profilePath,'downloads')
    await page.evaluate(savePath=>window.lxData.updateSetting({'download.enable':true,'download.savePath':savePath,'download.skipExistFile':false,'download.isEmbedPic':false,'download.isEmbedLyric':false,'download.isDownloadLrc':false,'download.maxDownloadNum':2}),savePath)
    const tasks=['first','second','disk-failure'].map((id,index)=>({id,isComplate:false,status:'error',statusText:'fixture failure',downloaded:0,total:0,progress:0,speed:'',writeQueue:0,failure:{kind:index<2?'network':'disk',code:index<2?'ECONNRESET':'ENOSPC'},metadata:{musicInfo:{id,name:id,singer:'Test artist',source:'kw',interval:'00:01',meta:{albumName:'Test album',_qualitys:{'128k':{}}}},quality:'128k',ext:'mp3',fileName:index<2?'Same filename.mp3':'disk-failure.mp3',filePath:'',url:'http://127.0.0.1:'+server.address().port+'/'+id}}))
    await invoke(page,'add',{list:tasks,addMusicLocationType:'bottom'})
    await page.evaluate(async()=>{window.__downloadTasks=await window.__lxPluginHost.downloadFiles.getDownloads()})
    await route(page,'/download')
    step='select error tab'
    await page.getByRole('tab',{name:await label(page,'download__error'),exact:true}).click()
    const tools=page.locator('[data-download-failure-tools]')
    step='select network filter'
    await tools.locator('[role="combobox"]').click()
    await page.screenshot({path:path.join(profilePath,'download-filter-open.png')})
    await tools.locator('li').filter({hasText:await label(page,'download__failure_network')}).click()
    await page.waitForFunction(()=>document.querySelectorAll('#view .list-item').length===2)
    await tools.locator('ul').waitFor({state:'detached'})
    step='retry downloads'
    await tools.getByRole('button').click()
    await page.waitForFunction(()=>window.__downloadTasks.filter(item=>item.status==='completed').length===2)
    const completed=await page.evaluate(async()=>JSON.parse(JSON.stringify(await window.__lxPluginHost.downloadFiles.getDownloads())))
    assert.deepEqual(new Set(requests),new Set(['/first','/second']))
    const saved=completed.filter(task=>task.status==='completed')
    assert.equal(new Set(saved.map(task=>task.metadata.filePath)).size,2)
    for(const task of saved){assert.equal(NodeID3.read(await fs.readFile(task.metadata.filePath)).title,task.id);assert.equal(task.audioDownloaded,true)}
    await tools.locator('[role="combobox"]').click()
    await tools.locator('li').filter({hasText:await label(page,'download__failure_disk')}).click()
    await page.locator('#view .list-item').filter({hasText:'disk-failure'}).click({button:'right'})
    await page.getByRole('tab',{name:await label(page,'download__priority_first'),exact:true}).click()
    await page.locator('#view .list-item').getByText(await label(page,'download__priority_label'),{exact:true}).waitFor()
    await poll(()=>invoke(page,'get'),tasks=>tasks.some(item=>item.id==='disk-failure'&&item.priority===1)&&tasks.filter(item=>item.isComplate).length===2)
    await page.screenshot({path:path.join(profilePath,'download-failure-tools.png')})
    await route(page,'/setting?name=SettingDownload')
    const template=page.locator('#setting_download_name_template')
    await template.fill('{artist} - {title} [{quality}]');await template.press('Tab')
    await page.waitForFunction(()=>document.querySelector('[data-download-name-preview]')?.textContent.includes('[320k].mp3'))
    await template.scrollIntoViewIfNeeded()
    await page.screenshot({path:path.join(profilePath,'download-name-preview.png')})
    assert.deepEqual(f.errors,[])
    await f.app.close();f=await launch({profilePath,rendererPath:path.resolve('dist/index.html')})
    const restored=await invoke(f.page,'get')
    assert.equal(restored.find(item=>item.id==='disk-failure').failure.kind,'disk')
    assert.equal(restored.find(item=>item.id==='disk-failure').priority,1)
    for(const task of saved){const match=restored.find(item=>item.id===task.id);assert.equal(match.metadata.fileName,task.metadata.fileName);assert.equal(match.audioDownloaded,true);assert.equal(match.metadata.fileAllocated,true)}
    t.diagnostic('Download management verification: '+profilePath)
  }catch(error){console.error(error);await f.page.screenshot({path:path.join(profilePath,'download-failure.png'),timeout:2000}).catch(()=>{});t.diagnostic(JSON.stringify({step,profilePath,requests,stderr,errors:f.errors,text:await f.page.locator('#view').innerText({timeout:2000}).catch(()=>null)}));throw error}
  finally{const kill=setTimeout(()=>f.app.process().kill(),5000);await f.app.close().catch(()=>{});clearTimeout(kill);server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
