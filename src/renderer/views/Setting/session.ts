interface SettingPosition {
  id: string
  top: number
  sidebarTop: number
}

// View navigation is only kept for this renderer session, never in saved settings.
export const settingSession = {
  current: null as (SettingPosition & { query: string, searchOrigin: SettingPosition | null }) | null,
  tabPositions: new Map<string, number>(),
}
