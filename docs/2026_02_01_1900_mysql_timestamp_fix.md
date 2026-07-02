# MySQL TIMESTAMP Column Fix

**Date:** 2026-02-01
**Time:** 19:00
**Type:** Bug Fix
**Priority:** High

## Problem

MySQL TIMESTAMP columns (`created_at`, `updated_at`, `deleted_at`) were displaying as NULL in ANSQL, while the same data showed actual timestamp values in Navicat Premium.

### Root Cause

The issue was caused by incorrect type handling in the Rust backend:
1. MySQL `TIMESTAMP` and `DATETIME` are different types with different storage mechanisms
2. `TIMESTAMP` stores time in UTC and requires `chrono::DateTime<Utc>` in sqlx
3. `DATETIME` stores local time and uses `chrono::NaiveDateTime` in sqlx
4. The original code tried to decode all timestamp-like columns as `NaiveDateTime`, which failed for `TIMESTAMP` columns

### Error Message
```
Failed to decode 'created_at' as Option<NaiveDateTime>:
mismatched types; Rust type `core::option::Option<chrono::naive::datetime::NaiveDateTime>`
(as SQL type `DATETIME`) is not compatible with SQL type `TIMESTAMP`
```

## Solution

### 1. Added chrono Dependency
**File:** `src-tauri/Cargo.toml`

Added `"chrono"` feature to sqlx dependencies:
```toml
sqlx = { version = "0.8", features = [
    "runtime-tokio",
    "tls-rustls",
    "mysql",
    "postgres",
    "sqlite",
    "chrono"  # ← Added this
] }
```

### 2. Updated MySQL Driver
**File:** `src-tauri/src/db/mysql.rs`

Added import:
```rust
use chrono::{DateTime, Utc};
```

Modified timestamp handling logic to differentiate between TIMESTAMP and DATETIME:
```rust
// Check if it's TIMESTAMP (needs DateTime<Utc>) or DATETIME/DATE (needs NaiveDateTime)
let is_mysql_timestamp = col_type_lower == "timestamp";

if is_mysql_timestamp {
    // For MySQL TIMESTAMP columns, use DateTime<Utc>
    match row.try_get::<Option<DateTime<Utc>>, _>(i) {
        Ok(Some(val)) => {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        }
        Ok(None) => serde_json::Value::Null,
        Err(e) => {
            // Fallback to String
            row.try_get::<Option<String>, _>(i)
                .ok()
                .flatten()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null)
        }
    }
} else {
    // For DATETIME/DATE/TIME columns, use NaiveDateTime
    match row.try_get::<Option<chrono::NaiveDateTime>, _>(i) {
        // Similar handling...
    }
}
```

### 3. Enhanced Logging
Added detailed debug logging to track timestamp decoding:
- Log SQL query being executed
- Log first column value of first row (for row identification)
- Log timestamp column detection and decoding results
- Log whether values are NULL or successfully decoded

## Results

### Before Fix
```
Row 0: Failed to decode 'created_at' as Option<NaiveDateTime>: mismatched types
Row 0: Column 'created_at' is NULL (as String)
Row 0: Column 'updated_at' is NULL (as String)
```

### After Fix
```
Row 0: Successfully decoded 'created_at' as DateTime<Utc>: 2025-11-15 14:34:15 UTC
Row 0: Successfully decoded 'updated_at' as DateTime<Utc>: 2025-11-15 14:34:15 UTC
```

## Technical Details

### MySQL TIMESTAMP vs DATETIME
- **TIMESTAMP**: Stores UTC time, range 1970-2038, 4 bytes, automatic timezone conversion
- **DATETIME**: Stores local time, range 1000-9999, 8 bytes, no timezone awareness

### Timezone Consideration
TIMESTAMP values are displayed in UTC time in ANSQL. Example:
- Navicat (UTC+7): `2025-11-15 21:34:15`
- ANSQL (UTC): `2025-11-15 14:34:15`
- Difference: 7 hours (Indonesia timezone)

This is correct behavior. Future enhancement could add local timezone conversion in the frontend.

## Files Modified

1. `src-tauri/Cargo.toml` - Added chrono feature to sqlx
2. `src-tauri/src/db/mysql.rs` - Updated timestamp handling logic
3. `src/components/table/TableData.tsx` - Added debug logging (temporary)

## Testing

Tested with MySQL database `2025hondanew`, table `branches`:
- ✅ TIMESTAMP columns display correctly
- ✅ NULL timestamps handled properly
- ✅ DATETIME columns still work (fallback case)
- ✅ No regression in other data types

## Future Improvements

1. Add timezone conversion option in settings
2. Display timezone indicator in UI
3. Support user-configurable datetime format
4. Add tests for all MySQL temporal types (DATE, TIME, YEAR)

## References

- [sqlx MySQL Type Mappings](https://docs.rs/sqlx/latest/sqlx/mysql/types/index.html)
- [MySQL TIMESTAMP Documentation](https://dev.mysql.com/doc/refman/8.0/en/datetime.html)
- [chrono Crate Documentation](https://docs.rs/chrono/latest/chrono/)
