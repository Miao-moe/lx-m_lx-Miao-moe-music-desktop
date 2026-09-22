// Updated at the serialized worker boundary, including failed mutations whose
// rollback may have changed caches. Playback history and URL caches are excluded.
const revisions = { playlists: 0, downloads: 0, dislike: 0 }
export const bumpSyncRevision = (sections: Array<keyof typeof revisions>) => { for (const section of sections) revisions[section]++ }
export const syncRevision = (sections: LX.WebDAV.Section[]) => JSON.stringify({
  playlists: sections.includes('playlists') ? revisions.playlists : undefined,
  downloads: sections.some(section => section === 'downloadHistory' || section === 'downloadTasks') ? revisions.downloads : undefined,
  dislike: sections.includes('dislike') ? revisions.dislike : undefined,
})
