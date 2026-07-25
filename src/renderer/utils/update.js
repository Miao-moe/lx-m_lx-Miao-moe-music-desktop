import { httpGet } from './request'

const REPO_OWNER = 'Miao-moe'
const REPO_NAME = 'lx-m_lx-Miao-moe-music-desktop'
const LATEST_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
      follow: true,
      follow_max: 5,
      headers: {
        'User-Agent': 'lx-music-desktop',
        Accept: 'application/vnd.github+json',
      },
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        ++retryNum >= 3
          ? reject(err || new Error(resp.statusMessage || resp.statusCode))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getArchKeyword = () => {
  switch (process.arch) {
    case 'x64': return 'x64'
    case 'ia32': return 'x86'
    case 'arm64': return 'arm64'
    case 'arm': return 'armv7l'
    default: return process.arch
  }
}

const selectAsset = (assets) => {
  if (!Array.isArray(assets) || !assets.length) return null
  const arch = getArchKeyword().toLowerCase()
  const platform = process.platform

  let candidates = assets.filter(asset => {
    const name = (asset.name || '').toLowerCase()
    switch (platform) {
      case 'win32': return name.endsWith('.exe')
      case 'darwin': return name.endsWith('.dmg')
      case 'linux': return name.endsWith('.appimage') || name.endsWith('.deb')
      default: return false
    }
  })
  if (!candidates.length) return null

  const archMatched = candidates.filter(asset => (asset.name || '').toLowerCase().includes(arch))
  if (archMatched.length) candidates = archMatched

  if (platform === 'win32') {
    const setup = candidates.find(asset => (asset.name || '').toLowerCase().includes('setup'))
    if (setup) return setup
  }

  return candidates[0]
}

export const getVersionInfo = async() => {
  const info = await request(LATEST_API)
  if (!info || info.tag_name == null) throw new Error('failed')

  const version = String(info.tag_name).replace(/^v/i, '')
  const asset = selectAsset(info.assets)

  return {
    version,
    desc: info.body ?? '',
    history: [],
    downloadUrl: asset?.browser_download_url ?? '',
    fileName: asset?.name ?? '',
    size: asset?.size ?? 0,
    digest: asset?.digest ?? '',
  }
}
