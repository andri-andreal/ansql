# ANSQL Documentation

Documentation for features, fixes, and changes in the ANSQL project.

## Document Format

Documents are named using the format: `YYYY_MM_DD_HHMM_feature_name.md`

- **YYYY_MM_DD**: Date of implementation
- **HHMM**: Time (24-hour format)
- **feature_name**: Short descriptive name

## Index

### Planning & Analysis

1. **[ANSQL vs Navicat — Feature Gap Analysis](navicat-gap-analysis.md)**
   - Date: 2026-06-15
   - Type: Research / Roadmap
   - Description: 177 features compared across 10 Navicat areas (have/partial/missing
     with UX/UI deltas, priority, effort, and recommendations) + a suggested 4-sprint roadmap

### Features

1. **[Excel-like Cell Selection & Copy-Paste](2026_01_31_excel_like_selection.md)**
   - Date: 2026-01-31
   - Type: Feature
   - Description: Multi-cell selection, keyboard navigation, copy/paste with Excel compatibility

2. **[Add Row Feature](2026_01_30_add_row_feature.md)**
   - Date: 2026-01-30
   - Type: Feature
   - Description: Insert new records directly through UI with auto-fill timestamps

### Bug Fixes

1. **[MySQL TIMESTAMP Column Fix](2026_02_01_1900_mysql_timestamp_fix.md)**
   - Date: 2026-02-01 19:00
   - Type: Bug Fix
   - Priority: High
   - Description: Fixed TIMESTAMP columns showing NULL due to incorrect type handling

## Feature Categories

### Data Manipulation
- Excel-like Cell Selection & Copy-Paste
- Add Row Feature

### Database Integration
- MySQL TIMESTAMP Column Fix

## Quick Navigation

### By Priority
- **High**: MySQL TIMESTAMP Fix, Add Row Feature
- **Medium**: Excel-like Selection

### By Type
- **Features**: 2 documents
- **Bug Fixes**: 1 document

## Development Guidelines

When adding new documentation:

1. Use the standardized naming format
2. Include these sections:
   - Date & Time
   - Type (Feature/Bug Fix/Enhancement)
   - Priority (High/Medium/Low)
   - Problem/Overview
   - Solution/Implementation
   - Files Modified
   - Testing/Results
   - Future Enhancements
   - References

3. Add entry to this README
4. Use code blocks with syntax highlighting
5. Include before/after examples where applicable
6. Document edge cases and error handling

## Version History

- **2026-02-01**: MySQL TIMESTAMP column fix
- **2026-01-31**: Excel-like selection feature
- **2026-01-30**: Add row feature

## Related Documentation

- [Project README](../README.md)
- [Tauri Configuration](../src-tauri/tauri.conf.json)
- [Database Driver Interface](../src-tauri/src/db/driver.rs)

## Contributing

When documenting new features or fixes:
1. Create a new markdown file with proper naming
2. Follow the template structure
3. Update this README with the new entry
4. Include code examples and screenshots if applicable

## Contact

For questions about documentation or features, please refer to the project repository.
