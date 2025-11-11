# TabWrangler

A powerful Safari extension for organizing and managing browser tabs. TabWrangler helps you find and close duplicate tabs, organize tabs by domain, and save/restore browsing sessions.

## Features

### 🔍 Duplicate Detection
- **Smart Matching**: Multiple match modes to identify duplicate tabs
- **IP Address Support**: Properly handles IPv4, IPv6, and localhost addresses
- **Port-Based Matching**: Distinguishes between services on different ports (e.g., `192.168.1.100:8080` vs `192.168.1.100:3000`)
- **Auto-Detection**: Automatically detects duplicates as you browse
- **Auto-Updating List**: Duplicate tabs are automatically displayed and updated in real-time
- **Expandable Groups**: Expand duplicate groups to see and manage individual tabs
- **Tab Navigation**: Click any tab title in an expanded group to switch to that tab
- **Individual Controls**: Close specific duplicate groups or individual tabs with dedicated close buttons
- **Pinned Tab Protection**: Pinned tabs are automatically excluded from duplicate detection
- **Flexible Options**: Choose to keep the newest or oldest duplicate
- **Match Mode Descriptions**: Dynamic descriptions explain each match mode as you select it

### 📁 Tab Organization
- **Group by Domain**: Organize tabs by their root domain
- **Reorder Tabs**: Automatically reorder tabs by domain for better organization
- **Scope Control**: Work with current window or all windows

### 💾 Session Management
- **Save Sessions**: Save your current tab configuration with a custom name
- **Restore Sessions**: Quickly restore previously saved sessions
- **Session History**: View all saved sessions with timestamps

### ⚙️ Customizable Match Modes

TabWrangler offers six different match modes to suit your needs:

1. **Exact URL** - Complete URL must match exactly
2. **Full Path** (default) - Host + port + path + query parameters
   - Perfect for self-hosted services with different paths/params
   - Example: `example.com:8080/app?user=1` ≠ `example.com:8080/app?user=2`
3. **Path Only** - Host + port + path (ignores query parameters)
   - Example: `example.com:8080/app?user=1` = `example.com:8080/app?user=2`
4. **Host + Port** - Matches hostname and port only
   - Perfect for self-hosted services
   - Example: `192.168.1.100:8080` ≠ `192.168.1.100:3000`
5. **Subdomain** - Exact subdomain match
   - Example: `app.example.com` ≠ `www.example.com`
6. **Domain Only** - Root domain match
   - Example: `app.example.com` = `www.example.com`

## Installation

### Requirements
- macOS 14.0 or later
- Safari 14.0 or later
- Xcode 15.0 or later (for building from source)

### Building from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/danielteeny/TabWrangler.git
   cd TabWrangler
   ```

2. Open the project in Xcode:
   ```bash
   open TabWrangler.xcodeproj
   ```

3. Build and run the project in Xcode (⌘R)

4. Enable the extension in Safari:
   - Open Safari Preferences (⌘,)
   - Go to the "Extensions" tab
   - Enable "TabWrangler"
   - Grant necessary permissions when prompted

## Usage

### Accessing TabWrangler

Click the TabWrangler icon in Safari's toolbar to open the popup interface.

### Finding Duplicates

The duplicate list automatically updates and displays in real-time. You can:

1. **View Duplicates**: Duplicate groups are automatically shown with count badges
2. **Expand Groups**: Click the ▶ button on any duplicate group to expand and see individual tabs within that group
   - Click the tab title to switch to that tab
   - Click the ✕ button on an individual tab to close just that tab
   - Click ▼ to collapse the group again
3. **Close Individual Groups**: Click the ✕ button on any duplicate group header to close all duplicates in that group (keeping one tab)
4. **Close All Duplicates**: Click **"Close Duplicates"** to remove all duplicates at once (keeping one tab per group)
5. **Refresh List**: Click **"Find Duplicates"** to manually refresh the duplicate list

### Organizing Tabs

- **Group by Domain**: Analyzes and groups tabs by domain (results shown in console)
- **Reorder by Domain**: Physically reorders tabs in the current window by domain

### Managing Sessions

1. **Save Session**: Click "Save Current Session" and enter a name
2. **Restore Session**: Click "Restore Session" and select from saved sessions

### Settings

All settings are accessible directly from the popup:

- **Match Mode**: Choose how duplicates are identified
  - Dynamic descriptions appear below the dropdown explaining each mode
  - Descriptions update automatically when you change the selection
- **Keep Newest**: When enabled, keeps the most recently opened duplicate
- **Auto-detect**: Automatically detect duplicates as you browse
- **Scope**: Choose to work with the current window or all windows

Settings are automatically saved when changed, and the duplicate list updates immediately.

## Project Structure

```
TabWrangler/
├── TabWrangler/                    # Main macOS app wrapper
│   ├── AppDelegate.swift          # App lifecycle management
│   ├── ViewController.swift       # Main view controller
│   └── Resources/                 # App resources
│
├── TabWrangler Extension/         # Safari extension
│   ├── SafariWebExtensionHandler.swift  # Native message handler
│   └── Resources/
│       ├── manifest.json          # Extension manifest
│       ├── background.js          # Background service worker
│       ├── popup/
│       │   ├── popup.html         # Popup UI
│       │   ├── popup.js           # Popup logic
│       │   └── popup.css          # Popup styles
│       ├── options/
│       │   ├── options.html       # Options page
│       │   └── options.js        # Options logic
│       └── utils/
│           └── tabUtils.js        # Tab matching utilities
│
└── TabWrangler.xcodeproj/         # Xcode project
```

## Technical Details

### Extension Architecture

- **Manifest V3**: Uses the latest Safari extension format
- **Background Service**: Monitors tab creation and updates
- **Storage**: Uses `browser.storage.sync` for settings and `browser.storage.local` for sessions
- **Permissions**: Requires `tabs` and `storage` permissions

### Key Features Implementation

#### IP Address Handling
- Properly detects IPv4, IPv6, and localhost
- Treats IP addresses as complete addresses (no incorrect grouping)
- Example: `192.168.1.100` and `192.168.2.100` are correctly treated as different

#### Port-Based Matching
- All match modes consider ports when matching
- Essential for self-hosted services running on different ports
- Default ports (80, 443) are handled correctly

#### Match Mode Logic
- `tabUtils.js` contains the core matching algorithms
- Supports complex URL parsing and comparison
- Handles edge cases like invalid URLs gracefully
- Dynamic descriptions help users understand each mode

#### User Interface Enhancements
- **Auto-Updating Duplicates**: Duplicate list updates automatically when tabs change
- **Visual Feedback**: Count badges show the number of duplicates in each group
- **Expandable Groups**: Click ▶/▼ to expand/collapse groups and view individual tabs
- **Tab Interaction**: Click tab titles to switch to tabs, or close individual tabs
- **Individual Controls**: Each duplicate group has its own close button, plus individual tab controls
- **XSS Protection**: URLs are properly escaped for safe display
- **Pinned Tab Filtering**: Pinned tabs are excluded from all operations
- **Improved Layout**: Scope selector moved to top for better workflow

## Development

### Code Structure

- **`background.js`**: Handles tab monitoring and duplicate detection
- **`popup.js`**: Manages UI interactions and user actions
- **`tabUtils.js`**: Core utility functions for tab matching and grouping
- **`popup.html`**: Main user interface
- **`popup.css`**: Styling for the popup interface

### Adding New Features

1. Extension logic: Edit files in `TabWrangler Extension/Resources/`
2. Native functionality: Edit `SafariWebExtensionHandler.swift`
3. UI changes: Modify `popup.html`, `popup.js`, and `popup.css`

### Testing

1. Build and run in Xcode
2. Test in Safari with the extension enabled
3. Use Safari's Web Inspector for debugging (Develop → Show Web Inspector)

## License

This project is open source. See the repository for license details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Author

Created by Daniel Teeny

## Support

For issues, feature requests, or questions, please open an issue on GitHub.

---

**Note**: This extension requires Safari 14.0+ and macOS 14.0+ due to Safari Web Extension API requirements.

