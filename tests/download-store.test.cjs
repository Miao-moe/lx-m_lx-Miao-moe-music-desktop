const assert=require('node:assert/strict')
const path=require('node:path')
const {test}=require('node:test')
const loader=require('./helpers/load-typescript.cjs')
const flush=()=>new Promise(setImmediate)
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const task=id=>({id,status:'pause',isComplate:false,downloaded:0,total:0,progress:0,speed:'',writeQueue:0,metadata:{musicInfo:{id,source:'kw',name:id,singer:'Singer',meta:{}},fileName:id+'.mp3',filePath:path.join('C:/downloads',id+'.mp3'),url:'https://audio.test/'+id,quality:'128k',ext:'mp3'}})
function fixture(t, options={}){
  const previous=global.window, previousNavigator=Object.getOwnPropertyDescriptor(global,'navigator')
  Object.defineProperty(global,'navigator',{configurable:true,value:{onLine:true}})
  const list=options.list||[task('a')], callbacks=[],started=[],stopped=[],saved=[],events={}
  let lyrics=0, writes=0, fail=false, writeGate=gate()
  const settings={'download.maxDownloadNum':1,'download.skipExistFile':false,'download.isEmbedLyric':true,'download.isDownloadLrc':true,'download.autoResume':true,...options.settings}
  global.window={i18n:{t:key=>key},app_event:{downloadListUpdate(){}},addEventListener:(name,fn)=>{events[name]=fn},lx:{worker:{download:{
    startTask:async(info,_path,_skip,callback)=>{started.push(info.id);callbacks.push(callback)},pauseTask:async id=>{stopped.push(id)},setRateLimit:async()=>{},
    writeMeta:async()=>{writes++;await writeGate.promise;if(fail)throw Object.assign(Error('disk full'),{code:'ENOSPC'})},saveLrc:async()=>{},
  }}}}
  const actions=loader({
    '@renderer/utils/ipc':{downloadTasksGet:async()=>structuredClone(list),downloadTasksUpdate:async rows=>{saved.push(...structuredClone(rows))},downloadTasksRemove:async()=>{}},
    './state':{downloadList:list},'@common/utils/vueTools':{markRaw:x=>x,toRaw:x=>x},
    '@renderer/core/music/online':{getMusicUrl:options.url|| (async()=> 'https://audio.test/new'),getLyricInfo:async()=>{lyrics++;return{lyric:'[00:01.000] line'}},getPicUrl:async()=>''},
    '../setting':{appSetting:settings},'..':{},'@renderer/worker/utils':{proxyCallback:x=>x},'@renderer/utils':{joinPath:path.join,arrPush:(a,b)=>a.push(...b)},
    '@common/constants':{DOWNLOAD_STATUS:{RUN:'run',WAITING:'waiting',PAUSE:'pause',ERROR:'error',COMPLETED:'completed'}},'../index':{proxy:{}},'./utils':{buildSavePath:()=> 'C:/downloads'},
    '@renderer/plugins/Toast':()=>{},'@common/utils/nodejs':{getFileStats:async()=>({isFile:()=>true,size:1000})},
  })('src/renderer/store/download/action.ts')
  t.after(async()=>{writeGate.resolve();await actions.pauseDownloadTasks(list);await new Promise(resolve=>setTimeout(resolve,150));global.window=previous;if(previousNavigator)Object.defineProperty(global,'navigator',previousNavigator);else delete global.navigator})
  return{actions,list,callbacks,started,stopped,events,saved,settings,get lyrics(){return lyrics},get writes(){return writes},finish(error=false){fail=error;writeGate.resolve()},newWrite(){writeGate=gate();fail=false}}
}
test('C01: an obsolete URL lookup cannot start a paused or replaced download',async t=>{
  const old=gate(), recent=gate();let requests=0
  const info=task('a');info.metadata.url=null
  const f=fixture(t,{list:[info],url:()=>++requests===1?old.promise:recent.promise})
  await f.actions.startDownloadTasks(f.list);await flush()
  await f.actions.pauseDownloadTasks(f.list);await flush()
  await f.actions.startDownloadTasks(f.list);await flush()
  old.resolve('https://audio.test/old');await flush();assert.deepEqual(f.started,[])
  recent.resolve('https://audio.test/current');await flush();await flush()
  assert.deepEqual(f.started,['a']);assert.equal(info.metadata.url,'https://audio.test/current')
})
test('C09/C10: completion waits for tags; failed post-processing retries without redownloading audio',async t=>{
  const f=fixture(t), info=f.list[0]
  await f.actions.startDownloadTasks(f.list);await flush()
  f.callbacks[0]({action:'complete'});await flush()
  assert.equal(info.status,'run');assert.equal(info.isComplate,false);assert.equal(f.lyrics,1)
  f.finish(true);await flush();await flush()
  assert.equal(info.status,'error');assert.equal(info.audioDownloaded,true);assert.equal(info.failure.kind,'postprocess')
  f.newWrite();await f.actions.retryFailedDownloads('postprocess');await flush();await flush()
  assert.deepEqual(f.started,['a']);assert.equal(f.writes,2)
  f.finish();await flush();await flush()
  assert.equal(info.status,'completed');assert.equal(info.isComplate,true);assert.equal(info.failure,undefined)
})
test('C14: retry by failure reason leaves unrelated errors unchanged',async t=>{
  const network=task('network'),disk=task('disk')
  network.status=disk.status='error';network.failure={kind:'network'};disk.failure={kind:'disk'}
  const f=fixture(t,{list:[disk,network]})
  await f.actions.retryFailedDownloads('network');await flush()
  assert.deepEqual(f.started,['network']);assert.equal(disk.status,'error')
})
test('C09: pausing during a tag write keeps synchronization locked until the writer settles',async t=>{
  const f=fixture(t)
  await f.actions.startDownloadTasks(f.list);await flush()
  f.callbacks[0]({action:'complete'});await flush()
  await f.actions.pauseDownloadTasks(f.list)
  await assert.rejects(f.actions.withDownloadListSync(async()=>{}),/downloads_running/)
  f.finish();await flush();await flush()
  await f.actions.withDownloadListSync(async()=>{})
  assert.equal(f.list[0].status,'pause')
})
test('C15: priority chooses queued tasks first and reconnect does not resume manual pauses',async t=>{
  const a=task('normal'),b=task('priority');b.priority=1
  const f=fixture(t,{list:[a,b]})
  await f.actions.startDownloadTasks(f.list);await flush()
  assert.deepEqual(f.started,['priority'])
  navigator.onLine=false;f.events.offline();await flush()
  assert.equal(b.status,'waiting')
  await f.actions.pauseDownloadTasks([b]);await flush()
  navigator.onLine=true;f.events.online();await flush();await flush()
  assert.equal(b.status,'pause');assert.deepEqual(f.started,['priority','normal'])
})
