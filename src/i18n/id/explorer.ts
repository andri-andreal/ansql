export default {
  // Header / toolbar
  "explorer.title": "Penjelajah",
  "explorer.newGroup": "Grup Baru…",
  "explorer.refresh": "Segarkan",

  // Search
  "explorer.searchPlaceholder": "Cari objek…",
  "explorer.clearSearch": "Hapus pencarian",
  "explorer.noMatches": "Tidak ada yang cocok",

  // Empty / placeholder states
  "explorer.noConnections": "Tidak ada koneksi tersedia",
  "explorer.noTablesFound": "Tidak ada tabel ditemukan",

  // Tree root + category folder labels
  "explorer.myConnections": "Koneksi Saya",
  "explorer.starred": "Berbintang",
  "explorer.categoryTables": "Tabel",
  "explorer.categoryViews": "View",
  "explorer.categoryFunctions": "Fungsi",
  "explorer.categoryTriggers": "Trigger",
  "explorer.categoryMaterializedViews": "Materialized View",
  "explorer.categorySequences": "Sequence",
  "explorer.categoryEvents": "Event",
  "explorer.categoryQueries": "Kueri",
  "explorer.categoryBackups": "Cadangan",

  // Prompts
  "explorer.newGroupPrompt": "Nama grup baru:",

  // Context menu actions
  "explorer.connect": "Sambungkan",
  "explorer.edit": "Ubah",
  "explorer.delete": "Hapus",
  "explorer.disconnect": "Putuskan",
  "explorer.serverMonitor": "Monitor Server",
  "explorer.newQuery": "Kueri Baru",
  "explorer.newView": "View Baru",
  "explorer.newFunction": "Fungsi Baru",
  "explorer.newProcedure": "Prosedur Baru",
  "explorer.newMaterializedView": "Materialized View Baru",
  "explorer.newSequence": "Sequence Baru",
  "explorer.newEvent": "Event Baru",
  "explorer.showErd": "Tampilkan Diagram ER",
  "explorer.structureSync": "Sinkronisasi Struktur…",
  "explorer.dataSync": "Sinkronisasi Data…",
  "explorer.transferTo": "Transfer ke…",
  "explorer.pasteHere": "Tempel di sini",
  "explorer.importFromFile": "Impor dari berkas…",
  "explorer.dumpSqlBackup": "Dump SQL / Cadangan…",
  "explorer.dumpSql": "Dump SQL…",
  "explorer.executeSqlFile": "Jalankan Berkas SQL…",
  "explorer.copy": "Salin",
  "explorer.editView": "Ubah View",
  "explorer.newTrigger": "Trigger Baru",
  "explorer.editFunction": "Ubah Fungsi",
  "explorer.editProcedure": "Ubah Prosedur",
  "explorer.editTrigger": "Ubah Trigger",
  "explorer.dropTrigger": "Hapus Trigger",
  "explorer.editEvent": "Ubah Event",
  "explorer.dropEvent": "Hapus Event",
  "explorer.editSequence": "Ubah Sequence",
  "explorer.dropSequence": "Hapus Sequence",
  "explorer.dropMaterializedView": "Hapus Materialized View",

  // Star / move-to-group submenu
  "explorer.star": "Beri Bintang",
  "explorer.unstar": "Hapus Bintang",
  "explorer.moveToGroup": "Pindahkan ke grup",
  "explorer.noGroup": "(Tanpa grup)",

  // Confirmations
  "explorer.deleteConnectionConfirm": "Hapus koneksi \"{{name}}\"?",
  "explorer.dropTriggerConfirm": "Hapus trigger \"{{name}}\"? Tindakan ini tidak dapat dibatalkan.",
  "explorer.dropObjectConfirm": "Hapus {{label}} \"{{name}}\"? Tindakan ini tidak dapat dibatalkan.",

  // Object labels (used in drop confirmations / error messages)
  "explorer.objectEvent": "event",
  "explorer.objectSequence": "sequence",
  "explorer.objectMaterializedView": "materialized view",

  // Errors
  "explorer.createGroupFailed": "Gagal membuat grup: {{error}}",
  "explorer.moveConnectionFailed": "Gagal memindahkan koneksi: {{error}}",
  "explorer.dropTriggerFailed": "Gagal menghapus trigger \"{{name}}\": {{error}}",
  "explorer.dropObjectFailed": "Gagal menghapus {{label}} \"{{name}}\": {{error}}",
  "explorer.newDatabase": "Database Baru…",
  "explorer.newDatabasePrompt": "Nama database baru",
  "explorer.createDatabaseFailed": "Gagal membuat database: {{error}}",
} as Record<string, string>;
