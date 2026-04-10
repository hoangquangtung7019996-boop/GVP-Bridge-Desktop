# PLAN_049: Statsig UI Panel + Fix Statsig Capture from ALL API Calls

## Background

The user has identified critical failures:
1. The statsig UI panel is NOT appearing on screen
2. Statsig ID is NOT being captured before Preview Mode makes its API call
3. Looking at the browser Network tab, `x-stats-id` header is present on ALL Grok REST API calls, not just `/conversations/new`

## Problem Analysis

### Current Behavior (Broken)
- `gvpFetchInterceptor.js` only broadcasts statsig-id for `/conversations/new` requests
- But statsig-id is on EVERY `/rest/` API call (visible in Network tab)
- The Bridge extension never gets a statsig-id unless user manually triggers a generation first
- No UI element is visible showing statsig status

### Expected Behavior
- Statsig-id should be captured from ANY Grok REST API call
- A visible UI PANEL (not just a badge) should show:
  - Statsig status indicator
  - Current statsig-id (truncated)
  - Button to toggle Preview Mode ON/OFF
  - Button to manually search/refresh statsig
- Preview Mode should work immediately on page load (statsig captured from initial API calls)

---

## UI Panel Design

```
┌─────────────────────────────────────┐
│ 🟢 GVP Ready                        │  ← Status indicator (green/red)
│ ─────────────────────────────────── │
│ Statsig: 0ty2bddCUSOjyXlkK9lE...    │  ← Truncated statsig-id
│ ─────────────────────────────────── │
│ [Preview Mode: ON]  [Refresh Statsig]│  ← Two buttons
└─────────────────────────────────────┘
```

### Visual States

**When Statsig Captured:**
- Header: 🟢 "GVP Ready" (green background)
- Shows truncated statsig-id
- Preview Mode button shows current state (ON/OFF)
- Refresh button available

**When No Statsig:**
- Header: 🔴 "No Statsig" (red background)
- Shows "Navigate to capture statsig"
- Preview Mode button disabled
- Refresh button active (to try again)

---

## Implementation Tasks

### Task 1: Update `gvpFetchInterceptor.js` (GVP Repository)

**File**: `GVP/public/injected/gvpFetchInterceptor.js`

Add a new message type `GVP_FETCH_STATSIG_CAPTURED` that broadcasts statsig-id from ANY Grok REST API call:

```javascript
// Around line 597, after isSystemPromptList definition:

// NEW: Capture x-statsig-id from ANY Grok REST API call
const isGrokRestApi = typeof url === 'string' &&
  url.includes('/rest/') &&
  url.includes('grok.com');

if (isGrokRestApi && init && init.headers) {
  const headers = serializeHeaders(init.headers);
  if (headers && headers['x-statsig-id']) {
    postBridgeMessage('GVP_FETCH_STATSIG_CAPTURED', {
      statsigId: headers['x-statsig-id'],
      url,
      method,
      timestamp: Date.now()
    });
  }
}
```

### Task 2: Update `content.bundle.js` (GVP-Bridge-Desktop Repository)

**File**: `GVP-Bridge-Desktop/src-extension/content.bundle.js`

#### 2a. Add state variables
Around line 541, add:
```javascript
let statsigStatusPanel = null;      // UI panel element
let previewModeActive = false;       // Preview mode state
```

#### 2b. Add `createStatsigPanel()` function
Create a floating panel in bottom-right corner with full UI:

```javascript
function createStatsigPanel() {
  if (statsigStatusPanel) {
    document.body.removeChild(statsigStatusPanel);
  }
  
  statsigStatusPanel = document.createElement('div');
  statsigStatusPanel.id = 'gvp-statsig-panel';
  statsigStatusPanel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    min-width: 200px;
    background: #1a1a1a;
    border-radius: 12px;
    padding: 12px 16px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: white;
    z-index: 2147483647;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.1);
  `;
  
  updateStatsigPanel();
  document.body.appendChild(statsigStatusPanel);
  
  debug('[Statsig Panel] Created UI panel');
}

function updateStatsigPanel() {
  if (!statsigStatusPanel) return;
  
  const hasStatsig = !!capturedStatsigId;
  const statusColor = hasStatsig ? '#22c55e' : '#ef4444';
  const statusIcon = hasStatsig ? '🟢' : '🔴';
  const statusText = hasStatsig ? 'GVP Ready' : 'No Statsig';
  const statsigDisplay = hasStatsig 
    ? capturedStatsigId.substring(0, 24) + '...' 
    : 'Navigate to capture';
  
  statsigStatusPanel.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
      <span style="font-size: 16px;">${statusIcon}</span>
      <span style="font-weight: 600; color: ${statusColor};">${statusText}</span>
    </div>
    <div style="font-size: 11px; color: #888; margin-bottom: 4px;">Statsig:</div>
    <div style="font-family: monospace; font-size: 11px; color: #ccc; margin-bottom: 12px; word-break: break-all;">
      ${statsigDisplay}
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="gvp-toggle-preview" style="
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: ${hasStatsig ? 'pointer' : 'not-allowed'};
        background: ${previewModeActive ? '#22c55e' : '#374151'};
        color: white;
        opacity: ${hasStatsig ? 1 : 0.5};
      ">
        Preview: ${previewModeActive ? 'ON' : 'OFF'}
      </button>
      <button id="gvp-refresh-statsig" style="
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        background: #3b82f6;
        color: white;
      ">
        ↻ Refresh
      </button>
    </div>
  `;
  
  // Add button handlers
  const toggleBtn = document.getElementById('gvp-toggle-preview');
  const refreshBtn = document.getElementById('gvp-refresh-statsig');
  
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (!capturedStatsigId) return;
      previewModeActive = !previewModeActive;
      updateStatsigPanel();
      wsClient.send({
        type: 'preview_mode_changed',
        payload: { active: previewModeActive },
        timestamp: Date.now()
      });
      debug('[Statsig Panel] Preview mode:', previewModeActive ? 'ON' : 'OFF');
    });
  }
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      debug('[Statsig Panel] Manual statsig refresh requested');
      // Clear current statsig to show we're looking
      capturedStatsigId = null;
      updateStatsigPanel();
      // The next API call will capture it automatically
      // Or we could trigger a fetch to /rest/user-settings
    });
  }
}
```

#### 2c. Add listener for new message type
In `setupOGInterceptorListener()`, add handler for `GVP_FETCH_STATSIG_CAPTURED`:
```javascript
case 'GVP_FETCH_STATSIG_CAPTURED': {
  const statsigId = payload?.statsigId;
  if (statsigId && statsigId !== capturedStatsigId) {
    capturedStatsigId = statsigId;
    debug('[OG Interceptor] Captured x-statsig-id from', payload?.url);
    updateStatsigPanel();
    wsClient.send({
      type: 'statsig_captured',
      payload: { success: true },
      timestamp: Date.now()
    });
  }
  break;
}
```

#### 2d. Initialize panel
In `init()`:
- Call `createStatsigPanel()` after DOM ready
- Call `updateStatsigPanel()` whenever statsig is captured

---

## Files to Modify

| Repository | File | Change |
|------------|------|--------|
| GVP | `public/injected/gvpFetchInterceptor.js` | Broadcast statsig from any REST API |
| GVP-Bridge-Desktop | `src-extension/content.bundle.js` | Listen for new message, create full UI panel |

---

## Verification

After implementation:
1. Navigate to `grok.com/imagine/saved`
2. Panel should appear in bottom-right corner
3. Initially shows 🔴 "No Statsig"
4. After page loads (API calls happen), panel shows 🟢 "GVP Ready" with truncated statsig
5. Click "Preview: OFF" button to enable preview mode (button turns green, shows "Preview: ON")
6. Click "↻ Refresh" button to clear and re-capture statsig
7. Click a gallery card in Preview Mode
8. Generation should succeed (no 403 anti-bot)

---

## Agent Instructions

1. DO NOT modify any files outside the two listed above
2. The UI panel MUST be visible at all times when on Grok
3. The panel must have THREE interactive elements:
   - Status indicator (visual only)
   - Preview Mode toggle button
   - Refresh Statsig button
4. Test that statsig is captured from `/rest/user-settings` or similar early API calls
5. Ensure Preview Mode works without needing a manual generation first
