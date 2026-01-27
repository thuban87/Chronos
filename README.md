# Chronos - Google Calendar Sync for Obsidian

Chronos syncs your Obsidian tasks with Google Calendar, giving you reliable reminders that work across all your devices - even when Obsidian is closed.

## Features

- **One-way sync** from Obsidian to Google Calendar
- **Automatic sync** on a configurable interval (default: 10 minutes)
- **Manual sync** via command palette or status bar click
- **All-day events** for tasks without a time
- **Timed events** with customizable duration and reminders
- **Multi-calendar support** - route tasks to different calendars using tags
- **Safety Net** - deletion protection requires your approval before removing events
- **Duplicate prevention** - smart tracking prevents re-creating events
- **Change detection** - editing a task updates the calendar event
- **Completion handling** - choose to delete or mark events when tasks are completed
- **Offline queue** - failed syncs are automatically retried
- **No-sync marker** - exclude specific tasks with the `🚫` emoji
- **Custom reminders** - override default reminders per task with `🔔` syntax

## Installation

### Current Status: Beta

Chronos is currently in beta/development mode. We're polishing features and testing end-to-end to ensure everything works perfectly before submitting to the official Obsidian Community Plugins store.

### Install via BRAT (Recommended for Testing)

The easiest way to test Chronos is using the BRAT plugin:

1. Install the **BRAT** plugin from Obsidian's Community Plugins (search for "Obsidian42 - BRAT")
2. Enable BRAT in your plugin settings
3. Open the command palette (`Ctrl/Cmd + P`) and run: **BRAT: Add a beta plugin for testing**
4. Paste this repository URL: `https://github.com/thuban87/Chronos`
5. Click **Add Plugin** and wait for installation to complete
6. Go to Settings → Community Plugins, find Chronos, and enable it

BRAT will automatically check for updates and keep your plugin current.

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/thuban87/Chronos/releases)
2. Extract to your vault's `.obsidian/plugins/chronos/` folder
3. Enable the plugin in Settings → Community plugins

## Setup

Chronos requires you to create your own Google Cloud credentials. This keeps your data private and ensures you're never affected by API quotas from other users.

**Don't worry** - Google Cloud is free for personal use. No credit card required. Setup takes about 5 minutes.

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown (top-left) → **New Project**
3. Name it something like "Chronos" or "Obsidian Calendar"
4. Click **Create**

### 2. Enable the Google Calendar API

1. In your new project, go to **APIs & Services → Library**
2. Search for "Google Calendar API"
3. Click on it, then click **Enable**

### 3. Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** user type, click **Create**
3. Fill in the required fields:
   - App name: "Chronos" (or anything you like)
   - User support email: Your email
   - Developer contact: Your email
4. Click **Save and Continue** through the remaining steps (Scopes, Test Users, Summary)
5. On the **Test Users** page, click **Add Users** and add your own email address

> **Note**: Your app will be in "Testing" mode, which is fine for personal use. Only the email addresses you add as test users can authenticate.

### 4. Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Name: "Chronos" (or anything you like)
5. Click **Create**
6. You'll see your **Client ID** and **Client Secret** - copy these!

### 5. Configure Chronos

1. In Obsidian, go to **Settings → Chronos**
2. Paste your **Client ID** and **Client Secret** in the credentials fields
3. Click **Connect** and sign in with your Google account
4. Select your target calendar from the dropdown

You're all set! Your tasks will now sync to Google Calendar.

> [!CAUTION]
> **Protect Your Authentication Tokens**
> 
> Don't sync your `.obsidian/plugins/chronos/data.json` file to public repositories. It contains your Google auth tokens.
> 
> If you version control your vault, add this to your `.gitignore`:
> ```
> .obsidian/plugins/chronos/data.json
> ```

### 6. Publish Your App (Recommended)

By default, your Google Cloud app is in **Testing mode**, which causes OAuth tokens to expire every 7 days. This means you'd need to re-authenticate weekly. To avoid this:

1. Go to **APIs & Services → OAuth consent screen**
2. Click the **PUBLISH APP** button near the top
3. A warning will appear about verification - click **CONFIRM**

Your app is now in **Production** mode. Tokens will persist properly and you won't need to re-authenticate.

> [!TIP]
> **Verification is NOT required**
> 
> Google may prompt you to "verify" your app - you can safely ignore this. Verification is only needed for apps with many users or sensitive scopes. For personal use, publishing without verification works perfectly.

> [!NOTE]
> **About the "Unverified App" Warning**
> 
> Since your app isn't verified by Google, users will see a warning screen during their first authentication. This is normal for personal apps:
> 1. Click **Advanced**
> 2. Click **Go to [Your App Name] (unsafe)**
> 3. Continue with authorization
> 
> You only see this once. Since you control both the app and your Google account, this is perfectly safe.

### 7. Configure Sync Settings (Optional)

| Setting | Description | Default |
|---------|-------------|---------|
| Sync interval | How often to auto-sync (minutes) | 10 |
| Default event duration | Length of timed events (minutes) | 30 |
| Default reminders | Comma-separated minutes before event | 30, 10 |
| When task is completed | Delete event or mark as completed | Mark as completed |

## Task Format

Chronos uses a syntax similar to the [Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) for convenience if you use both plugins. However, **Chronos does not require Tasks to be installed** - it works completely standalone with its own symbols.

The easiest way to format tasks is using the command **"Chronos: Insert date/time for task"** (Ctrl/Cmd + P). You can also set this command to a custom hotkey in Settings for quick access.

> **Note**: For recurring events (🔁), you **must** have the Tasks plugin installed and configured to create new tasks BELOW completed tasks (not above) in Settings → Tasks → "New task location". This allows Chronos to integrate with Tasks' recurrence handling logic.

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
- **Duration**: `⏱️ 2h`, `⏱️ 30m`, `⏱️ 1h30m` - custom event duration (overrides default)
- **Custom Reminders**: `🔔 60,30,10` - reminder minutes before event (comma-separated)
- **Recurrence**: `🔁 every week`, `🔁 every monday, wednesday, friday` - requires Tasks plugin installed
- **No-sync**: `🚫` emoji excludes the task from syncing

## Commands

Access via Command Palette (`Ctrl/Cmd + P`):

| Command | Description |
|---------|-------------|
| Chronos: Sync tasks to Google Calendar now | Manually trigger a sync |
| Chronos: Scan vault for sync-eligible tasks | View all tasks that will be synced |
| Chronos: Insert date/time for task | Open modal to insert date/time markers |
| Chronos: Toggle today's agenda sidebar | Open/close the agenda sidebar |
| Chronos: Import agenda to current file | Insert today's agenda (or agenda date) into the active note |
| Chronos: Review pending deletions | Review and approve/reject pending event deletions |
| Chronos: Review disconnected events | Review events moved/deleted in Google Calendar |
| Chronos: View sync history | View sync log and recently deleted events |

## Status Bar

The status bar shows:
- Number of synced tasks
- Number of pending operations (if any failed)
- Time since last sync

**Click the status bar** to trigger an immediate sync.

## How Syncing Works

### Creating Events
- Tasks with `📅` dates are synced as calendar events
- Tasks with `⏰` times become timed events with configurable duration
- Tasks without times become all-day events
- Events are created in batches for improved performance (up to 50 per batch request)

### Updating Events
- When you edit a task (change time, title, date, etc.), Chronos detects the change and updates the calendar event
- Two-pass reconciliation system ensures edits are detected even when tasks move between files or lines
- User-edited data in Google Calendar (description, location, attendees) is preserved during updates
- Moving a task to a different line or file doesn't affect sync tracking

### Completing Tasks
- When you check off a task (`- [x]`), Chronos handles the calendar event based on your setting:
  - **Mark as completed**: Appends "- Completed MM-DD-YYYY, HH:mm" to the event title
  - **Delete from calendar**: Removes the event (Safety Net applies if enabled)
- **Recurring tasks**: When enabled, Chronos detects successor tasks and migrates the calendar event instead of creating duplicates

### Deleting Tasks
- If you delete a task line from your notes and have **Safety Net enabled** (default), the deletion is queued for your review
- With Safety Net disabled, the corresponding calendar event is deleted immediately

### Multi-Calendar Routing
- Tasks with mapped tags (e.g., `#work`) route to their designated calendars
- Three routing modes when calendars change: Preserve (move event), Keep Both (duplicate), Fresh Start (delete + create)
- All routing operations respect Safety Net settings

### Batch Operations
- All sync operations (create, update, delete) are batched for efficiency
- Up to 50 operations per batch request dramatically improves sync speed
- Large syncs complete in 2-5 seconds instead of 30-50 seconds

### Externally Moved/Deleted Events
- If you move or delete an event in Google Calendar, behavior depends on your External Event Handling setting
- Default: You'll be asked what to do (sever or recreate)
- See the [External Event Handling](#external-event-handling) section for details

## Safety Net

Safety Net protects against accidental data loss by requiring your approval before Chronos deletes any calendar events. This is enabled by default.

### How It Works

When Chronos detects it needs to delete an event (e.g., you deleted a task line), it doesn't delete immediately. Instead:

1. The event is added to a **pending deletions queue**
2. A counter appears in the status bar showing pending items
3. Click the counter to review and approve/reject each deletion

### What Triggers the Safety Net

- **Deleted task lines**: When you delete a task from your notes
- **Calendar rerouting**: When using Fresh Start mode and a task moves to a different calendar

### Review Modal Options

For each pending deletion, you can:
- **Delete Event**: Confirm the deletion
- **Keep Event**: Keep the calendar event, stop tracking the task
- **Restore**: Copy the original task line to paste back into your notes

### Power User Mode

Experienced users can disable Safety Net in Settings → Chronos → Safety Net. In Power User mode, deletions happen immediately without confirmation.

### Recently Deleted

View Sync History to see recently deleted events (last 30 days). You can restore events by creating new ones from saved snapshots.

> **Note**: Restored events are new - they won't have the same ID, and attendees would need to be re-invited.

For detailed documentation, see [docs/SAFETY-NET.md](docs/SAFETY-NET.md).

## External Event Handling

When you move or delete an event directly in Google Calendar, Chronos needs to know what to do the next time it syncs. By default, it would recreate the event - but what if you moved it intentionally?

### Settings

In **Settings → Chronos → External Event Handling**, choose how Chronos handles events it can't find:

| Option | Behavior |
|--------|----------|
| **Ask me each time** (default) | Queue for review, you decide per-event |
| **Sever link** | Stop tracking the task, don't recreate |
| **Recreate event** | Assume deletion was accidental, recreate |

### How It Works

1. Chronos syncs and can't find an expected event (404)
2. Based on your setting:
   - **Ask**: Event is queued for review, status bar shows count
   - **Sever**: Task is "severed" - won't sync again unless you edit it
   - **Recreate**: Event is recreated on the original calendar

### Review Modal

When using "Ask me each time", click the status bar indicator to review disconnected events:

- **Sever Link**: Stop tracking this task (it won't sync unless edited)
- **Recreate Event**: Create a new event on the original calendar
- **Sever All / Recreate All**: Batch operations

### Recovery

Severed tasks can sync again if you edit the task's title, date, or time in your notes. This creates a new event - it won't reconnect to the moved one.

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

- **Your own credentials**: You create and control your own Google Cloud project
- **Tokens stored locally**: Your Google auth tokens are stored only in your vault's plugin data
- **No external servers**: Chronos communicates directly with Google Calendar API
- **No shared quotas**: Your API usage is completely separate from other users
- **Minimal permissions**: Only requests access to calendar events, not your full Google account
- **Deletion protection**: No calendar events are deleted unless you explicitly approve (Safety Net) or disable it in settings

> [!CAUTION]
> **Protect Your Authentication Tokens**
> 
> Don't sync your `.obsidian/plugins/chronos/data.json` file to public repositories. It contains your Google auth tokens.
> 
> If you version control your vault, add this to your `.gitignore`:
> ```
> .obsidian/plugins/chronos/data.json
> ```

## Support

- **Issues**: [GitHub Issues](https://github.com/thuban87/Chronos/issues)
- **Documentation**: [GitHub Wiki](https://github.com/thuban87/Chronos/wiki)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Created by Brad Wales.

Built with inspiration from the excellent [Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks) - thank you for building a fantastic foundation for task management in Obsidian!

Check out my other Obsidian plugin: [tagforge](https://github.com/thuban87/tagforge) - Smart tag management and navigation for your vault.
