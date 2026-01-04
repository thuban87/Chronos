# GEMINI.md - Chronos

**Purpose:** Instructions for AI assistants working on the Chronos project.
**Last Updated:** January 3, 2026

---

## Creating Tasks for Google Calendar Sync

Chronos syncs Obsidian tasks to Google Calendar. When creating tasks for Brad that need calendar reminders, use this exact format:

### Task Format
```markdown
- [ ] Task description 📅 YYYY-MM-DD ⏰ HH:mm
```

### Examples
```markdown
- [ ] Call dentist 📅 2026-01-15 ⏰ 14:00
- [ ] Submit report 📅 2026-01-20 ⏰ 09:30
- [ ] Team meeting 📅 2026-01-10 ⏰ 15:00
```

### All-Day Events (no specific time)
```markdown
- [ ] Pay rent 📅 2026-02-01
- [ ] Birthday reminder 📅 2026-03-15
```

### Exclude from Calendar Sync
Add 🚫 to prevent syncing:
```markdown
- [ ] Personal note 📅 2026-01-15 🚫
```

### Key Rules
- **Date format:** `📅 YYYY-MM-DD` (required for sync)
- **Time format:** `⏰ HH:mm` (24-hour, optional - omit for all-day events)
- **Checkbox:** Must be unchecked `- [ ]` to sync
- **No-sync:** Add `🚫` emoji to exclude from calendar

Tasks without the 📅 emoji will NOT sync to Google Calendar.

---

## What Is Chronos?

Chronos is an Obsidian plugin that syncs tasks with Google Calendar. It parses tasks with dates/times from Obsidian notes and creates calendar events with reminders.

**Core Value:** Reliable reminders that work even when Obsidian is closed, across all devices.

---

## Project Info

- **GitHub:** https://github.com/thuban87/Chronos
- **Source:** `C:\Users\bwales\projects\obsidian-plugins\chronos\`
- **Deploy:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\`

For development documentation, see CLAUDE.md and the docs/ folder.
