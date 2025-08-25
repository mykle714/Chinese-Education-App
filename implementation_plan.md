# Implementation Plan

## [Overview]
Fix the keyboard navigation bug in ReaderPage where arrow key handlers are not executing at all.

The ReaderPage component has an auto-select feature that should allow users to select words using arrow keys when enabled. However, the onKeyDown event handler is failing to execute the arrow key logic because the `querySelector('textarea')` call returns null. The Material UI TextField component's DOM structure doesn't allow direct access to the textarea element via a simple querySelector from the TextField wrapper. This causes an early return in the event handler, preventing any word selection functionality from working. The primary fix is to resolve the DOM access issue so the arrow key handlers can actually execute.

## [Types]
No new type definitions are required for this fix.

The existing interfaces and types in the component are sufficient:
- `Text` interface for text content
- React event types for keyboard and selection handling
- HTMLTextAreaElement for textarea manipulation

## [Files]
Single file modification to fix the word selection logic.

**Files to be modified:**
- `src/pages/ReaderPage.tsx` - Fix the DOM access issue in onKeyDown handler

**Specific changes required:**
- Fix the textarea element access method in the onKeyDown event handler
- Replace `querySelector('textarea')` with a working approach to access the textarea
- Ensure the arrow key handling code can actually execute
- Test that both ArrowLeft and ArrowRight key events are properly handled

## [Functions]
Single function replacement to fix the navigation bug.

**Functions to be modified:**
- **onKeyDown event handler** in `src/pages/ReaderPage.tsx` (lines 520-580)
  - **Current critical flaw**: `querySelector('textarea')` returns null, causing early return
  - **Required fix**: Replace textarea access method with working approach:
    1. Use `e.target` directly if it's the textarea element
    2. Use a different querySelector approach that works with Material UI structure
    3. Use a ref to access the textarea element directly
    4. Or modify the event attachment to target the textarea directly
  - **Priority**: This must be fixed before any word selection logic can work

**Functions that will work once DOM access is fixed:**
- `selectNextWord(textarea: HTMLTextAreaElement)` - Already working correctly
- `selectPreviousWord(textarea: HTMLTextAreaElement)` - Has algorithm issues but will be testable once DOM access works

## [Classes]
No class modifications required.

The ReaderPage is a functional component and doesn't use class-based architecture. All changes are contained within function implementations.

## [Dependencies]
No new dependencies required.

The fix uses existing browser APIs and React functionality:
- HTMLTextAreaElement.setSelectionRange() for text selection
- String manipulation for text analysis
- Existing Unicode regex patterns for character classification

## [Testing]
Manual testing approach to verify the fix works correctly.

**Test scenarios to validate:**
1. **Basic English text**: Navigate between words using left/right arrows
2. **Chinese text**: Ensure proper word boundary detection for Chinese characters
3. **Mixed language text**: Test transitions between English and Chinese words
4. **Punctuation handling**: Test navigation around punctuation marks
5. **Whitespace handling**: Test multiple spaces, tabs, and line breaks
6. **Edge cases**: Beginning/end of text, empty selections, single character words
7. **Auto-select toggle**: Verify the feature can be enabled/disabled properly

**Testing procedure:**
- Enable auto-select in the ReaderPage settings
- Use sample texts with various content types
- Test keyboard navigation (left/right arrows) with cursor placement
- Verify word selection highlights the correct text
- Test with both desktop and mobile interfaces

## [Implementation Order]
Sequential implementation steps to minimize conflicts and ensure successful integration.

1. **Identify DOM access issue** - ✓ Found querySelector('textarea') returns null
2. **Research Material UI TextField DOM structure** - Understand how to access the textarea element
3. **Fix textarea access method** - Replace querySelector with working approach
4. **Test arrow key event execution** - Verify onKeyDown handler executes with console.log
5. **Test existing selectNextWord function** - Confirm it works once DOM access is fixed
6. **Test selectPreviousWord function** - Identify if algorithm issues remain after DOM fix
7. **Fix selectPreviousWord algorithm if needed** - Only after confirming DOM access works
8. **Final integration testing** - Ensure both arrow keys work properly
9. **Documentation update** - Add comments explaining the DOM access solution
