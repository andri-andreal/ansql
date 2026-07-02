# Excel-like Cell Selection & Copy-Paste Feature

**Date:** 2026-01-31
**Time:** Earlier implementation
**Type:** Feature
**Priority:** Medium

## Feature Overview

Added Excel-style multi-cell selection and copy-paste functionality to the TableData component, enabling users to work with data more efficiently.

## Capabilities

### 1. Cell Selection
- **Single Cell**: Click on any cell to select it
- **Range Selection**: Click and drag to select multiple cells
- **Shift+Click**: Extend selection from anchor cell to clicked cell
- **Ctrl+Click**: Select single cell (independent selection)
- **Keyboard Navigation**: Use arrow keys to navigate and Shift+Arrow to extend selection

### 2. Copy & Paste
- **Ctrl+C**: Copy selected cells as tab-separated values (TSV)
- **Ctrl+V**: Paste data into cells starting from selection anchor
- **Excel-compatible**: TSV format works between ANSQL and Excel/Google Sheets
- **Smart Fill**: If clipboard is smaller than selection, data repeats to fill the range

### 3. Visual Feedback
- **Selected cells**: Blue border with light blue background (`ring-2 ring-blue-500 ring-inset`)
- **Edited cells**: Amber background (`bg-amber-500/10`)
- **Selected + Edited**: Both indicators visible (amber bg + blue ring)
- **Drag cursor**: Shows `cell` cursor during selection

## Implementation Details

### State Management

Added new state variables to track selection:
```typescript
const [selectedRange, setSelectedRange] = useState<CellRange | null>(null);
const [selectionAnchor, setSelectionAnchor] = useState<{ row: number; col: number } | null>(null);
const [isDragging, setIsDragging] = useState(false);

interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
```

### Helper Functions

1. **Selection Utilities**:
   - `getNormalizedRange()`: Normalize range (ensure start <= end)
   - `isCellSelected()`: Check if cell is in selected range
   - `getSelectionClassName()`: Get CSS classes for cell styling

2. **Copy/Paste Logic**:
   - `formatSelectionAsTSV()`: Convert selected cells to tab-separated values
   - `parseTSVAndApply()`: Parse clipboard data and apply to cells
   - `validateAndConvertValue()`: Convert pasted values based on column type

### Event Handlers

**Mouse Events**:
- `handleCellClick()`: Single click, Shift+click, Ctrl+click selection
- `handleSelectionMouseDown()`: Start drag selection
- `handleSelectionMouseEnter()`: Update selection during drag
- `handleSelectionMouseUp()`: End drag selection

**Keyboard Events**:
- `handleTableKeyDown()`: Arrow keys, Ctrl+C, Ctrl+V, Escape
- `handleCopy()`: Copy selected cells to clipboard
- `handlePaste()`: Read clipboard and apply to cells

### Integration with Existing Features

**Edit Mode**:
- Double-click clears selection and enters edit mode
- Selection disabled while editing a cell
- Edit mode exit returns to selection mode

**Column Resize**:
- Selection preserved during column resize
- Independent state management prevents conflicts

**Pagination**:
- Selection cleared when loading new data
- Prevents confusion when switching pages

## Code Changes

### File: `src/components/table/TableData.tsx`

**Added Interfaces** (lines 27-32):
```typescript
interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
```

**Added State** (lines 51-53):
```typescript
const [selectedRange, setSelectedRange] = useState<CellRange | null>(null);
const [selectionAnchor, setSelectionAnchor] = useState<{ row: number; col: number } | null>(null);
const [isDragging, setIsDragging] = useState(false);
```

**Helper Functions** (lines 286-497):
- Selection utilities (11 functions)
- Copy/paste logic (3 functions)

**Event Handlers** (lines 500-694):
- Mouse handlers (5 functions)
- Keyboard handlers (3 functions)

**Cell Rendering** (lines 497-531):
Added event handlers and styling to table cells:
```typescript
<td
  onClick={(e) => handleCellClick(e, rowIdx, cellIdx)}
  onMouseDown={(e) => handleSelectionMouseDown(e, rowIdx, cellIdx)}
  onMouseEnter={() => handleSelectionMouseEnter(rowIdx, cellIdx)}
  onDoubleClick={() => !isEditing && handleCellDoubleClick(rowIdx, col.name, cell)}
  className={`${getSelectionClassName(rowIdx, cellIdx, isEdited)}`}
>
```

**Table Container** (lines 440-445):
Added keyboard event handling:
```typescript
<div
  ref={tableContainerRef}
  onKeyDown={handleTableKeyDown}
  tabIndex={0}
>
```

## Usage Examples

### Basic Selection
1. Click on cell A1
2. Shift+Click on cell C5
3. Result: Range A1:C5 selected

### Copy & Paste
1. Select cells A1:B3
2. Press Ctrl+C
3. Click on cell D1
4. Press Ctrl+V
5. Result: Data copied to D1:E3

### Fill Down Pattern
1. Select cells A1:A10
2. Type "Yes" in A1
3. Copy A1
4. Select A1:A10
5. Paste
6. Result: All cells filled with "Yes"

### Cross-Table Copy
1. Select cells in Table A
2. Ctrl+C
3. Switch to Table B
4. Select start cell
5. Ctrl+V
6. Result: Data pasted into Table B

## Edge Cases Handled

✅ Selection during edit mode → Disabled
✅ Pasting beyond table bounds → Stops at edges
✅ Invalid data types → Converted or kept as string
✅ Column resize during selection → Selection preserved
✅ Cross-table paste → TSV format universal
✅ Clipboard permissions → Try-catch with error logging
✅ Empty clipboard → Graceful handling
✅ Escape key → Clears selection

## Performance Considerations

- Only first row logged to avoid console spam
- Event handlers optimized with proper cleanup
- Minimal re-renders with focused state updates
- useEffect cleanup prevents memory leaks

## Browser Compatibility

Requires:
- Clipboard API support (modern browsers)
- navigator.clipboard.writeText() for copy
- navigator.clipboard.readText() for paste

Tested on:
- ✅ Chrome/Edge (Chromium)
- ✅ Firefox
- ⚠️ Safari (may require clipboard permissions)

## Future Enhancements

1. Multi-range selection (Ctrl+Click multiple ranges)
2. Copy with headers option
3. Paste preview/confirmation
4. Undo/redo for paste operations
5. Format preservation (numbers, dates, etc.)
6. Drag-to-fill handle (Excel-like autofill)
7. Column/row selection (click header to select all)
8. Select all (Ctrl+A)

## User Feedback

This feature significantly improves data manipulation workflow:
- Faster bulk editing
- Excel users feel at home
- Reduces manual copy-paste errors
- Enables data migration between tools

## References

- Excel keyboard shortcuts
- Google Sheets selection behavior
- TSV (Tab-Separated Values) standard
- Clipboard API specification
