export default {
  // Header / toolbar
  "explorer.title": "Explorer",
  "explorer.newGroup": "New Group…",
  "explorer.refresh": "Refresh",

  // Search
  "explorer.searchPlaceholder": "Search objects…",
  "explorer.clearSearch": "Clear search",
  "explorer.noMatches": "No matches",

  // Empty / placeholder states
  "explorer.noConnections": "No connections available",
  "explorer.noTablesFound": "No tables found",

  // Tree root + category folder labels
  "explorer.myConnections": "My Connections",
  "explorer.starred": "Starred",
  "explorer.categoryTables": "Tables",
  "explorer.categoryViews": "Views",
  "explorer.categoryFunctions": "Functions",
  "explorer.categoryTriggers": "Triggers",
  "explorer.categoryMaterializedViews": "Materialized Views",
  "explorer.categorySequences": "Sequences",
  "explorer.categoryEvents": "Events",
  "explorer.categoryQueries": "Queries",
  "explorer.categoryBackups": "Backups",

  // Prompts
  "explorer.newGroupPrompt": "New group name:",

  // Context menu actions
  "explorer.connect": "Connect",
  "explorer.edit": "Edit",
  "explorer.delete": "Delete",
  "explorer.disconnect": "Disconnect",
  "explorer.serverMonitor": "Server Monitor",
  "explorer.newQuery": "New Query",
  "explorer.newView": "New View",
  "explorer.newFunction": "New Function",
  "explorer.newProcedure": "New Procedure",
  "explorer.newMaterializedView": "New Materialized View",
  "explorer.newSequence": "New Sequence",
  "explorer.newEvent": "New Event",
  "explorer.showErd": "Show ER Diagram",
  "explorer.structureSync": "Structure Synchronization…",
  "explorer.dataSync": "Data Synchronization…",
  "explorer.transferTo": "Transfer to…",
  "explorer.pasteHere": "Paste here",
  "explorer.importFromFile": "Import from file…",
  "explorer.dumpSqlBackup": "Dump SQL / Backup…",
  "explorer.dumpSql": "Dump SQL…",
  "explorer.executeSqlFile": "Execute SQL File…",
  "explorer.copy": "Copy",
  "explorer.editView": "Edit View",
  "explorer.newTrigger": "New Trigger",
  "explorer.editFunction": "Edit Function",
  "explorer.editProcedure": "Edit Procedure",
  "explorer.editTrigger": "Edit Trigger",
  "explorer.dropTrigger": "Drop Trigger",
  "explorer.editEvent": "Edit Event",
  "explorer.dropEvent": "Drop Event",
  "explorer.editSequence": "Edit Sequence",
  "explorer.dropSequence": "Drop Sequence",
  "explorer.dropMaterializedView": "Drop Materialized View",

  // Star / move-to-group submenu
  "explorer.star": "Star",
  "explorer.unstar": "Unstar",
  "explorer.moveToGroup": "Move to group",
  "explorer.noGroup": "(No group)",

  // Confirmations
  "explorer.deleteConnectionConfirm": "Delete connection \"{{name}}\"?",
  "explorer.dropTriggerConfirm": "Drop trigger \"{{name}}\"? This cannot be undone.",
  "explorer.dropObjectConfirm": "Drop {{label}} \"{{name}}\"? This cannot be undone.",

  // Object labels (used in drop confirmations / error messages)
  "explorer.objectEvent": "event",
  "explorer.objectSequence": "sequence",
  "explorer.objectMaterializedView": "materialized view",

  // Errors
  "explorer.createGroupFailed": "Failed to create group: {{error}}",
  "explorer.moveConnectionFailed": "Failed to move connection: {{error}}",
  "explorer.dropTriggerFailed": "Failed to drop trigger \"{{name}}\": {{error}}",
  "explorer.dropObjectFailed": "Failed to drop {{label}} \"{{name}}\": {{error}}",
  "explorer.newDatabase": "New Database…",
  "explorer.newDatabasePrompt": "New database name",
  "explorer.createDatabaseFailed": "Failed to create database: {{error}}",
} as Record<string, string>;
