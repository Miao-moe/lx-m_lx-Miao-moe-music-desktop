import { hash, isEmpty } from './data'
import { WebDAVError } from './errors'

export type Baseline = Partial<Record<LX.WebDAV.Section, { local: string, remote: string }>>

export const planSync = (operation: Exclude<LX.WebDAV.Operation, 'test'>, local: LX.WebDAV.Data, remote: LX.WebDAV.Data, baseline: Baseline, sections: LX.WebDAV.Section[], hashes?: Baseline) => {
  const upload: LX.WebDAV.Section[] = []
  const download: LX.WebDAV.Section[] = []
  const conflicts: LX.WebDAV.Section[] = []
  const missing: LX.WebDAV.Section[] = []
  for (const section of sections) {
    const localHash = hashes?.[section]?.local ?? hash(local[section])
    const remoteHash = hashes?.[section]?.remote ?? hash(remote[section])
    if (operation == 'download' && remote[section] === undefined) {
      missing.push(section)
      continue
    }
    if (localHash == remoteHash) continue
    if (operation == 'upload') upload.push(section)
    else if (operation == 'download') download.push(section)
    else {
      const previous = baseline[section]
      if (!previous) {
        if (remote[section] === undefined) upload.push(section)
        else if (isEmpty(section, local)) download.push(section)
        else conflicts.push(section)
      } else {
        const localChanged = localHash != previous.local
        const remoteChanged = remoteHash != previous.remote
        if ((localChanged && remoteChanged) || (remoteChanged && remote[section] === undefined)) conflicts.push(section)
        else if (localChanged) upload.push(section)
        else if (remoteChanged) download.push(section)
      }
    }
  }
  // Resolve every selected section before performing any writes.
  if (missing.length) throw new WebDAVError('missing_sections', missing)
  if (conflicts.length) throw new WebDAVError('conflict', conflicts)
  return { upload, download }
}
