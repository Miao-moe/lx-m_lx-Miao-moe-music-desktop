const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Writable } = require('node:stream')
const http = require('node:http')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const flush = () => new Promise(setImmediate)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
const makeTask = id => ({ id, status: 'pause', isComplate: false, downloaded: 0, total: 0, progress: 0, speed: '', writeQueue: 0,
  metadata: { musicInfo: { id, source:'kw', name:'Song', singer:'Singer', meta:{} }, quality:'128k', ext:'mp3', fileName:'Song.mp3', filePath:'', url:'https://audio.test/song' } })
async function directory(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lx-download-lifecycle-'))
  t.after(async() => {
    const real = await fs.promises.realpath(directory)
    assert.equal(path.dirname(real).toLowerCase(), (await fs.promises.realpath(os.tmpdir())).toLowerCase())
    assert(path.basename(real).startsWith('lx-download-lifecycle-'))
    await fs.promises.rm(real, { recursive:true, force:true })
  })
  return directory
}
function workerFixture(check = async()=>true) {
  const created=[]
  const api=loader({
    '@common/utils/download': { createDownload: options=>{ const dl={options, starts:0, stops:0, start:async()=>{dl.starts++}, stop:async()=>{dl.stops++}, setRateLimit(){}, refreshUrl(){} }; created.push(dl); return dl } },
    '@common/utils/nodejs': {checkAndCreateDir:check, removeFile:fs.promises.unlink}, './utils': {createDownloadInfo(){}},
  })('src/renderer/worker/download/download.ts')
  return {api,created}
}
test('C01: pause invalidates initialization before filesystem checks finish', async t=>{
  const dir=await directory(t), gate=deferred(), f=workerFixture(()=>gate.promise), events=[]
  const running=f.api.startTask(makeTask('same'),dir,false,event=>events.push(event))
  await flush()
  const paused=f.api.pauseTask('same')
  gate.resolve(true)
  await Promise.all([running,paused])
  assert.equal(f.created.length,0)
  assert.deepEqual(events,[])
})
test('C06/C13: concurrent equal filenames are reserved separately; existing files survive suffix allocation', async t=>{
  const dir=await directory(t), f=workerFixture(), a=makeTask('a'), b=makeTask('b')
  await fs.promises.writeFile(path.join(dir,'Song.mp3'),'original')
  await Promise.all([f.api.startTask(a,dir,false,()=>{}),f.api.startTask(b,dir,false,()=>{})])
  assert.equal(new Set(f.created.map(dl=>dl.options.fileName)).size,2)
  assert(f.created.every(dl=>dl.options.fileName!=='Song.mp3'))
  assert.equal(await fs.promises.readFile(path.join(dir,'Song.mp3'),'utf8'),'original')
  await Promise.all([f.api.pauseTask('a'),f.api.pauseTask('b')])
})
test('C07: a retired task retry timer and callbacks cannot start or fail its replacement', async t=>{
  const dir=await directory(t), f=workerFixture(), task=makeTask('same'), events=[]
  await f.api.startTask(task,dir,false,()=>{})
  const old=f.created[0]
  old.options.onError(Object.assign(Error('reset'),{code:'ECONNRESET'}))
  await flush()
  await f.api.pauseTask('same')
  await f.api.startTask(task,dir,false,event=>events.push(event))
  const replacement=f.created[1]
  old.options.onError(Object.assign(Error('late disk error'),{code:'ENOSPC'}))
  await delay(1100)
  assert.equal(old.starts,0)
  assert.equal(replacement.starts,0)
  assert.equal(events.some(event=>event.action==='error'),false)
  await f.api.pauseTask('same')
})
const native = Object.fromEntries(['fs','path','events','perf_hooks','http','https','url','tunnel'].map(name=>[name,require(name)]))
test('C08: failed resume reads close their file handle before reporting an error', async()=>{
  let closed=0, error
  const Downloader=loader({...native,fs:{...fs,promises:{...fs.promises,stat:async()=>({size:100}),open:async()=>({read:async()=>{throw Object.assign(Error('read failed'),{code:'EIO'})},close:async()=>{closed++}})}}})('src/common/utils/download/Downloader.ts').default
  const dl=new Downloader('http://unused','.', 'audio')
  dl.on('error',value=>{error=value})
  await dl.start()
  assert.equal(error.code,'EIO')
  assert.equal(closed,1)
})
test('C01/C08: pausing a resume waits for the pending read handle to close', async()=>{
  const reading=deferred(), opened=deferred();let closed=false, stopped=false, requests=0
  const Downloader=loader({...native,fs:{...fs,promises:{...fs.promises,stat:async()=>({size:100}),open:async()=>({read:async()=>{opened.resolve();await reading.promise;return{buffer:Buffer.alloc(10),bytesRead:10}},close:async()=>{closed=true}})}},'./request':{request(){requests++;throw Error('should stay paused')}}})('src/common/utils/download/Downloader.ts').default
  const dl=new Downloader('http://unused','.', 'audio')
  const start=dl.start();await opened.promise
  const stop=dl.stop().then(()=>{stopped=true})
  await flush();assert.equal(stopped,false)
  reading.resolve();await Promise.all([start,stop])
  assert.equal(closed,true);assert.equal(requests,0)
})
test('C01/C06: cancellation during file reservation removes only its new placeholder', async t=>{
  const dir=await directory(t), closing=deferred(), opened=deferred();let active=true
  const api=loader({'node:fs/promises':{...fs.promises,open:async(...args)=>{const file=await fs.promises.open(...args);opened.resolve();return{close:async()=>{await closing.promise;await file.close()}}}}})('src/renderer/worker/download/fileLease.ts')
  const pending=api.reserveDownloadPath(dir,'Song.mp3',false,false,()=>active)
  await opened.promise;active=false;closing.resolve()
  assert.equal(await pending,null)
  assert.deepEqual(await fs.promises.readdir(dir),[])
})
test('C05/C15: slow writes bound queued bytes; rate-limited waits remain immediately cancellable', {timeout:8000}, async t=>{
  const dir=await directory(t), payload=Buffer.alloc(1024*1024,42)
  const server=http.createServer((_req,res)=>res.end(payload))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  let peak=0, writes=0, received=0
  const Downloader=loader({...native,fs:{...fs,createWriteStream(){
    return new Writable({highWaterMark:65536,write(chunk,_encoding,done){writes++;received+=chunk.length;peak=Math.max(peak,this.writableLength);setTimeout(done,30)}})
  }}})('src/common/utils/download/Downloader.ts').default
  const url='http://127.0.0.1:'+server.address().port
  const dl=new Downloader(url,dir,'slow',{timeout:200})
  await new Promise((resolve,reject)=>{dl.on('error',reject);dl.on('completed',resolve);void dl.start()})
  assert.equal(received,payload.length)
  assert(writes>1)
  assert(peak<=256*1024,'disk queue must remain bounded')
  const limited=new Downloader(url,dir,'limited',{rateLimit:1024,timeout:200})
  let failure
  limited.on('error',error=>{failure=error})
  await limited.start();await delay(300)
  const start=Date.now();await limited.stop()
  assert(Date.now()-start<300)
  assert.equal(failure,undefined,'intentional rate waits are not network timeouts')
  assert.equal(limited.progress.downloaded,0)
})
test('C13: filename templates expand all fields and sanitize Windows names',()=>{
  const {formatDownloadFileName}=loader()('src/common/utils/download/fileName.ts')
  const song={id:'kw_1',source:'kw',name:'A/B',singer:'Singer',meta:{albumName:'Album'}}
  assert.equal(formatDownloadFileName('{artist} - {title} - {album} - {quality} - {source} - {id}',song,'flac','flac'),'Singer - AB - Album - flac - kw - kw_1.flac')
  assert.equal(formatDownloadFileName('CON',song,'128k','mp3'),'_CON.mp3')
  assert.equal(formatDownloadFileName('歌名 - 歌手',song,'128k','mp3'),'AB - Singer.mp3')
})
test('C09/C10: embedded and separate lyrics share one fetch and all writes settle before failure',async()=>{
  const {finishDownloadFiles}=loader()('src/renderer/store/download/postprocess.ts')
  let lyrics=0, embedded, sidecar, settled=false
  const gate=deferred(), error=Object.assign(Error('disk full'),{code:'ENOSPC'})
  const result=finishDownloadFiles(makeTask('a'),{'download.isEmbedLyric':true,'download.isDownloadLrc':true},{
    lyric:async()=>{lyrics++;return {lyric:'[00:00.000] words'}},picture:async()=>'',cancelled:()=>false,
    writeMeta:async(_meta,lrc)=>{embedded=lrc;throw error},saveLrc:async(lrc)=>{sidecar=lrc;await gate.promise},
  }).finally(()=>{settled=true})
  const failed=assert.rejects(result,{code:'ERR_DOWNLOAD_POSTPROCESS'})
  await flush();assert.equal(lyrics,1);assert.equal(settled,false);assert.equal(embedded.lyric,sidecar.lyric)
  gate.resolve();await failed
})
