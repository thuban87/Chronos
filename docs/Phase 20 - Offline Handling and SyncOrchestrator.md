# Phase 20: Offline Handling + SyncOrchestrator Refactoring

**Created:** January 16, 2026  
**Status:** APPROVED - Ready for Implementation  
**Priority:** HIGH  
**Branch:** `feature/sync-orchestrator`

---

## Overview

This phase implements two interconnected improvements:
1. **Offline Handling**: localStorage-based queue persistence with infinite retry
2. **SyncOrchestrator Refactoring**: Move sync logic from main.ts to dedicated class

---

## localStorage Security Analysis

### Question: Is localStorage Safe for Offline Queue?

**YES** - localStorage is appropriate for this specific use case.

### Security Context

**What We're Storing**: Failed sync operations (task info, eventId, operation type)
- **NOT** storing: Google auth tokens (those stay in data.json)
- **NOT** storing: Sensitive user data beyond task titles/dates
- **Data Type**: Temporary operational queue, not permanent credentials

### Security Characteristics

| Aspect | Risk Level | Mitigation |
|--------|-----------|------------|
| **XSS Access** | Low | Obsidian plugins run in trusted context, not web browser |
| **Plain Text** | Medium | Only task metadata, not auth tokens |
| **Persistence** | Low | Queue data is transient, cleared on success |
| **Access Control** | Low | Scoped to this plugin only |

### Why localStorage is Safe Here

1. **Obsidian is a Desktop App**: Not a web browser with XSS vulnerabilities
2. **Plugin Trust Model**: Users explicitly enable plugins with full system access
3. **Data Type**: Task titles are already in plain text markdown files
4. **Separation of Concerns**:
   - **data.json**: Auth tokens, sync records (cloud-synced)
   - **localStorage**: Machine-specific offline queue (local only)

### What This DOESN'T Store

- ❌ Google OAuth tokens
- ❌ Google API credentials  
- ❌ User passwords
- ❌ Personal identification

### What This DOES Store

- ✅ Task titles (already in markdown files)
- ✅ Task dates/times (already in markdown files)
- ✅ Operation types (create/update/delete)
- ✅ Retry counts
- ✅ Machine UUID

**Verdict**: localStorage is appropriate for offline queue. No additional security measures needed.

---

## Implementation Plan

### Part 1: Offline Queue Persistence (Simple, Non-Breaking)

**Estimated Time**: 2-3 hours  
**Complexity**: Low  
**Breaking Changes**: None

#### Files to Modify

`src/syncManager.ts` - Add localStorage methods

#### New Interface

```typescript
// Add to src/syncManager.ts interfaces section
export interface LocalOfflineQueue {
    machineId: string;
    operations: PendingOperation[];
    lastUpdatedAt: string;
}
```

#### New Methods in SyncManager Class

```typescript
/**
 * Load offline queue from localStorage
 * Called during plugin initialization
 */
loadOfflineQueue(): PendingOperation[] {
    const data = window.localStorage.getItem('chronos-offline-queue');
    if (!data) return [];
    
    try {
        const queue: LocalOfflineQueue = JSON.parse(data);
        
        // Validate machineId matches current machine
        const storedMachineId = window.localStorage.getItem('chronos-machine-id');
        if (queue.machineId !== storedMachineId) {
            console.warn('Chronos: Offline queue from different machine, clearing');
            return [];
        }
        
        console.log(`Chronos: Loaded ${queue.operations.length} pending operations from localStorage`);
        return queue.operations;
    } catch (error) {
        console.error('Chronos: Failed to load offline queue:', error);
        return [];
    }
}

/**
 * Save current pending operations to localStorage
 * Called after every sync attempt (success or failure)
 */
saveOfflineQueue(machineId: string): void {
    const queue: LocalOfflineQueue = {
        machineId,
        operations: this.syncData.pendingOperations,
        lastUpdatedAt: new Date().toISOString(),
    };
    
    window.localStorage.setItem('chronos-offline-queue', JSON.stringify(queue));
    console.log(`Chronos: Saved ${queue.operations.length} pending operations to localStorage`);
}

/**
 * Clear offline queue (all operations succeeded)
 */
clearOfflineQueue(): void {
    window.localStorage.removeItem('chronos-offline-queue');
    console.log('Chronos: Cleared offline queue');
}
```

#### Integration Points

**In `main.ts` onload()** - Load queue on plugin start (around line 113):
```typescript
async onload() {
    // ... existing code ...
    
    // Load offline queue from localStorage
    const offlineQueue = this.syncManager.loadOfflineQueue();
    if (offlineQueue.length > 0) {
        // Restore queue to syncManager
        const syncData = this.syncManager.getSyncData();
        syncData.pendingOperations.push(...offlineQueue);
        console.log(`Chronos: Restored ${offlineQueue.length} operations from offline queue`);
    }
    
    // ... rest of onload ...
}
```

**In `main.ts` syncTasks()** - Save queue after sync (around line 1700):
```typescript
async syncTasks() {
    // ... all existing sync logic ...
    
    // Save/clear offline queue based on pending operation count
    const pendingCount = this.syncManager.getPendingOperationCount();
    if (pendingCount > 0) {
        this.syncManager.saveOfflineQueue(this.machineId);
    } else {
        this.syncManager.clearOfflineQueue();
    }
    
    this.updateStatusBar();
}
```

#### Testing Checklist

- [ ] Disconnect internet
- [ ] Create/edit tasks to generate failed operations
- [ ] Verify status bar shows pending operations
- [ ] Restart Obsidian (Ctrl+P → "Reload app without saving")
- [ ] Verify status bar still shows same pending count
- [ ] Reconnect internet
- [ ] Verify operations eventually succeed
- [ ] Verify localStorage queue is cleared on success

---

### Part 2: Remove Max Retry Limit (Trivial, Non-Breaking)

**Estimated Time**: 30 minutes  
**Complexity**: Trivial  
**Breaking Changes**: None

#### Changes

1. **Delete Method**: Remove `pruneFailedOperations()` from `src/syncManager.ts` (lines 910-919)
2. **Update README**: Change line 280 from "After 5 failed attempts, operations are dropped" to "Operations retry indefinitely until successful"

#### Code Changes

```typescript
// In src/syncManager.ts - DELETE THIS METHOD:
pruneFailedOperations(maxRetries: number = 5): PendingOperation[] {
    // DELETE ENTIRE METHOD - lines 910-919
}
```

**That's it!** No other changes needed since method was never called.

#### Testing

- No specific testing needed (method wasn't used)
- Verify plugin still builds: `npm run build`

---

### Part 3: Recovery Command (Simple, Non-Breaking)

**Estimated Time**: 1 hour  
**Complexity**: Low  
**Breaking Changes**: None

#### Add New Command

**In `main.ts` onload()** (after other commands, around line 305):

```typescript
// Add command to manually retry failed operations
this.addCommand({
    id: 'retry-failed-operations',
    name: 'Retry failed sync operations',
    callback: async () => {
        const pending = this.syncManager.getPendingOperations();
        if (pending.length === 0) {
            new Notice('No pending operations to retry');
            return;
        }
        
        new Notice(`Retrying ${pending.length} pending operation(s)...`);
        await this.syncTasks();
    }
});
```

#### Update Status Bar Display

**In `main.ts` updateStatusBar()** (around line 376):

```typescript
// Enhance pending operation display
const pendingCount = this.syncManager.getPendingOperationCount();
let pendingText = '';

if (pendingCount > 0) {
    const operations = this.syncManager.getPendingOperations();
    // Find max retry count for display
    const maxRetries = Math.max(...operations.map(op => op.retryCount), 0);
    
    if (maxRetries > 0) {
        pendingText = ` • ${pendingCount} pending (${maxRetries} retries)`;
    } else {
        pendingText = ` • ${pendingCount} pending`;
    }
}

this.statusBarItem.setText(`📅 ${syncedCount} synced${pendingText} • ${timeAgo}`);
```

#### Testing Checklist

- [ ] Disconnect internet
- [ ] Create tasks to trigger failed operations
- [ ] Verify status bar shows "X pending (Y retries)"
- [ ] Run "Retry failed sync operations" command
- [ ] Verify immediate sync attempt
- [ ] Reconnect internet
- [ ] Verify operations succeed

---

### Part 4: SyncOrchestrator Refactoring (MAJOR CHANGE)

**Estimated Time**: 8-12 hours  
**Complexity**: HIGH  
**Breaking Changes**: Potentially many (internal only)

#### Overview

Move ~1500 lines of sync orchestration logic from `main.ts` into a dedicated `SyncOrchestrator` class.

#### Why This is Big

The `syncTasks()` method in main.ts currently:
- Scans vault for tasks
- Computes diff (multi-calendar routing)
- Builds batch operations
- Executes batch API calls
- Handles reconciliation
- Manages Safety Net
- Handles external event detection
- Updates status bar
- Saves settings
- Emits events

**Result**: ~300+ lines in one method, deeply coupled to main.ts

#### Architecture

```
┌────────────────────────────────────────┐
│           main.ts (Plugin)             │
│  - Settings management                 │
│  - Command registration                │
│  - UI updates (status bar, modals)     │
│  - Event emission                      │
└──────────────┬─────────────────────────┘
               │
               │ delegates to
               ▼
┌────────────────────────────────────────┐
│      SyncOrchestrator (NEW)            │
│  - Sync flow coordination              │
│  - Batch operation building            │
│  - Retry logic                         │
│  - Conflict detection (future)         │
└──────────────┬─────────────────────────┘
               │
               │ uses
               ▼
┌────────────────────────────────────────┐
│    Existing Classes (unchanged)        │
│  - SyncManager                         │
│  - BatchCalendarApi                    │
│  - GoogleCalendarApi                   │
│  - TaskParser                          │
└────────────────────────────────────────┘
```

#### New File: `src/syncOrchestrator.ts`

```typescript
import { ChronosTask, TaskParser } from './taskParser';
import { SyncManager, ChronosSyncData } from './syncManager';
import { BatchCalendarApi, ChangeSetOperation, BatchResult } from './batchApi';
import { GoogleCalendarApi } from './googleCalendar';

export interface SyncOrchestratorDeps {
    syncManager: SyncManager;
    batchApi: BatchCalendarApi;
    calendarApi: GoogleCalendarApi;
    taskParser: TaskParser;
    machineId: string;
}

export interface SyncOptions {
    forceVerify: boolean;
    settings: any; // Import from main.ts
    excludedFolders: string[];
    excludedFiles: string[];
    getTargetCalendarForTask: (task: ChronosTask) => string;
}

export interface SyncResult {
    success: boolean;
    created: number;
    updated: number;
    deleted: number;
    failed: number;
    pending: number;
}

/**
 * Orchestrates sync operations between Obsidian tasks and Google Calendar
 * Handles batch operations, reconciliation, and offline queue management
 */
export class SyncOrchestrator {
    private syncManager: SyncManager;
    private batchApi: BatchCalendarApi;
    private calendarApi: GoogleCalendarApi;
    private taskParser: TaskParser;
    private machineId: string;
    
    constructor(deps: SyncOrchestratorDeps) {
        this.syncManager = deps.syncManager;
        this.batchApi = deps.batchApi;
        this.calendarApi = deps.calendarApi;
        this.taskParser = deps.taskParser;
        this.machineId = deps.machineId;
    }
    
    /**
     * Main sync entry point
     * Called from main.ts syncTasks()
     */
    async performSync(options: SyncOptions): Promise<SyncResult> {
        const result: SyncResult = {
            success: false,
            created: 0,
            updated: 0,
            deleted: 0,
            failed: 0,
            pending: 0
        };
        
        try {
            // 1. Load offline queue (if any)
            await this.retryPendingOperations();
            
            // 2. Scan vault for tasks
            const allTasks = await this.taskParser.scanVault(
                options.excludedFolders,
                options.excludedFiles
            );
            
            // 3. Filter completed tasks
            const uncompletedTasks = allTasks.filter(t => !t.isCompleted);
            const completedTasks = allTasks.filter(t => t.isCompleted);
            
            // 4. Future: Detect multi-PC conflicts
            // await this.detectAndResolveConflicts(uncompletedTasks);
            
            // 5. Compute diff with multi-calendar routing
            const diff = this.syncManager.computeMultiCalendarSyncDiff(
                uncompletedTasks,
                options.getTargetCalendarForTask
            );
            
            // 6. Build changeset
            const changeset = this.syncManager.buildChangeSet(
                diff,
                completedTasks,
                options.settings,
                options.settings.safeMode
            );
            
            // 7. Execute batch operations
            const batchResults = await this.executeBatchOperations(changeset, options);
            
            // 8. Process results
            result.created = batchResults.created;
            result.updated = batchResults.updated;
            result.deleted = batchResults.deleted;
            result.failed = batchResults.failed;
            
            // 9. Save/clear offline queue
            const pendingCount = this.syncManager.getPendingOperationCount();
            if (pendingCount > 0) {
                this.syncManager.saveOfflineQueue(this.machineId);
            } else {
                this.syncManager.clearOfflineQueue();
            }
            
            result.pending = pendingCount;
            result.success = true;
            
        } catch (error) {
            console.error('Sync orchestration failed:', error);
            result.success = false;
        }
        
        return result;
    }
    
    /**
     * Retry pending operations from offline queue
     * Private helper method
     */
    private async retryPendingOperations(): Promise<void> {
        const pending = this.syncManager.getPendingOperations();
        if (pending.length === 0) return;
        
        console.log(`Chronos: Retrying ${pending.length} pending operations`);
        
        // TODO: Implement retry logic
        // This will be moved from main.ts
    }
    
    /**
     * Execute batch operations
     * Private helper method
     */
    private async executeBatchOperations(
        changeset: any, // Import from batchApi
        options: SyncOptions
    ): Promise<{ created: number; updated: number; deleted: number; failed: number }> {
        // TODO: Move batch execution logic from main.ts
        return { created: 0, updated: 0, deleted: 0, failed: 0 };
    }
    
    /**
     * Detect and resolve multi-PC conflicts
     * Placeholder for Phase 19 implementation
     */
    async detectAndResolveConflicts(tasks: ChronosTask[]): Promise<void> {
        // Future: Multi-PC conflict detection will go here
        // For now: no-op
    }
}
```

#### Migration Strategy

**CRITICAL**: This is a BIG refactoring. Do it incrementally:

1. **Create File**: Create `src/syncOrchestrator.ts` with skeleton class
2. **Instantiate**: Add to main.ts, but don't use yet
3. **Move Logic Piece by Piece**: Move one section at a time
   - Start with simple parts (task scanning)
   - Then diff computation
   - Then batch execution
   - Finally retry logic and error handling
4. **Test After Each Move**: Verify full sync still works
5. **Clean Up**: Remove old code from main.ts once moved

#### Detailed Migration Steps

**Step 1: Create and Wire Up (No Behavior Change)**

```typescript
// In main.ts, add property
private syncOrchestrator: SyncOrchestrator;

// In onload(), after initializing other services
this.syncOrchestrator = new SyncOrchestrator({
    syncManager: this.syncManager,
    batchApi: this.batchApi,
    calendarApi: this.calendarApi,
    taskParser: this.taskParser,
    machineId: this.machineId
});
```

**Test**: Build succeeds, plugin loads

**Step 2: Move Task Scanning Logic**

Move lines from `syncTasks()` related to scanning:
- Vault scanning
- Task filtering
- Exclusion logic

Update `performSync()` to handle this.

**Test**: Full sync still works

**Step 3: Move Diff Computation**

Move lines related to:
- `computeMultiCalendarSyncDiff()`
- Target calendar determination

**Test**: Full sync still works

**Step 4: Move Batch Execution**

Move lines related to:
- Building changeset
- Executing batch operations
- Processing results

**Test**: Full sync still works

**Step 5: Move Retry Logic**

Move pending operations handling.

**Test**: Full sync still works, retries work

**Step 6: Final Cleanup**

- Remove old commented code
- Simplify main.ts `syncTasks()`
- Add documentation

#### Final State: main.ts `syncTasks()`

```typescript
async syncTasks() {
    try {
        this.emit('sync-start');
        
        const result = await this.syncOrchestrator.performSync({
            forceVerify: false,
            settings: this.settings,
            excludedFolders: this.settings.excludedFolders,
            excludedFiles: this.settings.excludedFiles,
            getTargetCalendarForTask: (task) => this.getTargetCalendarForTask(task)
        });
        
        this.syncManager.setLastSyncTime();
        await this.saveSettings();
        
        this.updateStatusBar();
        this.emit('sync-complete');
        
        if (!result.success) {
            new Notice('Sync completed with errors. Check console for details.');
        }
        
    } catch (error) {
        console.error('Sync failed:', error);
        new Notice('Sync failed. Check console for details.');
    }
}
```

**Result**: ~300 lines down to ~20 lines in main.ts!

#### Testing Strategy for Refactoring

**After EACH migration step**:
1. Build: `npm run build`
2. Reload Obsidian
3. Run full sync
4. Test scenarios:
   - Create new task
   - Update existing task
   - Delete task
   - Complete task
   - Multi-calendar routing (if have tags)
   - Safety Net (if enabling deletions)
   - Offline handling (disconnect internet)

**Don't move to next step until current step works!**

---

## Unit Testing Setup

### Why Unit Tests?

- Faster than manual testing
- Catch regressions automatically
- Document expected behavior
- Enable confident refactoring

### What We'll Test

Focus on **Pure Logic** (not Obsidian API):
- SyncManager diff computation
- Task ID generation
- Content hashing
- Offline queue load/save
- Conflict detection (future)

**NOT Testing** (requires Obsidian mock):
- UI components
- Modal interactions
- Command callbacks

### Setup Instructions

#### Step 1: Install Jest and Dependencies

```bash
cd C:\Users\bwales\projects\obsidian-plugins\chronos

# Install Jest and TypeScript support
npm install --save-dev jest @types/jest ts-jest

# Install additional testing utilities
npm install --save-dev @jest/globals
```

#### Step 2: Create Jest Configuration

Create file `jest.config.js` in project root:

```javascript
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/*.test.ts'
    ],
    moduleNameMapper: {
        '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts'
    }
};
```

#### Step 3: Create Obsidian API Mock

Create file `tests/__mocks__/obsidian.ts`:

```typescript
// Mock minimal Obsidian API for testing
export class App {
    vault = {
        getMarkdownFiles: () => [],
        cachedRead: async () => ''
    };
    
    metadataCache = {
        getFileCache: () => null
    };
}

export class Plugin {
    app: App;
    constructor(app: App) {
        this.app = app;
    }
}

export class Notice {
    constructor(message: string) {
        console.log('Notice:', message);
    }
}

export class Modal {
    app: App;
    constructor(app: App) {
        this.app = app;
    }
    open() {}
    close() {}
}

// Add other mocks as needed
```

#### Step 4: Create Test Directory Structure

```
chronos/
├── src/
│   └── syncManager.ts
├── tests/
│   ├── __mocks__/
│   │   └── obsidian.ts
│   └── syncManager.test.ts
└── jest.config.js
```

#### Step 5: Write First Test

Create file `tests/syncManager.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from '@jest/globals';
import { SyncManager } from '../src/syncManager';
import { ChronosTask } from '../src/taskParser';

describe('SyncManager', () => {
    let syncManager: SyncManager;
    
    beforeEach(() => {
        syncManager = new SyncManager();
    });
    
    describe('generateTaskId', () => {
        test('should generate consistent IDs for same task', () => {
            const task: ChronosTask = {
                title: 'Test Task',
                date: '2026-01-15',
                time: '14:00',
                datetime: new Date('2026-01-15T14:00:00'),
                filePath: 'test.md',
                fileName: 'test.md',
                lineNumber: 1,
                rawText: '- [ ] Test Task',
                isCompleted: false,
                isAllDay: false,
                tags: [],
                reminderMinutes: null
            };
            
            const id1 = syncManager.generateTaskId(task);
            const id2 = syncManager.generateTaskId(task);
            
            expect(id1).toBe(id2);
        });
        
        test('should generate different IDs for different tasks', () => {
            const task1: ChronosTask = {
                title: 'Task 1',
                date: '2026-01-15',
                time: '14:00',
                datetime: new Date('2026-01-15T14:00:00'),
                filePath: 'test.md',
                fileName: 'test.md',
                lineNumber: 1,
                rawText: '- [ ] Task 1',
                isCompleted: false,
                isAllDay: false,
                tags: [],
                reminderMinutes: null
            };
            
            const task2: ChronosTask = {
                ...task1,
                title: 'Task 2'
            };
            
            const id1 = syncManager.generateTaskId(task1);
            const id2 = syncManager.generateTaskId(task2);
            
            expect(id1).not.toBe(id2);
        });
    });
    
    describe('Offline Queue Persistence', () => {
        test('should load empty queue when none exists', () => {
            const queue = syncManager.loadOfflineQueue();
            expect(queue).toEqual([]);
        });
        
        // Add more tests for save/clear
    });
});
```

#### Step 6: Add Test Script to package.json

```json
{
  "scripts": {
    "build": "node esbuild.config.mjs production",
    "dev": "node esbuild.config.mjs",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

#### Step 7: Run Tests

```bash
# Run all tests
npm test

# Run in watch mode (re-runs on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

### What to Test

**Priority 1: Core Logic**
- [ ] Task ID generation (various inputs)
- [ ] Content hash generation
- [ ] Offline queue load/save/clear
- [ ] Diff computation (simple cases)

**Priority 2: Edge Cases**
- [ ] Empty queue handling
- [ ] Invalid localStorage data
- [ ] Mismatched machine IDs
- [ ] Duplicate tasks

**Priority 3: Integration** (after refactoring)
- [ ] SyncOrchestrator flow
- [ ] Batch operation building

### Example Test Suite Structure

```
tests/
├── __mocks__/
│   └── obsidian.ts
├── syncManager/
│   ├── taskId.test.ts          # Task ID generation
│   ├── contentHash.test.ts     # Content hashing
│   ├── offlineQueue.test.ts    # Offline queue persistence
│   └── diffComputation.test.ts # Sync diff logic
└── syncOrchestrator/
    └── performSync.test.ts     # Integration tests
```

### Running Tests

```bash
# All tests
npm test

# Watch mode (auto-rerun on save)
npm run test:watch

# With coverage report
npm run test:coverage

# Specific test file
npm test syncManager.test.ts
```

---

## Implementation Order

1. **Part 2** (Remove prune method) - 30 min - Do First (trivial)
2. **Part 1** (Offline queue) - 3 hours - Do Second (simple, high value)
3. **Part 3** (Recovery command) - 1 hour - Do Third (depends on Part 1)
4. **Unit Testing Setup** - 2-3 hours - Do Fourth (foundation for refactoring)
5. **Part 4** (SyncOrchestrator) - 8-12 hours - Do Last (complex, test-driven)

**Total Estimated Time**: 15-20 hours

---

## Success Criteria

### Part 1: Offline Queue
- [ ] Offline operations persist across restarts
- [ ] Queue loads on plugin start
- [ ] Queue saves after each sync
- [ ] Queue clears when all operations succeed
- [ ] Different machines don't interfere with each other's queues

### Part 2: Infinite Retry
- [ ] `pruneFailedOperations()` method deleted
- [ ] No operations dropped after N retries
- [ ] README updated to reflect infinite retry behavior

### Part 3: Recovery
- [ ] New command appears in command palette
- [ ] Command shows notice if no pending operations
- [ ] Command triggers immediate sync


- [ ] Status bar shows retry count

### Part 4: SyncOrchestrator
- [ ] `src/syncOrchestrator.ts` created
- [ ] `main.ts` syncTasks() reduced to <50 lines
- [ ] All sync scenarios still work:
  - [ ] Create tasks
  - [ ] Update tasks
  - [ ] Delete tasks
  - [ ] Complete tasks
  - [ ] Multi-calendar routing
  - [ ] Safety Net
  - [ ] External event handling
  - [ ] Offline queue
  - [ ] Recurring tasks

### Unit Testing
- [ ] Jest configured and running
- [ ] At least 10 tests written
- [ ] All tests passing
- [ ] Coverage report generated

---

## Migration Notes

### Backwards Compatibility

- **localStorage queue**: New machines start with empty queue (expected)
- **Existing pending operations**: Will be in-memory, saved to localStorage on next sync
- **No data loss**: All existing sync records unaffected

### Multi-PC Sync Compatibility

This implementation is designed to be forwards-compatible with Phase 19:

| localStorage Key | Purpose | Phase |
|------------------|---------|-------|
| `chronos-machine-id` | Machine UUID | Phase 19 Phase 1 |
| `chronos-offline-queue` | Failed operations | **This Phase** |
| `chronos-local-sync-cache` | Base state for conflicts | Phase 19 Phase 3 |

No conflicts, fully compatible.

---

## Commit Strategy

**After Part 1**:
```
feat: Add localStorage persistence for offline queue

- Add loadOfflineQueue/saveOfflineQueue/clearOfflineQueue methods to SyncManager
- Integrate with plugin onload and syncTasks
- Operations now survive plugin/Obsidian restarts
- Machine-specific queue (validated by machineId)
```

**After Part 2**:
```
refactor: Remove max retry limit for pendingoperations

- Delete unused pruneFailedOperations method
- Update README to reflect infinite retry behavior
- Operations now retry indefinitely until successful
```

**After Part 3**:
```
feat: Add manual retry command for failed sync operations

- New command: "Retry failed sync operations"
- Enhanced status bar to show retry count
- Provides user control over offline operation retry
```

**After Part 4**:
```
refactor: Extract sync orchestration to SyncOrchestrator class

- Move sync logic from main.ts to src/syncOrchestrator.ts
- Reduce main.ts syncTasks() from 300+ lines to ~20 lines
- Better separation of concerns and testability
- No functional changes, purely architectural improvement
```

**After Unit Tests**:
```
test: Add Jest unit tests for core sync logic

- Configure Jest with TypeScript support
- Add tests for task ID generation and content hashing
- Add tests for offline queue persistence
- Foundation for test-driven development
```

---

## Questions / Decisions

Before implementation, confirm with Brad:

- [x] localStorage for offline queue approved?
- [x] Infinite retries approved?
- [x] Ready for SyncOrchestrator refactoring?
- [x] Unit testing with Jest approved?

---

## Next Steps

After this phase completes:

1. **Phase 19: Multi-PC Sync** - Conflict detection and resolution
2. **Phase 21: Additional Unit Tests** - Expand test coverage
3. **Phase 22: Integration Tests** - End-to-end testing

---

**Last Updated**: January 16, 2026
