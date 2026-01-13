# Multi-PC Sync - Implementation Guide

**Created:** January 12, 2026  
**Status:** PLANNED  
**Phase:** 19  
**Branch:** `fix/multi-pc-sync`

---

## Overview

### The Problem

When using Chronos across multiple machines with cloud-synced vaults, sync conflicts can occur:

1. **Machine A** syncs a task → creates event → updates `data.json`
2. **Machine B** (offline or slow cloud sync) has stale `data.json`
3. **Machine B** syncs the same task → creates duplicate event
4. **Both machines** may show orphan prompts for the other's changes

Currently, `data.json` acts as both "what I last synced" (Base) and "current state" (Remote), making conflict detection impossible.

### The Solution: 3-Way Merge

Implement the classic 3-way merge pattern:

| State | Where Stored | Description |
|-------|--------------|-------------|
| **Base** | `localStorage` (local to machine) | "What I last synced" |
| **Remote** | `data.json` (cloud synced) | "What data.json currently says" |
| **Local** | Markdown files | "What the task currently looks like" |

**Conflict Detection:**
- If `Base == Remote` → No external changes, proceed normally
- If `Base != Remote` AND `Base == Local` → Remote changed, adopt remote
- If `Base != Remote` AND `Base != Local` → **CONFLICT** (both changed)

**Resolution:** Last-write-wins using timestamps, with conflict logging.

---

## Implementation Phases

### Phase 1: Machine Identity

**Goal:** Generate a unique ID for each machine to track "who made this change."

**Files to Modify:** `main.ts`

**Implementation:**

```typescript
// In ChronosPlugin class
private machineId: string = '';

// In onload() - early, before any sync
async onload() {
    await this.loadSettings();
    this.initializeMachineId();
    // ... rest of onload
}

private initializeMachineId(): void {
    const storageKey = 'chronos-machine-id';
    let machineId = window.localStorage.getItem(storageKey);
    
    if (!machineId) {
        // Generate new UUID for this machine
        machineId = crypto.randomUUID();
        window.localStorage.setItem(storageKey, machineId);
        console.log('Chronos: Generated new machine ID:', machineId);
    }
    
    this.machineId = machineId;
}
```

**Testing:**
- Verify machine ID is generated on first run
- Verify machine ID persists across reloads
- Verify different machines get different IDs

---

### Phase 2: Sync Record Versioning

**Goal:** Track version, timestamp, and source machine for each sync record.

**Files to Modify:** `src/syncManager.ts`

**Update SyncedTaskInfo interface:**

```typescript
export interface SyncedTaskInfo {
    // ... existing fields ...
    
    /** Version number, incremented on each change */
    version: number;
    /** Machine ID that last modified this record */
    lastModifiedBy: string;
    /** ISO timestamp of last modification */
    lastModifiedAt: string;
}
```

**Update recordSync() method:**

```typescript
recordSync(task: ChronosTask, eventId: string, calendarId: string, machineId: string): void {
    const taskId = this.generateTaskId(task);
    const contentHash = this.generateContentHash(task);
    
    const existing = this.syncData.syncedTasks[taskId];
    const newVersion = existing ? (existing.version || 0) + 1 : 1;

    this.syncData.syncedTasks[taskId] = {
        eventId,
        contentHash,
        calendarId,
        lastSyncedAt: new Date().toISOString(),
        filePath: task.filePath,
        lineNumber: task.lineNumber,
        title: task.title,
        date: task.date,
        time: task.time,
        tags: task.tags,
        isRecurring: !!task.recurrenceRule,
        recurrenceRule: task.recurrenceRule || undefined,
        // New versioning fields
        version: newVersion,
        lastModifiedBy: machineId,
        lastModifiedAt: new Date().toISOString(),
    };
}
```

**Update all callers** to pass `machineId`:
- `main.ts` line ~1306: `this.syncManager.recordSync(op.task, result.body.id, op.calendarId, this.machineId);`
- Continue for all other `recordSync()` calls

**Migration:** Existing records without version fields will be treated as version 0.

---

### Phase 3: Local Base State Cache

**Goal:** Store "what I last synced" in localStorage so we can detect when Remote has diverged.

**Files to Modify:** `src/syncManager.ts`, `main.ts`

**New interface:**

```typescript
// In syncManager.ts
export interface LocalSyncCache {
    machineId: string;
    /** Last time we successfully synced (for stale detection) */
    lastSyncAt: string;
    /** Snapshot of sync records as we last knew them */
    baseStates: Record<string, {
        contentHash: string;
        eventId: string;
        version: number;
        lastModifiedAt: string;
        lastModifiedBy: string;
    }>;
}
```

**Storage key:** `chronos-local-sync-cache`

**New methods in SyncManager:**

```typescript
// Load base state from localStorage
loadLocalCache(): LocalSyncCache | null {
    const data = window.localStorage.getItem('chronos-local-sync-cache');
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

// Save current state as new base
saveLocalCache(machineId: string): void {
    const cache: LocalSyncCache = {
        machineId,
        lastSyncAt: new Date().toISOString(),
        baseStates: {},
    };
    
    for (const [taskId, info] of Object.entries(this.syncData.syncedTasks)) {
        cache.baseStates[taskId] = {
            contentHash: info.contentHash,
            eventId: info.eventId,
            version: info.version || 0,
            lastModifiedAt: info.lastModifiedAt || '',
            lastModifiedBy: info.lastModifiedBy || '',
        };
    }
    
    window.localStorage.setItem('chronos-local-sync-cache', JSON.stringify(cache));
}
```

**When to save:** At the END of a successful sync, after all operations complete.

---

### Phase 4: Conflict Detection

**Goal:** Before sync, compare Base vs Remote vs Local to detect conflicts.

**Files to Modify:** `src/syncManager.ts`

**New method:**

```typescript
interface SyncConflict {
    taskId: string;
    taskTitle: string;
    type: 'both-modified' | 'remote-deleted' | 'local-deleted';
    baseVersion: number;
    remoteVersion: number;
    localContentHash: string;
    remoteContentHash: string;
    baseContentHash: string;
    remoteModifiedAt: string;
    remoteModifiedBy: string;
}

detectConflicts(
    currentTasks: ChronosTask[],
    localCache: LocalSyncCache | null
): SyncConflict[] {
    const conflicts: SyncConflict[] = [];
    
    if (!localCache) {
        // First sync on this machine, no conflicts possible
        return [];
    }
    
    // Build map of current task content hashes
    const currentTaskMap = new Map<string, ChronosTask>();
    for (const task of currentTasks) {
        const taskId = this.generateTaskId(task);
        currentTaskMap.set(taskId, task);
    }
    
    // Check each known sync record
    for (const [taskId, baseState] of Object.entries(localCache.baseStates)) {
        const remote = this.syncData.syncedTasks[taskId];
        const local = currentTaskMap.get(taskId);
        
        if (!remote) {
            // Remote deleted this record (another machine deleted/completed)
            if (local) {
                conflicts.push({
                    taskId,
                    taskTitle: local.title,
                    type: 'remote-deleted',
                    baseVersion: baseState.version,
                    remoteVersion: 0,
                    localContentHash: this.generateContentHash(local),
                    remoteContentHash: '',
                    baseContentHash: baseState.contentHash,
                    remoteModifiedAt: '',
                    remoteModifiedBy: '',
                });
            }
            continue;
        }
        
        // Check if remote changed since our base
        const remoteChanged = (remote.version || 0) > baseState.version;
        
        if (!local) {
            // Local deleted (completed/removed) but remote may have changed
            if (remoteChanged) {
                conflicts.push({
                    taskId,
                    taskTitle: remote.title || 'Unknown',
                    type: 'local-deleted',
                    baseVersion: baseState.version,
                    remoteVersion: remote.version || 0,
                    localContentHash: '',
                    remoteContentHash: remote.contentHash,
                    baseContentHash: baseState.contentHash,
                    remoteModifiedAt: remote.lastModifiedAt || '',
                    remoteModifiedBy: remote.lastModifiedBy || '',
                });
            }
            continue;
        }
        
        // Both exist - check for concurrent modifications
        const localContentHash = this.generateContentHash(local);
        const localChanged = localContentHash !== baseState.contentHash;
        
        if (remoteChanged && localChanged) {
            // CONFLICT: Both sides modified since base
            conflicts.push({
                taskId,
                taskTitle: local.title,
                type: 'both-modified',
                baseVersion: baseState.version,
                remoteVersion: remote.version || 0,
                localContentHash,
                remoteContentHash: remote.contentHash,
                baseContentHash: baseState.contentHash,
                remoteModifiedAt: remote.lastModifiedAt || '',
                remoteModifiedBy: remote.lastModifiedBy || '',
            });
        }
    }
    
    return conflicts;
}
```

---

### Phase 5: Conflict Resolution (Last-Write-Wins)

**Goal:** Auto-resolve conflicts using timestamps, log for debugging.

**Files to Modify:** `src/syncManager.ts`, `main.ts`

**Resolution logic in syncTasks():**

```typescript
// In syncTasks(), before computing diff:
const localCache = this.syncManager.loadLocalCache();
const conflicts = this.syncManager.detectConflicts(uncompletedTasks, localCache);

if (conflicts.length > 0) {
    for (const conflict of conflicts) {
        const resolution = this.resolveConflict(conflict, localCache);
        // Log the conflict and resolution
        this.syncManager.logOperation({
            type: 'conflict',
            taskTitle: conflict.taskTitle,
            success: true,
            batchId,
            errorMessage: `Conflict resolved: ${resolution.winner} wins`,
        }, batchId);
        
        // Apply resolution
        if (resolution.action === 'adopt-remote') {
            // Remote wins - local changes will be overwritten
            // No action needed, diff will see task as "unchanged" since remote is newer
        } else if (resolution.action === 'keep-local') {
            // Local wins - will create update operation
            // No action needed, normal sync flow handles it
        }
    }
}

// ... continue with normal sync ...
```

**Resolution method:**

```typescript
private resolveConflict(conflict: SyncConflict, localCache: LocalSyncCache | null): { winner: 'local' | 'remote'; action: 'keep-local' | 'adopt-remote' } {
    // Last-write-wins: compare timestamps
    const localModifiedAt = new Date().toISOString(); // Current local state
    const remoteModifiedAt = conflict.remoteModifiedAt;
    
    if (!remoteModifiedAt || localModifiedAt > remoteModifiedAt) {
        return { winner: 'local', action: 'keep-local' };
    } else {
        return { winner: 'remote', action: 'adopt-remote' };
    }
}
```

---

### Phase 6 (Optional): Conflict UI

If you want manual override capability in edge cases.

**Files:** New `src/conflictReviewModal.ts`

**When to show:** Only when `conflicts.length > 0` and user setting enables manual review.

**For MVP:** Skip this phase. Last-write-wins is sufficient.

---

## Testing Checklist

### Phase 1: Machine Identity
- [ ] First run generates UUID
- [ ] UUID persists in localStorage across reloads
- [ ] Different browsers/machines get different IDs

### Phase 2: Versioning
- [ ] New sync records get version=1
- [ ] Updated records increment version
- [ ] lastModifiedBy contains machine ID
- [ ] lastModifiedAt is ISO timestamp

### Phase 3: Local Cache
- [ ] Cache saved at end of successful sync
- [ ] Cache loads correctly on startup
- [ ] Cache contains snapshot of all sync records

### Phase 4: Conflict Detection
- [ ] No conflicts on first sync (no base state)
- [ ] Remote-only change: no conflict, adopt remote
- [ ] Local-only change: no conflict, keep local
- [ ] Both changed: conflict detected

### Phase 5: Resolution
- [ ] Newer timestamp wins
- [ ] Conflicts logged to sync history
- [ ] Resolved conflicts don't cause duplicates

### Multi-PC Scenarios
- [ ] Machine A syncs, Machine B syncs later → no conflict
- [ ] Both machines sync simultaneously → last-write-wins
- [ ] Machine offline for hours, then syncs → adopts remote changes

---

## Migration Notes

- Existing sync records will have `version: undefined`, treated as version 0
- First sync after upgrade will populate versioning fields
- No user action required

---

## Estimated Effort

| Phase | Time |
|-------|------|
| Phase 1: Machine Identity | 30 min |
| Phase 2: Versioning | 1-2 hours |
| Phase 3: Local Cache | 1-2 hours |
| Phase 4: Conflict Detection | 2-3 hours |
| Phase 5: Resolution | 1-2 hours |
| Testing | 2-3 hours |
| **Total** | **~8-12 hours** |

---

## References

- **ADR Priority List:** `docs/ADR Priority List - Chronos.md`
- **Handoff Log:** `docs/Handoff Log.md`
- **SyncManager:** `src/syncManager.ts`
- **Main plugin:** `main.ts`
