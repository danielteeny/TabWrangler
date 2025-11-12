# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

TabWife is a Safari Web Extension (Manifest V3) for macOS that manages browser tabs through duplicate detection, domain-based organization, and session management. It consists of two components: a native macOS wrapper app (required by Safari) and the actual web extension.

## Build & Development

### Building from Source
```bash
# Open in Xcode
open TabWife.xcodeproj

# Build and run (⌘R in Xcode)
# Extension auto-enables in Safari on first launch
```

### Development Workflow

**For Extension Changes** (JavaScript, HTML, CSS, manifest.json):
- Edit files in `TabWife Extension/Resources/`
- Use Safari → Develop → Add Temporary Extension for fast iteration
- Changes visible immediately after reload (no Xcode rebuild needed)
- Access Web Inspector: Safari → Develop → inspect background.js or popup

**For Native App Changes** (Swift files):
- Modify files in `TabWife/`
- Requires rebuild: ⌘R in Xcode

### Testing
- Use Safari's Web Inspector for JavaScript debugging
- `console.log()` in popup.js visible in Web Inspector
- Swift logging: `os_log()` in SafariWebExtensionHandler

## Architecture

### Dual-Component System

TabWife follows Safari's required architecture:

1. **Native macOS App** (`TabWife/`) - Wrapper container
   - Purpose: Extension lifecycle, preference bridge, distribution/signing
   - Key files: `AppDelegate.swift`, `ViewController.swift`, `Main.html`
   - User sees this when opening the app (shows extension status)

2. **Web Extension** (`TabWife Extension/Resources/`) - Actual functionality
   - Service worker: `background.js` (tab monitoring, duplicate detection)
   - Popup UI: `popup.html`, `popup.js`, `popup.css`
   - Shared utilities: `utils/tabUtils.js`
   - Configuration: `manifest.json`

### Data Flow

```
Tab Events (creation/update)
    ↓
background.js (service worker)
    • Monitors tabs
    • Detects duplicates (1s delay for URL loading)
    • Updates badge count
    • Filters special URLs (about:*, chrome:*, safari:*)
    ↓
User clicks popup icon
    ↓
popup.js loads
    • Reads settings from browser.storage.sync
    • Queries tabs via browser.tabs API
    • Calls tabUtils.js for matching/grouping
    • Renders UI with duplicate groups
```

### Storage Strategy

- **browser.storage.sync**: Settings (matchMode, autoDetect, keepNewest, consolidationThreshold)
  - Syncs across Safari instances
  - Limited to ~10MB
- **browser.storage.local**: Sessions, UI state, hasSeenMoveWarning flag
  - Local-only, not synced
  - Larger quota

## Safari-Specific Limitations & Workarounds

### Critical: Cross-Window Tab Movement

**Problem**: Safari doesn't support `browser.tabs.move(tabId, {windowId})`

**Workaround** (see `popup.js:356-369`, `popup.js:574-584`):
```javascript
// Create new tab in target window
await browser.tabs.create({
  windowId: targetWindowId,
  url: tab.url,
  active: false
});
// Remove original tab
await browser.tabs.remove(originalTabId);
```

**Side Effects**:
- Page reloads completely
- Lost: scroll position, form data, history, session storage
- One-time warning dialog exists (currently disabled at `popup.js:514-517` for testing)

### Other Safari Limitations

- No `browser.tabGroups` API - cannot see or manipulate Safari's native tab groups
- No `groupId` property in tab objects
- Limited `browser.notifications` API - uses badge + alert() instead
- Pinned tabs must be manually filtered (`!tab.pinned`) in all operations

## Core Components

### tabUtils.js - Shared Utility Library

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `findDuplicates(tabs, matchMode, keepNewest)` | Groups tabs by match criteria, returns grouped duplicates + count |
| `matchTabs(tab1, tab2, mode)` | Compares two tabs using one of 6 match modes |
| `getRootDomain(hostname)` | **IP-aware**: Returns full IP for IPv4/IPv6/localhost; extracts root domain for hostnames |
| `groupByDomain(tabs)` | Groups tabs by domain (key format: `domain:port` if non-default port) |
| `generateConsolidationSuggestions(windows, threshold)` | Identifies "home window" (most tabs per domain), suggests moving "stray tabs" to consolidate |
| `analyzeDomainDistribution(windows)` | Maps tab distribution across windows for each domain |

**Match Modes** (critical for deduplication):
1. `exact` - Full URL including hash
2. `fullpath` - hostname + port + pathname + query (DEFAULT)
3. `path` - hostname + port + pathname only (ignores query params)
4. `port` - hostname + port only (for self-hosted services)
5. `subdomain` - Exact subdomain match
6. `domain` - Root domain only (collapses subdomains)

**IP Address Handling** (`tabUtils.js:82-85`):
- Special case: IP addresses (IPv4/IPv6/localhost) returned as-is
- Prevents incorrect grouping: `192.168.1.100` ≠ `192.168.2.100`
- Critical for self-hosted services

### popup.js - UI Controller

**State Management**:
- `currentScope`: 'current' (active window) or 'all' (all windows)
- `userSettings`: Loaded from `browser.storage.sync` with defaults

**Critical Functions**:

| Function | Notes |
|----------|-------|
| `updateDuplicatesList()` | **XSS-protected**: All user data passed through `escapeHtml()` |
| `closeDuplicates()` | Respects `keepNewest` setting, shows confirmation |
| `getTabs()` | **Always excludes pinned tabs**: `!tab.pinned` |
| `smartOrganize()` | Uses Safari workaround (create + remove) for tab movement |
| `moveSelectedTabs()` / `moveAllTabs()` | Multi-window consolidation via workaround |
| `showMoveWarningIfNeeded()` | **Currently disabled** (lines 514-517) for testing; re-enable before release |

**XSS Protection** (lines 31-35):
```javascript
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;  // Uses textContent, not innerHTML
  return div.innerHTML;    // Returns safe HTML
}
```
All URLs and titles passed through this function.

### background.js - Service Worker

**Key Behaviors**:
- Monitors `browser.tabs.onCreated` and `browser.tabs.onUpdated`
- **1-second delay** after tab creation allows URL to fully load before duplicate check
- Maintains `duplicateCache` Set to prevent duplicate notifications
- Filters special URLs: `about:*`, `chrome:*`, `safari:*`
- Updates badge with duplicate count via `browser.browserAction.setBadgeText()`

## Smart Domain Consolidation

**Algorithm** (`tabUtils.js:generateConsolidationSuggestions()`):

1. Analyze domain distribution across all windows
2. For each domain, identify "home window" = window with most tabs for that domain
3. Only suggest consolidation if home window has ≥ threshold tabs (default: 3)
4. Collect "stray tabs" from other windows
5. Sort suggestions by impact (most stray tabs first)

**User Controls**:
- Threshold slider (2-10 tabs) in settings section
- "Analyze Organization" - shows suggestions with checkboxes
- "Smart Organize" - one-click automatic consolidation
- Individual "Move Selected" / "Move All" buttons per domain

**UI Features**:
- Click tab titles → switches to that tab and focuses window
- Click window IDs → focuses that window
- Checkboxes per source window for selective moving
- Expandable groups with individual tab titles visible

## Important Implementation Details

### Pinned Tabs Are Always Excluded

Multiple locations enforce this:
- `popup.js:211` - `getTabs()` filters with `!tab.pinned`
- `popup.js:319` - Consolidation suggestions exclude pinned tabs
- Critical for preserving user-pinned important tabs

### Consolidation Threshold Logic

- User-configurable via slider (2-10 tabs)
- Prevents over-consolidation of small tab groups
- Only suggests moving tabs if target window meets threshold
- Stored in `browser.storage.sync` as `consolidationThreshold`

### Session Management

- Uses `browser.storage.local` (privacy-respecting, not synced)
- Sessions contain: timestamp, name, tab URLs
- Restoring creates new tabs in current window
- No automatic persistence across browser restarts

## Code Quality Standards

### Security
- **Always use `escapeHtml()`** for user-controlled data (URLs, titles)
- Never use `innerHTML` with unsanitized input
- Validate URLs before processing (`try/catch` around `new URL()`)

### Safari Compatibility
- Test all `browser.tabs.*` and `browser.windows.*` APIs in Safari first
- Document any workarounds with comments explaining the limitation
- Add warnings when features cause page reloads or state loss

### State Management
- Settings changes should trigger immediate UI updates
- Use `await` for all `browser.storage.*` and `browser.tabs.*` calls
- Handle promise rejections with `try/catch`

## Common Tasks

### Adding a New Match Mode

1. Add mode to `tabUtils.js:matchTabs()` switch statement
2. Add option to `popup.html` match mode dropdown
3. Add description to `popup.js:updateMatchModeDescription()`
4. Test with various URL patterns

### Modifying Duplicate Detection

1. Edit logic in `background.js` (for auto-detection)
2. Update `tabUtils.js:findDuplicates()` (for manual detection)
3. Ensure badge count updates correctly
4. Test with `duplicateCache` to prevent duplicate notifications

### Adding New UI Sections

1. Add HTML structure to `popup.html` (place results under action buttons)
2. Add styles to `popup.css`
3. Add event listeners in `popup.js` (use event delegation for dynamic content)
4. Update settings in `loadSettings()` / `saveSettings()` if needed

## Requirements

- macOS 14.0+ (Sonoma)
- Safari 14.0+
- Xcode 15.0+ (for building)
- Swift 5.9+ (implicit with Xcode 15)

## Project History

- Originally named "TabWrangler" - all references updated to "TabWife"
- Subtitle: "like a trad wife - it cleans up after you"
- Created by Daniel Teeny (11/10/25)
