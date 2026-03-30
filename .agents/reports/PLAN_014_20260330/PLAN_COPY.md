# PLAN_014: Final Fixes - Statsig Capture & User Feedback

## Issues Found in Review

### Issue 1: Statsig Capture Doesn't Filter by Domain
**Location**: `src-extension/content.bundle.js` line 1002-1021

**Current**:
```javascript
// CAPTURE: Try to steal x-statsig-id from outgoing request headers
try {
  const options = args[1] || {};
  const headers = options.headers;
  if (headers) {
    // captures from ANY domain
  }
}
```

**Problem**: Captures statsig-id from ALL fetch requests, not just Grok. Could capture wrong IDs from other sites.

**Fix**:
```javascript
// CAPTURE: Steal x-statsig-id from Grok requests only
try {
  const options = args[1] || {};
  const headers = options.headers;
  
  // Only capture from Grok domain
  if (headers && url && url.includes('grok.com')) {
    let sid = null;
    if (headers instanceof Headers) {
      sid = headers.get('x-statsig-id');
    } else if (typeof headers === 'object') {
      sid = headers['x-statsig-id'] || headers['X-Statsig-Id'];
    }
    
    if (sid && sid !== capturedStatsigId) {
      capturedStatsigId = sid;
      debug('Captured x-statsig-id:', sid);
    }
  }
}
```

---

### Issue 2: No Warning When Statsig Missing
**Location**: `src-extension/content.bundle.js` line 811-815

**Current**:
```javascript
// Reuse captured Statsig ID if available (critical for anti-bot)
if (capturedStatsigId) {
  debug('[sendDirectGenerationRequest] Adding captured x-statsig-id:', capturedStatsigId);
  headers['x-statsig-id'] = capturedStatsigId;
}
```

**Problem**: Silent failure - user doesn't know if statsig-id is missing, which will trigger anti-bot.

**Fix**:
```javascript
// Reuse captured Statsig ID if available (critical for anti-bot)
if (capturedStatsigId) {
  debug('[sendDirectGenerationRequest] Adding captured x-statsig-id:', capturedStatsigId);
  headers['x-statsig-id'] = capturedStatsigId;
} else {
  debug('[WARN] No statsig-id captured - Preview Mode may trigger anti-bot!');
  debug('[WARN] Navigate around Grok first to capture a statsig-id');
  // Still proceed, but will likely fail
}

// Also send warning to desktop app
wsClient.send({
  type: 'generation_result',
  payload: {
    url: 'preview-mode-warning',
    data: { 
      warning: capturedStatsigId ? null : 'No statsig-id captured - may trigger anti-bot',
      hasStatsig: !!capturedStatsigId
    },
    timestamp: Date.now()
  }
});
```

---

### Issue 3: Better Statsig Capture Feedback
**Location**: `src-extension/content.bundle.js` - add status update

**Add after successful capture**:
```javascript
if (sid && sid !== capturedStatsigId) {
  capturedStatsigId = sid;
  debug('Captured x-statsig-id:', sid.substring(0, 20) + '...');
  
  // Notify desktop that statsig is ready
  wsClient.send({
    type: 'statsig_captured',
    payload: { success: true },
    timestamp: Date.now()
  });
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src-extension/content.bundle.js` | Filter statsig capture by grok.com, add warning when missing |

---

## Testing

1. Open Grok, open console
2. Navigate around - should see "Captured x-statsig-id: xxx..."
3. Enable Preview Mode
4. Click a gallery card
5. Check console for "[sendDirectGenerationRequest] Adding captured x-statsig-id" OR "[WARN] No statsig-id captured"
6. Generation should succeed with statsig, fail without
