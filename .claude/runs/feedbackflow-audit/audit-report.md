# FeedbackFlow v0.5.0 -- Comprehensive Audit Report

**Date:** 2026-02-05
**Auditor:** Auditor Agent (Claude Opus 4.6)
**Codebase:** 28 source files, ~2,900 lines of application code
**Build Status:** Typecheck PASS, Lint PASS (1 pre-existing warning), Build PASS

---

## Executive Summary

FeedbackFlow v0.5.0 is a well-structured Electron menu bar app with solid security fundamentals: sandbox is enabled, context isolation is in place, IPC channels are allowlisted, and URL handling is validated. Three prior audit rounds (v0.3.1 P0, v0.4.0 P1, v0.5.0 P2/P3) have addressed the most critical issues.

However, this fresh audit identifies **21 remaining findings** across architecture, security, UX, and production readiness. The most critical issues are: (1) the `build/` directory referenced by electron-builder does not exist, meaning packaging will fail; (2) AudioService emits `fatalError` events that nothing listens to, causing silent recording death; (3) two declared dependencies are phantom (never imported); and (4) `shell.openExternal` in the `setWindowOpenHandler` lacks the URL validation present in the IPC handler.

**Severity Distribution:**

| Severity | Count |
|----------|-------|
| P0 Critical | 2 |
| P1 High | 5 |
| P2 Medium | 9 |
| P3 Nice-to-have | 5 |

---

## P0 -- Critical Findings

### BUILD-01: Missing `build/` Directory Breaks Packaging

**Severity:** P0 Critical
**Category:** Production Readiness
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/package.json` (lines 61-62)
- `/Users/eddiesanjuan/projects/feedbackflow/assets/` (empty directory)

**Description:**
The `package.json` electron-builder config references `build/entitlements.mac.plist` (lines 61-62) and `assets/icon.icns` (line 57), but:
1. The `build/` directory does not exist at all. `entitlements.mac.plist` is not present.
2. The `assets/` directory is empty -- no `icon.icns` file.

Running `npm run package` will fail because electron-builder cannot find the entitlements file or the icon. The CI release workflow (`release.yml`) runs `npm run package` and will also fail.

**Recommended Fix:**
1. Create `build/entitlements.mac.plist` with appropriate entitlements (microphone access, screen recording):
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>com.apple.security.cs.allow-jit</key>
     <true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
     <true/>
     <key>com.apple.security.device.audio-input</key>
     <true/>
     <key>com.apple.security.device.camera</key>
     <true/>
   </dict>
   </plist>
   ```
2. Create or add an `assets/icon.icns` file. At minimum, generate one from a PNG source.
3. Add a CI step or pre-package script that validates these files exist.

**Acceptance Criteria:**
- [ ] `build/entitlements.mac.plist` exists and contains microphone + screen recording entitlements
- [ ] `assets/icon.icns` exists and is a valid macOS icon set
- [ ] `npm run package` completes without errors
- [ ] `npm run package:dir` completes without errors

---

### ARCH-01: AudioService `fatalError` Events Are Never Handled

**Severity:** P0 Critical
**Category:** Architecture / Reliability
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/AudioService.ts` (lines 159, 196, 286, 323)
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/SessionController.ts` (constructor, lines 86-99)

**Description:**
AudioService emits `fatalError` at four code paths when the recording process exits unexpectedly during an active recording session. However, SessionController never registers a listener for this event. This means:

1. If the `rec` or `ffmpeg` process crashes mid-recording, the UI will stay in the "Recording" state indefinitely.
2. The user sees a frozen timer with no feedback that recording has silently died.
3. The watchdog will eventually time out after 30 minutes, but the user will have wasted their entire recording.

**Recommended Fix:**
In SessionController's constructor (or in the `start()` method after audio begins), register a `fatalError` listener:
```typescript
this.audioService.on('fatalError', (error: Error) => {
  logger.error('Audio fatal error:', error);
  if (this.session.state === SessionState.RECORDING) {
    this.setState(SessionState.ERROR, `Recording failed: ${error.message}`);
  }
});
```
Ensure the listener is removed in `destroy()`.

**Acceptance Criteria:**
- [ ] SessionController listens for `fatalError` from AudioService
- [ ] When recording process dies, UI transitions to ERROR state with a descriptive message
- [ ] Listener is cleaned up in `destroy()`

---

## P1 -- High Findings

### SEC-01: Unvalidated `shell.openExternal` in `setWindowOpenHandler`

**Severity:** P1 High
**Category:** Security
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/index.ts` (lines 62-64)

**Description:**
The `setWindowOpenHandler` calls `shell.openExternal(url)` without any URL validation. In contrast, the IPC handler at `ipc.ts:151-163` correctly validates URLs (only allowing `http:` and `https:` protocols). The `setWindowOpenHandler` should apply the same validation since `url` could contain `file:`, `javascript:`, or custom protocol schemes.

**Recommended Fix:**
```typescript
window.webContents.setWindowOpenHandler(({ url }) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  } catch {
    // Invalid URL, ignore
  }
  return { action: "deny" };
});
```

**Acceptance Criteria:**
- [ ] `setWindowOpenHandler` validates URL protocol before calling `shell.openExternal`
- [ ] Only `http:` and `https:` protocols are allowed
- [ ] Invalid URLs are silently ignored (no crash)

---

### SEC-02: Insufficient JSON.parse Validation in StateStore and SessionHistory

**Severity:** P1 High
**Category:** Security / Robustness
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/StateStore.ts` (lines 76-84)
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/SessionHistory.ts` (lines 31-39)

**Description:**
Both `StateStore.load()` and `SessionHistory.load()` use `JSON.parse()` to read files from disk and cast the result directly to typed objects. While `StateStore.load()` has a basic check for `id` and `state` fields, neither validates that the parsed data actually conforms to the expected schema. `SessionHistory.load()` does no validation at all -- it directly assigns the parsed JSON to `this.sessions`.

A corrupted or tampered state file could cause runtime crashes throughout the application if fields are missing or have wrong types.

**Recommended Fix:**
Add validation in both locations:

For `SessionHistory.load()`, validate that the parsed data is an array and each element has the required fields:
```typescript
private load(): void {
  try {
    if (existsSync(this.historyPath)) {
      const data = readFileSync(this.historyPath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.sessions = parsed.filter(
          (s) => typeof s.id === 'string' && typeof s.reportPath === 'string' &&
                 typeof s.timestamp === 'number' && typeof s.duration === 'number'
        );
      }
    }
  } catch (err) {
    logger.error("Failed to load session history:", err);
    this.sessions = [];
  }
}
```

For `StateStore.load()`, validate all critical fields of SessionData, not just `id` and `state`.

**Acceptance Criteria:**
- [ ] `SessionHistory.load()` validates parsed array and element shapes
- [ ] `StateStore.load()` validates all required SessionData fields
- [ ] Corrupted files cause graceful fallback to empty state, not crashes

---

### ARCH-02: Phantom Dependencies -- `electron-store` and `zustand` Never Used

**Severity:** P1 High
**Category:** Architecture / Supply Chain
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/package.json` (lines 21, 23)

**Description:**
`electron-store` and `zustand` are declared as production dependencies in `package.json` but are never imported anywhere in the codebase. `npm outdated` shows them as `MISSING`, meaning they may not even be installed. These phantom dependencies:

1. Increase attack surface (supply chain risk for packages that aren't even used)
2. Increase bundle size if they somehow get bundled
3. Confuse developers about the actual architecture (suggesting a store pattern that doesn't exist)

**Recommended Fix:**
Remove both from `package.json`:
```bash
npm uninstall electron-store zustand
```

**Acceptance Criteria:**
- [ ] `electron-store` removed from `dependencies`
- [ ] `zustand` removed from `dependencies`
- [ ] `npm ci && npm run build` still succeeds
- [ ] No import references to either package exist in src/

---

### ARCH-03: Stale Audio Recordings Never Cleaned Up

**Severity:** P1 High
**Category:** Architecture / Resource Management
**Effort:** M (1-4hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/AudioService.ts` (line 38)
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/ScreenshotService.ts` (line 22)

**Description:**
Audio recordings are saved to `{userData}/recordings/` and screenshots to `{userData}/screenshots/`. These directories grow unboundedly -- files are never deleted after session completion. Over time, this will consume significant disk space (each recording is a WAV file, potentially 10+ MB per session).

Neither `SessionController.reset()` nor any other code path removes completed recording files or screenshot directories.

**Recommended Fix:**
Implement a cleanup strategy:
1. After a session completes and the markdown report is saved, delete the WAV file from `recordings/` (the transcript is already extracted).
2. Optionally, keep screenshots since they're referenced in the markdown report via absolute path. But add a cleanup method that removes sessions older than N days.
3. Add a `cleanupCompletedSession(sessionId)` method to SessionController that removes the recording file after processing.

**Acceptance Criteria:**
- [ ] WAV files are deleted after successful transcription and report generation
- [ ] Screenshot directories are retained (referenced by markdown) but bounded
- [ ] A manual cleanup method exists (e.g., callable from settings)

---

### DEP-01: Electron 28 Has Known ASAR Integrity Bypass Vulnerability

**Severity:** P1 High
**Category:** Security / Dependencies
**Effort:** L (4+hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/package.json` (line 36)

**Description:**
`npm audit` reports 9 vulnerabilities including:
- **electron <35.7.5** -- ASAR integrity bypass (moderate, GHSA-vmqv-hx8q-j7mg)
- **tar <=7.5.6** -- arbitrary file overwrite and symlink poisoning (high, 3 CVEs)
- **esbuild <=0.24.2** -- development server request leak (moderate)

The current electron version (`^28.2.0`, installed as 28.3.3) is significantly behind. The latest is 40.1.0. The tar vulnerability in electron-builder is high severity.

**Recommended Fix:**
1. Upgrade electron to at least `^35.7.5` (or latest stable)
2. Upgrade electron-builder to `^26.7.0` to fix tar vulnerabilities
3. Upgrade electron-vite and vite to fix esbuild issue
4. After upgrading, run the full test suite and verify the build still works

Note: This is a breaking change upgrade that will require testing across all build targets.

**Acceptance Criteria:**
- [ ] `npm audit` shows no high or critical vulnerabilities
- [ ] Application builds and runs successfully on the upgraded versions
- [ ] CI pipeline passes

---

## P2 -- Medium Findings

### ARCH-04: `wrapHandlerWithArgs` Defined But Never Used

**Severity:** P2 Medium
**Category:** Code Quality
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/ipc.ts` (lines 32-44)

**Description:**
The `wrapHandlerWithArgs` function is defined but never used anywhere. ESLint already flags this as a warning. Several IPC handlers that take arguments (e.g., `transcription:setConfig`, `clipboard:write`, `recovery:recover`) manually inline error handling instead of using this helper, creating inconsistency.

**Recommended Fix:**
Either:
1. Remove `wrapHandlerWithArgs` entirely (simplest), or
2. Refactor `transcription:setConfig`, `clipboard:write`, and `recovery:recover` to use it, then remove the inline try/catch blocks

**Acceptance Criteria:**
- [ ] ESLint warning for unused `wrapHandlerWithArgs` is resolved
- [ ] IPC handlers that take arguments use consistent error handling

---

### ARCH-05: `useTranscription.updateConfig` Skips IPC Response Validation

**Severity:** P2 Medium
**Category:** Architecture / Consistency
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/hooks/useTranscription.ts` (lines 119-132)

**Description:**
The `updateConfig` callback and `downloadModel` callback directly cast IPC responses (`result as boolean`, `ready as boolean`) without using the `isIPCResponse` type guard that is defined in the same file and consistently used elsewhere. This breaks the validation pattern established throughout the codebase.

**Recommended Fix:**
Apply the same `isIPCResponse` validation pattern:
```typescript
const downloadModel = useCallback(async () => {
  setIsDownloading(true);
  setDownloadProgress(0);
  const response = await window.api.invoke("transcription:downloadModel");
  setIsDownloading(false);
  if (!isIPCResponse<boolean>(response) || !response.success) {
    return false;
  }
  if (response.data) {
    setIsModelReady(true);
  }
  return response.data ?? false;
}, []);
```

Apply similar treatment to `updateConfig`.

**Acceptance Criteria:**
- [ ] `downloadModel` validates IPC response structure
- [ ] `updateConfig` validates both `setConfig` and `isModelReady` IPC responses
- [ ] No raw `as` casts on IPC responses in useTranscription

---

### ARCH-06: `SettingsView.appVersion` Fetch Uses Incomplete Type Guard

**Severity:** P2 Medium
**Category:** Architecture / Consistency
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/components/SettingsView.tsx` (lines 31-36)

**Description:**
The version fetch in SettingsView manually casts the response: `const res = response as { success: boolean; data?: string }`. This bypasses the type guard pattern used in hooks and is the only place in the renderer that does a raw `as` cast on an IPC response.

**Recommended Fix:**
Extract the IPC response type guard into a shared utility (e.g., `src/renderer/utils/ipc.ts`) and use it here instead of the raw cast.

**Acceptance Criteria:**
- [ ] SettingsView uses the same IPC response validation as hooks
- [ ] No raw `as` casts on IPC responses in component files

---

### ARCH-07: Duplicated `IPCResponse` Type and Type Guards Across Hooks

**Severity:** P2 Medium
**Category:** Code Quality / DRY
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/hooks/useSession.ts` (lines 7-11, 23-30)
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/hooks/useTranscription.ts` (lines 7-11, 26-33)

**Description:**
The `IPCResponse` interface and `isIPCResponse` type guard are identically defined in both `useSession.ts` and `useTranscription.ts`. The `TranscriptionState` interface is also duplicated between `IdleView.tsx` and `SettingsView.tsx`.

**Recommended Fix:**
1. Create `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/utils/ipc.ts` with the shared `IPCResponse` type and `isIPCResponse` guard.
2. Export `TranscriptionState` from `useTranscription.ts` and import it in the views.

**Acceptance Criteria:**
- [ ] `IPCResponse` defined in exactly one location
- [ ] `isIPCResponse` defined in exactly one location
- [ ] `TranscriptionState` defined in exactly one location
- [ ] All consumers import from the shared location

---

### ARCH-08: `SessionController.cancel()` Creates Double State Transition

**Severity:** P2 Medium
**Category:** Architecture / State Machine
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/SessionController.ts` (lines 479-497)

**Description:**
In the `cancel()` method, line 495 calls `this.session = this.createFreshSession()` which sets the internal state to IDLE, then line 496 calls `this.setState(SessionState.IDLE)` which will emit a `stateChange` event with `oldState: idle, newState: idle`. This is a no-op state transition that still triggers a re-render in the renderer. The `reset()` method has the same pattern at lines 514-516.

**Recommended Fix:**
Use `forceTransition(SessionState.IDLE, 'Cancelled')` instead, or restructure to avoid the fresh session creation before setState. Alternatively, add an early return in `setState` when `oldState === newState`.

**Acceptance Criteria:**
- [ ] `cancel()` emits exactly one state change event
- [ ] `reset()` emits exactly one state change event
- [ ] No idle-to-idle transitions are emitted

---

### PERF-01: `screenshot:getCount` Returns Raw Value Without IPCResponse Wrapper

**Severity:** P2 Medium
**Category:** Architecture / Consistency
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/ipc.ts` (lines 143-145)

**Description:**
The `screenshot:getCount` handler returns a raw number instead of the `{ success: boolean, data: number }` structure used by all other IPC handlers. This breaks the consistency of the IPC contract and could confuse consumers.

**Recommended Fix:**
Wrap with `wrapHandler`:
```typescript
ipcMain.handle('screenshot:getCount', wrapHandler(() => {
  return screenshotService?.getCaptureCount() ?? 0
}))
```

**Acceptance Criteria:**
- [ ] `screenshot:getCount` returns `IPCResponse<number>`
- [ ] All IPC handlers follow the same response structure

---

### UX-01: CompleteView Shows Raw Markdown Instead of Transcript

**Severity:** P2 Medium
**Category:** UX
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/components/CompleteView.tsx` (line 108)

**Description:**
The completion view displays `session.markdownOutput || session.transcript` in a scrollable region. `markdownOutput` contains the full Markdown document including headers (`# Feedback - ...`), metadata (`**Duration:**`), and screenshot references. This raw Markdown is shown in a `<p>` tag with `font-mono` styling, making it look like unformatted code rather than a readable transcript.

Users expect to see their transcript text here, not the full Markdown report.

**Recommended Fix:**
Display `session.transcript` instead of `session.markdownOutput` as the primary content:
```tsx
{session.transcript || 'No transcription available'}
```
The full markdown report is already saved to disk and its path is shown above.

**Acceptance Criteria:**
- [ ] CompleteView shows the transcript text, not the full markdown report
- [ ] "No transcription available" fallback still works

---

### UX-02: Model Status "Ready" Text Has Poor Color Contrast in Light Mode

**Severity:** P2 Medium
**Category:** UX / Accessibility
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/components/SettingsView.tsx` (line 109)

**Description:**
The "Ready" status text uses `text-green-400` which has a contrast ratio of approximately 2.8:1 against a white background in light mode. WCAG 2.1 AA requires a minimum of 4.5:1 for normal text.

**Recommended Fix:**
Use `text-green-600 dark:text-green-400` to ensure adequate contrast in both light and dark modes.

**Acceptance Criteria:**
- [ ] "Ready" text meets WCAG AA contrast ratio (4.5:1) in light mode
- [ ] "Ready" text remains visible in dark mode

---

### PROD-01: Release Workflow Uses Deprecated `softprops/action-gh-release@v1`

**Severity:** P2 Medium
**Category:** Production Readiness / CI
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/.github/workflows/release.yml` (line 37)

**Description:**
The release workflow uses `softprops/action-gh-release@v1` which is outdated. The action should be pinned to a more recent major version (`v2`) or to a specific SHA for supply chain security.

**Recommended Fix:**
Update to `softprops/action-gh-release@v2` and pin to SHA:
```yaml
- uses: softprops/action-gh-release@v2
```

**Acceptance Criteria:**
- [ ] Release workflow uses `softprops/action-gh-release@v2` or later
- [ ] Release workflow still creates draft releases correctly

---

## P3 -- Nice-to-Have Findings

### ARCH-09: `checkMicrophonePermission` in AudioService Is a No-Op

**Severity:** P3 Nice-to-have
**Category:** Code Quality
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/services/AudioService.ts` (lines 411-416)

**Description:**
`checkMicrophonePermission()` always returns `true` and contains a comment saying it will handle the error later. It is never called anywhere. This is dead code that may mislead developers into thinking permission checking is implemented.

**Recommended Fix:**
Either implement actual permission checking using `systemPreferences.getMediaAccessStatus('microphone')` or remove the method entirely.

**Acceptance Criteria:**
- [ ] Method either checks real permissions or is removed

---

### PERF-02: Tray Context Menu Rebuilt on Every State Change

**Severity:** P3 Nice-to-have
**Category:** Performance
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/tray.ts` (lines 40-100, 102-105)

**Description:**
`updateRecentSessions()` is called on every session completion, which calls `updateContextMenu()`. The context menu is fully rebuilt with `Menu.buildFromTemplate()` each time. For 5 recent sessions, this is negligible. But the architecture could be more efficient by only rebuilding when sessions actually change.

This is a minor concern given the small scale.

**Recommended Fix:**
No action needed currently. Consider memoizing if session count grows.

**Acceptance Criteria:**
- [ ] N/A -- informational only

---

### UX-03: No Keyboard Shortcut to Dismiss from Popover in Main View

**Severity:** P3 Nice-to-have
**Category:** UX / Accessibility
**Effort:** S (<1hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/renderer/App.tsx` (lines 36-48)

**Description:**
Pressing Escape in the settings view returns to main view. In the main view (non-recording states), Escape does nothing -- the comment says "could close the popover via IPC if needed." For a menu bar app, Escape is the expected way to dismiss the popover.

**Recommended Fix:**
In the main view, send a `window.hide()` equivalent via IPC when Escape is pressed (except during recording).

**Acceptance Criteria:**
- [ ] Escape in main view hides the popover window
- [ ] Escape during recording still does nothing (safety)

---

### PROD-02: No Auto-Update Mechanism

**Severity:** P3 Nice-to-have
**Category:** Production Readiness
**Effort:** L (4+hr)

**File(s) affected:**
- N/A (missing feature)

**Description:**
The app has no auto-update mechanism. Users must manually download new versions. For a productivity tool that lives in the menu bar, this creates significant update friction.

**Recommended Fix:**
Integrate `electron-updater` (part of electron-builder) with GitHub Releases as the update source. This provides:
- Background update checking
- Download progress notification
- Install-on-quit behavior

**Acceptance Criteria:**
- [ ] App checks for updates on launch (configurable)
- [ ] User is notified when an update is available
- [ ] Update installs on next quit

---

### PROD-03: Logger Does Not Persist to File in Production

**Severity:** P3 Nice-to-have
**Category:** Production Readiness / Diagnostics
**Effort:** M (1-4hr)

**File(s) affected:**
- `/Users/eddiesanjuan/projects/feedbackflow/src/main/utils/logger.ts` (lines 1-10)

**Description:**
In production (`NODE_ENV !== 'development'`), only `logger.error` writes to stderr. `logger.log` and `logger.warn` are silenced. There is no file-based logging. When users report issues, there is no diagnostic trail to investigate.

**Recommended Fix:**
Add rotating file logging for production using `electron-log` or a simple write-to-file approach:
- Log errors and warnings to `{userData}/logs/feedbackflow.log`
- Rotate logs (keep last 5 files, 1MB each)
- Include timestamp and log level

**Acceptance Criteria:**
- [ ] Production errors are written to a log file
- [ ] Log file is rotated to prevent unbounded growth
- [ ] Log file location is discoverable (e.g., from Settings)

---

## Positive Observations

1. **Security fundamentals are solid.** Sandbox enabled, context isolation on, `nodeIntegration: false`, `webSecurity: true`, IPC allowlisting in preload, URL validation on `shell:openExternal` handler.
2. **Type safety is strong.** Strict TypeScript configuration, runtime type guards on IPC responses in the renderer, proper enum usage for state machine.
3. **State machine is well-designed.** Watchdog with per-state timeouts, operation lock for race condition prevention, recovery mechanism for interrupted sessions.
4. **Accessibility is above average.** ARIA labels, roles, `aria-live` regions, `aria-busy` states, keyboard focus rings, `prefers-reduced-motion` support, semantic HTML.
5. **Dark mode support is thorough.** CSS custom properties with `prefers-color-scheme` media queries, consistent theming across all components.
6. **Build system is clean.** TypeScript checks pass, ESLint configured, CI pipeline exists for lint/typecheck/build.
7. **Recording performance optimization.** `RecordingTimer` is properly memoized to prevent full-view re-renders every second.

---

## Prioritized Implementation Plan

### Wave 1 -- Blockers (before any release)
1. **BUILD-01** -- Create `build/` directory with entitlements and add icon to assets. Without this, no package can be built.
2. **ARCH-01** -- Wire up `fatalError` listener in SessionController. Users will lose recordings without knowing.
3. **SEC-01** -- Add URL validation to `setWindowOpenHandler`. One-line security fix.

### Wave 2 -- High Priority (before v0.6.0)
4. **ARCH-02** -- Remove phantom dependencies (`electron-store`, `zustand`). Clean, zero-risk.
5. **SEC-02** -- Add JSON validation to StateStore and SessionHistory. Prevent crashes from corrupted files.
6. **ARCH-03** -- Implement recording file cleanup. Prevent disk space accumulation.
7. **DEP-01** -- Upgrade electron and electron-builder. Fix known vulnerabilities. (Larger effort, schedule separately.)

### Wave 3 -- Polish (v0.6.0+)
8. **ARCH-04** through **ARCH-08** -- Code consistency fixes (unused code, duplicated types, IPC response patterns).
9. **UX-01** -- Show transcript instead of markdown in CompleteView.
10. **UX-02** -- Fix green text contrast.
11. **PROD-01** -- Update GitHub release action.

### Wave 4 -- Enhancement (backlog)
12. **ARCH-09**, **UX-03**, **PROD-02**, **PROD-03** -- Dead code, keyboard shortcuts, auto-update, file logging.

---

## Fleet Feedback

**FRICTION:** The lack of an `ARCHITECTURE.md` that maps IPC channels to handlers and documents the event flow between services required manual tracing of all event emitters/listeners. The phantom dependencies suggested architectural patterns (zustand state management) that do not exist, wasting analysis time.

**MISSING_CONTEXT:** The prior audit reports (AUDIT_CLAUDE.md, AUDIT_WAVE1.md, etc.) document what was fixed but not what was explicitly deferred. A "known issues / won't fix" section would have helped scope this audit faster.

**SUGGESTION:** The developer should maintain a `docs/IPC_CHANNELS.md` that lists every channel, its direction (invoke vs. on), its request/response types, and which service handles it. This would make future audits 2-3x faster and serve as living API documentation.

---

**Verdict: CHANGES REQUESTED**

Two P0 findings (BUILD-01, ARCH-01) and three P1 findings (SEC-01, ARCH-02, SEC-02) must be addressed before the next release. The remaining findings are important but non-blocking.
