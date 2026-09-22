export const libraryTables = new Map([
  ['index_download_music_id', 'CREATE INDEX "index_download_music_id" ON "download_list" ("isComplate", json_extract("musicInfo",\'$.id\'));'],
  ['library_preferences', 'CREATE TABLE "library_preferences" ("id" INTEGER PRIMARY KEY CHECK (id = 1), "value" TEXT NOT NULL);'],
  ['list_history', 'CREATE TABLE "list_history" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "list_id" TEXT NOT NULL, "created_at" INTEGER NOT NULL, "reason" TEXT NOT NULL, "count" INTEGER NOT NULL, "hash" TEXT NOT NULL, "payload" TEXT NOT NULL);'],
  ['index_list_history_list', 'CREATE INDEX "index_list_history_list" ON "list_history" ("list_id", "id" DESC);'],
  ['library_track', 'CREATE TABLE "library_track" ("id" TEXT PRIMARY KEY, "added_at" INTEGER NOT NULL, "last_played" INTEGER NOT NULL DEFAULT 0, "missing" INTEGER NOT NULL DEFAULT 0);'],
  ['listening_history', 'CREATE TABLE "listening_history" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "played_at" INTEGER NOT NULL, "song_id" TEXT NOT NULL, "name" TEXT NOT NULL, "singer" TEXT NOT NULL, "payload" TEXT NOT NULL);'],
  ['index_listening_history_date', 'CREATE INDEX "index_listening_history_date" ON "listening_history" ("played_at" DESC, "id" DESC);'],
  ['index_listening_history_song', 'CREATE INDEX "index_listening_history_song" ON "listening_history" ("song_id", "played_at" DESC);'],
])
