# Implementation Guide: Rules Manager (Folder/File Exclusions)

**Feature:** Allow users to exclude folders and files from sync
**Complexity:** Low
**Estimated Effort:** 2-3 hours
**Dependencies:** None

---

## Overview

Currently, users exclude individual tasks with `🚫`. This feature adds a settings-based exclusion system for entire folders or files, solving the case where a user has a file full of dated tasks they never want synced.

### User Stories

1. "I have a `Templates/` folder with task templates - I don't want those syncing"
2. "I have a `Journal/2025-01-08.md` file with tasks that are just for tracking, not reminders"
3. "My `Archive/` folder has old tasks I want to keep but not sync"

---

## Implementation Steps

### Step 1: Update Settings Interface

**File:** `main.ts` (ChronosSettings interface)

Add exclusion arrays to settings:

```typescript
interface ChronosSettings {
    // ... existing settings

    /** Folders to exclude from sync (e.g., "Templates", "Archive/Old") */
    excludedFolders: string[];

    /** Specific files to exclude from sync (e.g., "Tasks/reference.md") */
    excludedFiles: string[];
}
```

Add defaults:

```typescript
const DEFAULT_SETTINGS: ChronosSettings = {
    // ... existing defaults
    excludedFolders: [],
    excludedFiles: [],
};
```

---

### Step 2: Update Task Parser

**File:** `src/taskParser.ts`

Add exclusion checking to `scanVault()`:

```typescript
/**
 * Scan the entire vault for sync-eligible tasks
 * @param includeCompleted Whether to include completed tasks
 * @param excludedFolders Folders to skip (e.g., ["Templates", "Archive"])
 * @param excludedFiles Specific files to skip (e.g., ["Tasks/reference.md"])
 */
async scanVault(
    includeCompleted: boolean = false,
    excludedFolders: string[] = [],
    excludedFiles: string[] = []
): Promise<ChronosTask[]> {
    const tasks: ChronosTask[] = [];
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
        // Check folder exclusions
        if (this.isExcludedByFolder(file.path, excludedFolders)) {
            continue;
        }

        // Check file exclusions
        if (excludedFiles.includes(file.path)) {
            continue;
        }

        // Quick check: skip files that don't have any tasks
        if (!this.fileHasTasks(file)) {
            continue;
        }

        const fileTasks = await this.scanFile(file, includeCompleted);
        tasks.push(...fileTasks);
    }

    // ... rest of method
}

/**
 * Check if a file path is within an excluded folder
 */
private isExcludedByFolder(filePath: string, excludedFolders: string[]): boolean {
    for (const folder of excludedFolders) {
        // Normalize folder path (remove trailing slash if present)
        const normalizedFolder = folder.replace(/\/$/, '');

        // Check if file is in this folder or a subfolder
        if (filePath.startsWith(normalizedFolder + '/')) {
            return true;
        }
    }
    return false;
}
```

---

### Step 3: Update Sync Calls

**File:** `main.ts`

Update all calls to `scanVault()` to pass exclusion settings:

```typescript
// In syncTasks() and anywhere else scanVault is called:
const tasks = await this.taskParser.scanVault(
    false,  // includeCompleted
    this.settings.excludedFolders,
    this.settings.excludedFiles
);
```

---

### Step 4: Create Settings UI

**File:** `main.ts` (ChronosSettingTab class)

Add a new section for exclusion rules. Pattern this after the existing tag-to-calendar mappings UI.

```typescript
// ===== Exclusion Rules Section =====
containerEl.createEl('h3', { text: 'Exclusion Rules' });
containerEl.createEl('p', {
    text: 'Exclude folders or files from calendar sync. Tasks in excluded locations will be ignored even if they have dates.',
    cls: 'setting-item-description'
});

// --- Excluded Folders ---
new Setting(containerEl)
    .setName('Excluded folders')
    .setDesc('Folders to exclude (and all subfolders)');

// Render current exclusions
const folderListEl = containerEl.createDiv({ cls: 'chronos-exclusion-list' });
this.renderExcludedFolders(folderListEl);

// Add folder input
const addFolderContainer = containerEl.createDiv({ cls: 'chronos-add-exclusion' });
const folderInput = addFolderContainer.createEl('input', {
    type: 'text',
    placeholder: 'Folder path (e.g., Templates or Archive/Old)',
});
const addFolderBtn = addFolderContainer.createEl('button', { text: 'Add Folder' });

addFolderBtn.addEventListener('click', async () => {
    const folder = folderInput.value.trim();
    if (folder && !this.plugin.settings.excludedFolders.includes(folder)) {
        this.plugin.settings.excludedFolders.push(folder);
        await this.plugin.saveSettings();
        folderInput.value = '';
        this.renderExcludedFolders(folderListEl);
    }
});

// --- Excluded Files ---
// Similar pattern for individual files
new Setting(containerEl)
    .setName('Excluded files')
    .setDesc('Specific files to exclude');

const fileListEl = containerEl.createDiv({ cls: 'chronos-exclusion-list' });
this.renderExcludedFiles(fileListEl);

// Add file input with folder browser or autocomplete would be nice
// For MVP, just a text input
```

**Helper methods:**

```typescript
private renderExcludedFolders(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.excludedFolders.length === 0) {
        container.createEl('p', {
            text: 'No folders excluded',
            cls: 'chronos-exclusion-empty'
        });
        return;
    }

    for (const folder of this.plugin.settings.excludedFolders) {
        const row = container.createDiv({ cls: 'chronos-exclusion-row' });
        row.createSpan({ text: `📁 ${folder}` });

        const removeBtn = row.createEl('button', { text: '×', cls: 'chronos-remove-btn' });
        removeBtn.addEventListener('click', async () => {
            this.plugin.settings.excludedFolders =
                this.plugin.settings.excludedFolders.filter(f => f !== folder);
            await this.plugin.saveSettings();
            this.renderExcludedFolders(container);
        });
    }
}

private renderExcludedFiles(container: HTMLElement): void {
    // Similar to renderExcludedFolders but for files
    // Use 📄 icon instead of 📁
}
```

---

### Step 5: Add CSS Styles

**File:** `styles.css`

```css
/* Exclusion Rules UI */
.chronos-exclusion-list {
    margin: 10px 0;
    padding: 10px;
    background: var(--background-secondary);
    border-radius: 5px;
}

.chronos-exclusion-empty {
    color: var(--text-muted);
    font-style: italic;
    margin: 0;
}

.chronos-exclusion-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid var(--background-modifier-border);
}

.chronos-exclusion-row:last-child {
    border-bottom: none;
}

.chronos-add-exclusion {
    display: flex;
    gap: 10px;
    margin-top: 10px;
}

.chronos-add-exclusion input {
    flex: 1;
}

.chronos-remove-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 8px;
}

.chronos-remove-btn:hover {
    color: var(--text-error);
}
```

---

### Step 6: Update Documentation

**Files to update:**
- `Handoff Log.md` - Mention exclusion feature
- `README.md` - Add to feature list

---

## Testing Checklist

- [ ] Adding a folder excludes all files in that folder
- [ ] Adding a folder excludes files in subfolders
- [ ] Adding a specific file excludes only that file
- [ ] Removing an exclusion re-includes those tasks on next sync
- [ ] Exclusions persist after reload
- [ ] Empty exclusion lists work correctly
- [ ] Paths with spaces work correctly
- [ ] Task scan modal respects exclusions
- [ ] Status bar count reflects exclusions

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Folder doesn't exist | Allow it (user may create it later) |
| File doesn't exist | Allow it (user may create it later) |
| Duplicate entry | Prevent adding |
| Root folder "/" | Prevent (would exclude everything) |
| Trailing slashes | Normalize (remove) |

---

## Future Enhancements

- **Folder picker:** Use Obsidian's folder suggester for autocomplete
- **File picker:** Use file suggester for autocomplete
- **Glob patterns:** Support `Archive/**` or `*.template.md`
- **Include rules:** Flip the logic - only sync from specific folders
- **Per-folder calendar routing:** Combine with tag routing (folder → calendar)
