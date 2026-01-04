# Chronos - Google Calendar Sync for Obsidian

Chronos syncs your Obsidian tasks with Google Calendar, giving you reliable reminders that work across all your devices - even when Obsidian is closed.

## Features

- **One-way sync** from Obsidian to Google Calendar
- **Automatic sync** on a configurable interval (default: 10 minutes)
- **Manual sync** via command palette or status bar click
- **All-day events** for tasks without a time
- **Timed events** with customizable duration and reminders
- **Duplicate prevention** - smart tracking prevents re-creating events
- **Change detection** - editing a task updates the calendar event
- **Completion handling** - choose to delete or mark events when tasks are completed
- **Offline queue** - failed syncs are automatically retried
- **No-sync marker** - exclude specific tasks with the `🚫` emoji

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Settings → Community plugins
2. Search for "Chronos"
3. Click Install, then Enable

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/thuban87/Chronos/releases)
2. Extract to your vault's `.obsidian/plugins/chronos/` folder
3. Enable the plugin in Settings → Community plugins

## Setup

### 1. Connect to Google Calendar

1. Go to Settings → Chronos
2. Click **Connect** under "Google Calendar Connection"
3. Sign in with your Google account and grant calendar access
4. Select your target calendar from the dropdown

### 2. Configure Sync Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Sync interval | How often to auto-sync (minutes) | 10 |
| Default event duration | Length of timed events (minutes) | 30 |
| Default reminders | Comma-separated minutes before event | 30, 10 |
| When task is completed | Delete event or mark as completed | Mark as completed |

## Task Format

Chronos uses the [Tasks plugin](https://publish.obsidian.md/tasks/) format with a Chronos-specific time marker:

```markdown
- [ ] Task with date and time 📅 2026-01-15 ⏰ 14:00
- [ ] All-day task (no time) 📅 2026-01-15
- [ ] Excluded from sync 📅 2026-01-15 🚫
```

### Required Elements

- **Checkbox**: `- [ ]` for uncompleted tasks
- **Date**: `📅 YYYY-MM-DD` format

### Optional Elements

- **Time**: `⏰ HH:mm` format (24-hour) - without this, creates an all-day event
- **No-sync**: `🚫` emoji excludes the task from syncing

## Commands

Access via Command Palette (`Ctrl/Cmd + P`):

| Command | Description |
|---------|-------------|
| Chronos: Sync tasks to Google Calendar now | Manually trigger a sync |
| Chronos: Scan vault for sync-eligible tasks | View all tasks that will be synced |
| Chronos: Insert date/time for task | Open modal to insert date/time markers |

## Status Bar

The status bar shows:
- Number of synced tasks
- Number of pending operations (if any failed)
- Time since last sync

**Click the status bar** to trigger an immediate sync.

## How Syncing Works

### Creating Events
- Tasks with `📅` dates are synced as calendar events
- Tasks with `⏰` times become timed events
- Tasks without times become all-day events

### Updating Events
- When you edit a task (change time, title, etc.), the calendar event is updated on next sync
- Moving a task to a different line doesn't affect sync tracking

### Completing Tasks
- When you check off a task (`- [x]`), Chronos handles the calendar event based on your setting:
  - **Mark as completed**: Appends "- Completed MM-DD-YYYY, HH:mm" to the event title
  - **Delete from calendar**: Removes the event entirely

### Deleting Tasks
- If you delete a task line from your notes, the corresponding calendar event is deleted

### Externally Deleted Events
- If you delete an event directly in Google Calendar, Chronos will recreate it on next sync
- This ensures your tasks always have reminders

## Offline Handling

If sync fails due to network issues:
1. Failed operations are queued automatically
2. They're retried on the next sync
3. After 5 failed attempts, operations are dropped
4. The status bar shows pending operations count

## Troubleshooting

### "Not connected" error
Go to Settings → Chronos and click Connect to authenticate with Google.

### Events not appearing
1. Check that tasks have the `📅` date marker
2. Ensure tasks are uncompleted (`- [ ]`)
3. Check for `🚫` no-sync marker
4. Verify the correct calendar is selected in settings

### Duplicate events
This shouldn't happen with normal use. If it does:
1. Delete duplicates in Google Calendar
2. The next sync will detect existing events

### Session expired
Google tokens expire periodically. When this happens:
1. You'll see a "Session expired" message
2. Go to Settings → Chronos
3. Click Disconnect, then Connect again

## Privacy & Security

- **Tokens stored locally**: Your Google credentials are stored only in your vault's plugin data
- **No external servers**: Chronos communicates directly with Google Calendar API
- **Minimal permissions**: Only requests access to calendar events, not your full Google account

## Support

- **Issues**: [GitHub Issues](https://github.com/thuban87/Chronos/issues)
- **Documentation**: [GitHub Wiki](https://github.com/thuban87/Chronos/wiki)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Created by Brad Wales with assistance from Claude AI.

Inspired by the need for reliable task reminders that work across all devices.
