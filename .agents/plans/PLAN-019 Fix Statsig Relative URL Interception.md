# PLAN-019: Fix Statsig Relative URL Interception

## Problem Statement
The Statsig interceptor is failing to capture `x-statsig-id` from background API calls because Grok uses relative paths (e.g., `/rest/user-settings`). The interceptor's strict `url.includes('grok.com')` check causes it to ignore these relative calls entirely.

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `SD-GrokScripts/grok-video-prompter-extension/public/injected/gvpFetchInterceptor.js` | MODIFY | Remove the `grok.com` requirement from the REST API check to support relative fetch URLs. |

## Implementation Details

### STEP 1 — Fix the URL Check in Interceptor
**File:** `A:\Tools n Programs\SD-GrokScripts\grok-video-prompter-extension\public\injected\gvpFetchInterceptor.js`
**Action:** MODIFY EXISTING

**Find this EXACT block (around line 597):**
    const isSystemPromptList = typeof url === 'string' &&
      url.includes('/rest/system-prompt/list') &&
      method === 'POST';

    // NEW: Capture x-statsig-id from ANY Grok REST API call
    const isGrokRestApi = typeof url === 'string' &&
      url.includes('/rest/') &&
      url.includes('grok.com');

    // Extract headers safely from either Request object or init options
    let headersToInspect = null;

**Replace with:**
    const isSystemPromptList = typeof url === 'string' &&
      url.includes('/rest/system-prompt/list') &&
      method === 'POST';

    // NEW: Capture x-statsig-id from ANY Grok REST API call (Supporting relative URLs)
    const isGrokRestApi = typeof url === 'string' && url.includes('/rest/');

    // Extract headers safely from either Request object or init options
    let headersToInspect = null;

⚠️ DO NOT modify any line outside this block.

## VERIFICATION CHECKLIST
| Check | Expected |
|-------|----------|
| `url.includes('grok.com')` removed from `isGrokRestApi` check | YES |
Critical Steps After The Agent Finishes:
Open your Chrome Extensions page (chrome://extensions/).
Click the Refresh icon on the GVP Extension to force it to reload the files.
Go to your Grok tab and do a Hard Refresh (Ctrl+F5).
Watch the Statsig panel—it should now turn Green almost instantly on page load.