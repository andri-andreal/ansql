export default {
  // QueryDocument — results panel header + actions
  "query.results": "Hasil",
  "query.resultsRows": "{{count}} baris",
  "query.chart": "Grafik",
  "query.chartTooltip": "Visualisasikan hasil ini sebagai grafik",
  "query.editResults": "Edit hasil",
  "query.editResultsTooltip": "Edit {{table}} dalam grid yang dapat diedit",
  "query.copyAsSource": "Salin sebagai sumber",
  "query.copyAsSourceTooltip":
    "Salin hasil ini sebagai sumber transfer lintas-basis data",
  "query.queryError": "Kesalahan Kueri",
  "query.fixWithAi": "Perbaiki dengan AI",
  "query.fixWithAiTooltip":
    "Minta asisten AI memperbaiki kueri ini menggunakan kesalahannya",
  "query.executing": "Menjalankan kueri...",
  "query.executeToSeeResults": "Jalankan kueri untuk melihat hasil",
  "query.convertDialectPrompt":
    "Konversi ke dialek SQL yang mana? (mis. postgres, mysql, sqlite)",

  // QueryToolbar
  "query.execute": "Jalankan",
  "query.cancel": "Batal",
  "query.executeTooltip": "Jalankan (Ctrl+Enter)",
  "query.cancelTooltip": "Batal (Esc)",
  "query.runAll": "Jalankan Semua",
  "query.runAllTooltip": "Jalankan semua pernyataan di editor",
  "query.runSelected": "Jalankan Pilihan",
  "query.runSelectedTooltip": "Jalankan SQL yang dipilih",
  "query.explain": "Jelaskan",
  "query.explainTooltip": "Jelaskan pernyataan / pilihan saat ini",
  "query.sqlBuilder": "Pembuat SQL",
  "query.sqlBuilderTooltip": "Bangun kueri SELECT secara visual",
  "query.askAi": "Tanya AI",
  "query.askAiTooltip": "Tanya asisten AI tentang kueri ini",
  "query.askAiExplain": "Jelaskan",
  "query.askAiOptimize": "Optimalkan",
  "query.askAiConvert": "Konversi",
  "query.askAiFix": "Perbaiki",
  "query.saveTooltip": "Simpan ke Favorit (Ctrl+S)",
  "query.formatTooltip": "Format SQL (Shift+Alt+F)",
  "query.findReplaceTooltip": "Cari / Ganti (Ctrl+H)",
  "query.history": "Riwayat Kueri",
  "query.savedQueries": "Kueri Tersimpan",
  "query.snippets": "Cuplikan",
  "query.selectConnection": "Pilih koneksi...",
  "query.selectDatabase": "Pilih basis data...",
  "query.loading": "Memuat...",

  // ResultTabs
  "query.resultLabel": "Hasil {{index}}",
  "query.doubleClickToRename": "Klik dua kali untuk mengganti nama",
  "query.unpinResult": "Lepas sematan hasil",
  "query.pinResult": "Sematkan hasil",
  "query.closeResult": "Tutup hasil",

  // Common
  "query.refresh": "Segarkan",
  "query.close": "Tutup",
  "query.delete": "Hapus",
  "query.edit": "Edit",
  "query.save": "Simpan",
  "query.saving": "Menyimpan…",
  "query.add": "Tambah",
  "query.loadingEllipsis": "Memuat…",
  "query.clickToLoad": "Klik untuk memuat ke editor",

  // HistoryPanel
  "query.exportHistoryTitle": "Ekspor riwayat kueri",
  "query.exportHistoryTooltip": "Ekspor riwayat (CSV)",
  "query.clearHistory": "Bersihkan riwayat",
  "query.csvFiles": "Berkas CSV",
  "query.selectConnectionForHistory":
    "Pilih koneksi untuk melihat riwayatnya.",
  "query.noHistory": "Belum ada riwayat kueri.",
  "query.rowsCount": "{{count}} baris",

  // SavedQueriesPanel
  "query.noSavedQueries": "Belum ada kueri tersimpan.",

  // SaveFavoriteDialog
  "query.saveToFavorites": "Simpan ke Favorit",
  "query.name": "Nama",
  "query.description": "Deskripsi",
  "query.query": "Kueri",
  "query.nameRequired": "Nama wajib diisi.",
  "query.namePlaceholder": "mis. Pengguna aktif 30 hari terakhir",
  "query.optional": "Opsional",
  "query.empty": "(kosong)",

  // SnippetManager
  "query.newSnippet": "Cuplikan baru",
  "query.body": "Isi",
  "query.snippetNamePlaceholder": "mis. Pilih semua",
  "query.snippetBodyPlaceholder": "SELECT * FROM ...",
  "query.noSnippets": "Belum ada cuplikan. Gunakan tombol + untuk menambahkan.",
  "query.insertIntoEditor": "Sisipkan ke editor",

  // ParamInputDialog
  "query.queryParameters": "Parameter Kueri",
  "query.valueFor": "Nilai untuk {{name}}",
  "query.rawMode": "Mode mentah",
  "query.rawModeDescription":
    "substitusikan nilai secara harfiah alih-alih mengikat parameter — gunakan dengan hati-hati",
  "query.run": "Jalankan",

  // ExplainPlanView
  "query.explainPlan": "Rencana Eksekusi",
  "query.expandAll": "Bentangkan semua",
  "query.expandAllTooltip": "Bentangkan semua simpul",
  "query.collapseAll": "Ciutkan semua",
  "query.collapseAllTooltip": "Ciutkan semua simpul",
  "query.collapse": "Ciutkan",
  "query.expand": "Bentangkan",
  "query.noPlanNodes": "Tidak ada simpul rencana untuk ditampilkan.",

  // SqlBuilderView
  "query.queryBuilder": "Pembuat Kueri",
  "query.fromTable": "Dari tabel",
  "query.loadingTables": "Memuat tabel…",
  "query.selectTable": "Pilih tabel…",
  "query.columns": "Kolom",
  "query.all": "Semua",
  "query.none": "Tidak ada",
  "query.loadingColumns": "Memuat kolom…",
  "query.noColumnsSelected": "Tidak ada kolom yang dipilih — bawaan ke",
  "query.joins": "Gabungan",
  "query.removeJoin": "Hapus gabungan",
  "query.suggestedFromForeignKeys": "Disarankan dari kunci asing",
  "query.addJoin": "Tambahkan gabungan ini",
  "query.noForeignKeyJoins":
    "Tidak ada gabungan kunci asing yang tersedia untuk tabel yang dipilih.",
  "query.filters": "Filter",
  "query.addFilter": "Tambah filter",
  "query.noFilters": "Tidak ada filter.",
  "query.columnPlaceholder": "kolom…",
  "query.value": "nilai",
  "query.removeFilter": "Hapus filter",
  "query.orderBy": "Urutkan menurut",
  "query.addSort": "Tambah pengurutan",
  "query.noSorting": "Tidak ada pengurutan.",
  "query.removeSort": "Hapus pengurutan",
  "query.sqlPreview": "Pratinjau SQL",
  "query.buildQueryAbove": "-- bangun kueri di atas",
  "query.pickTableToStart": "Pilih tabel untuk mulai membangun kueri.",
  "query.useQuery": "Gunakan kueri",

  // ResultsGrid
  "query.queryExecutedSuccessfully": "Kueri berhasil dijalankan",
  "query.rowsAffected": "{{count}} baris terpengaruh",
  "query.executionTime": "Waktu eksekusi: {{ms}}ms",
  "query.rowsSummary": "{{count}} baris",
  "query.filteredFrom": "(difilter dari {{total}})",
  "query.search": "Cari...",
  "query.clearFilters": "Bersihkan filter",
  "query.clearFiltersTooltip": "Bersihkan semua filter dan pencarian",
  "query.copy": "Salin",
  "query.copyToClipboard": "Salin ke papan klip",
  "query.exportCsv": "CSV",
  "query.exportCsvTooltip": "Ekspor sebagai CSV",
  "query.exportJson": "JSON",
  "query.exportJsonTooltip": "Ekspor sebagai JSON",

  // PreflightDialog (pratinjau pre-flight untuk UPDATE/DELETE mentah)
  "query.preflightTitleUpdate": "Pre-flight: UPDATE {{table}}",
  "query.preflightTitleDelete": "Pre-flight: DELETE FROM {{table}}",
  "query.preflightHeadlineUpdate": "{{count}} baris akan berubah di {{table}}",
  "query.preflightHeadlineDelete": "{{count}} baris akan dihapus dari {{table}}",
  "query.preflightHeadlineUnknown": "Setidaknya {{cap}} baris akan terpengaruh di {{table}}",
  "query.preflightNoWhere":
    "Pernyataan ini tidak punya klausa WHERE — semua baris di {{table}} akan terpengaruh.",
  "query.preflightPrediction":
    "Nilai baru dihitung dari data saat ini — ekspresi non-deterministik (mis. NOW()) bisa berbeda saat pernyataan benar-benar dijalankan.",
  "query.preflightTruncated": "Menampilkan {{cap}} baris pertama dari {{total}}.",
  "query.preflightReversible": "Reversibel — undo akan dicatat di Time Machine",
  "query.preflightIrreversibleNoPk": "Tidak reversibel — tabel tidak punya primary key",
  "query.preflightIrreversibleTruncated":
    "Tidak reversibel — jumlah baris melebihi batas snapshot ({{cap}})",
  "query.preflightIrreversiblePkAssigned":
    "Tidak reversibel — pernyataan mengubah kolom primary key",
  "query.preflightIrreversibleEmpty": "Tidak ada yang bisa di-undo — tidak ada baris yang cocok",
  "query.preflightNoChange": "(tidak berubah)",
  "query.preflightSqlLabel": "Pernyataan",
  "query.preflightCommitUpdate": "Jalankan UPDATE",
  "query.preflightCommitDelete": "Jalankan DELETE",
  "query.preflightCancel": "Batal",
  "query.preflightCancelled": "Dibatalkan: {{verb}} pada {{table}} tidak dijalankan.",

  // ChartView
  "query.chartBar": "Batang",
  "query.chartLine": "Garis",
  "query.chartArea": "Area",
  "query.chartPie": "Lingkaran",
  "query.chartTypeTooltip": "Grafik {{type}}",
  "query.pickAxes":
    "Pilih kolom X dan setidaknya satu kolom Y numerik untuk digambarkan.",
  "query.toggleSeries": "Alihkan seri {{name}}",
  "query.closeChart": "Tutup grafik",
} as Record<string, string>;
