---
trigger: always_on
glob:
description: Rules for the Antigravity IDE and Gemini Flash LLM working on the GVP Bridge project
---

# IDE & LLM Rules for GVP Bridge Project

## Project Context

You are working on **GVP Bridge** - a hybrid architecture that connects a **Tauri + SolidJS desktop application** to a **thin Chrome extension** via WebSocket. The extension acts as a minimal bridge that only handles browser-specific DOM operations on Grok's website.

### Architecture Overview
```
┌─────────────────────┐     WebSocket      ┌──────────────────────┐
│   Desktop App       │ ◄────────────────► │   Chrome Extension   │
│   (Tauri + SolidJS) │      :8765         │   (Minimal Bridge)   │
│                     │                    │                      │
│  • Full UI          │                    │  • DOM operations    │
│  • State management │                    │  • URL monitoring    │
│  • Prompt storage   │                    │  • Event forwarding  │
│  • Settings         │                    │  • Message relay     │
└─────────────────────┘                    └──────────────────────┘
         │                                          │
         │                                          ▼
         │                                  ┌──────────────────┐
         │                                  │   Grok Website   │
         │                                  │   (x.com/i/grok) │
         │                                  └──────────────────┘
         │
         ▼
   User interacts here
```

### Core Flow
1. User types prompt in desktop app
2. User clicks gallery card on Grok (URL changes to `/imagine/post/{imageId}`)
3. Extension detects URL change
4. Extension requests prompt from desktop app via WebSocket
5. Extension injects prompt into TipTap editor
6. Extension fakes Enter key or clicks send button

---

## Critical Rules

### 1. Scope Limitation - STAY FOCUSED
- **DO NOT** reimplement features from the original GVP extension
- **DO NOT** add features the user didn't request
- **ONLY** implement the minimal bridge functionality:
  - URL change detection
  - WebSocket communication
  - Prompt injection into TipTap
  - Submit button clicking

### 2. Reference, Don't Copy
- The original GVP codebase is for **reference only**
- Look at `ReactAutomation.js` for how prompt injection works
- Look at `selectors.js` for DOM selector patterns
- **DO NOT** copy-paste entire files - extract only what's needed

### 3. File Size Constraints
- Keep extension files **under 200 lines each**
- The entire extension should be **under 500 lines total**
- Desktop app components should be **under 300 lines each**
- If a file grows too large, split it logically

### 4. Communication Style
- Explain **what** you're changing and **why**
- Provide file paths for every change
- Use clear, plain English - no jargon without explanation
- When in doubt, ask for clarification

### 5. Incremental Changes
- Make **one logical change at a time**
- Test after each change
- Don't batch unrelated modifications
- Commit working states before major changes

---

## Code Style Guidelines

### JavaScript/TypeScript
```javascript
// PREFER: Clear, descriptive naming
async function injectPromptIntoEditor(promptText) { ... }

// AVOID: Cryptic abbreviations
async function injPrmpt(txt) { ... }

// PREFER: Early returns for clarity
function validatePrompt(prompt) {
  if (!prompt) return null;
  if (prompt.length > 10000) return null;
  return prompt.trim();
}

// AVOID: Deep nesting
function validatePrompt(prompt) {
  if (prompt) {
    if (prompt.length <= 10000) {
      return prompt.trim();
    }
  }
  return null;
}
```

### Extension Manifest V3
- Use `chrome.scripting` for content script injection
- Use service worker (not background page)
- Permissions: only request what's absolutely needed
- Match patterns: be specific, avoid `<all_urls>`

### WebSocket Protocol
```typescript
// Message format - simple and extensible
interface BridgeMessage {
  type: 'url_changed' | 'prompt_request' | 'prompt_response' | 'status';
  payload: unknown;
  timestamp: number;
}

// Example URL change notification
{
  type: 'url_changed',
  payload: { url: 'https://x.com/i/grok/imagine/post/abc123', imageId: 'abc123' },
  timestamp: 1699999999999
}
```

---

## Architecture Decisions (NON-NEGOTIABLE)

### 1. Extension is a Dumb Bridge
The extension should have **zero business logic**. It only:
- Monitors URL changes
- Receives prompts from desktop app
- Injects prompts into DOM
- Reports success/failure back

### 2. Desktop App is the Brain
All logic lives in the desktop app:
- Prompt storage and management
- User preferences
- Queue management (if added later)
- Error handling strategies

### 3. WebSocket Server Location
- Desktop app runs WebSocket server on port 8765
- Extension connects as client
- Extension handles reconnection logic

### 4. Error Handling Philosophy
- Extension silently retries on failure
- Desktop app shows user-facing errors
- Log everything for debugging, but don't spam console

---

## What NOT To Do

### ❌ Don't Build These (Yet)
- Video queue system
- Batch processing
- Upload automation
- Prompt library
- Settings synchronization
- Multi-account support
- Gallery overlay UI

### ❌ Don't Use These Patterns
- Complex state management in extension (Redux, etc.)
- Shadow DOM (not needed for minimal bridge)
- Multiple content scripts
- Background script message passing chains

### ❌ Don't Assume
- User has original GVP installed
- Grok's DOM structure is stable
- WebSocket connection is always available
- Prompt injection always succeeds

---

## Development Workflow

### Before Making Changes
1. Check what files already exist
2. Read relevant existing code
3. Understand the current state
4. Plan the minimal change needed

### When Making Changes
1. Write the change
2. Verify syntax is correct
3. Check for TypeScript errors (if applicable)
4. Document what changed

### After Making Changes
1. Summarize what was done
2. Note any follow-up needed
3. List any assumptions made

---

## File Organization

### Extension Structure (Target)
```
extension/
├── manifest.json          # MV3 manifest
├── content.js            # Main content script (~100 lines)
├── ws-client.js          # WebSocket client (~50 lines)
├── dom-ops.js            # DOM operations (~80 lines)
└── selectors.js          # Grok DOM selectors (~30 lines)
```

### Desktop App Structure (Target)
```
desktop-app/
├── src/
│   ├── App.tsx           # Main app component
│   ├── components/
│   │   ├── PromptInput.tsx
│   │   ├── StatusBar.tsx
│   │   └── Settings.tsx
│   ├── services/
│   │   └── ws-server.ts  # WebSocket server
│   └── stores/
│       └── app-store.ts  # SolidJS signals/stores
├── src-tauri/
│   └── ...               # Rust backend
└── package.json
```

---

## Grok DOM Selectors Reference

Based on original GVP's `selectors.js`, key selectors for prompt injection:

```javascript
// TipTap editor (prompt input)
const PROMPT_EDITOR = '[contenteditable="true"][data-slate-editor]';

// Submit/send button
const SUBMIT_BUTTON = 'button[type="submit"]';

// Video mode button (if needed)
const VIDEO_MODE_BUTTON = '[data-testid="video-mode-button"]';

// Image in post view
const IMAGE_VIEW = 'img[src*="/imagine/"]';

// URL pattern for detection
const POST_URL_PATTERN = /\/imagine\/post\/([a-f0-9-]+)/;
```

**Note:** These may change. Always verify against current Grok DOM.

---

## Testing Checklist

When user tests a change:
1. [ ] Extension loads without errors
2. [ ] WebSocket connects to desktop app
3. [ ] URL change is detected when clicking gallery card
4. [ ] Prompt is received from desktop app
5. [ ] Prompt appears in Grok's editor
6. [ ] Submit happens (Enter key or button click)
7. [ ] Error state shows in desktop app if something fails

---

## Context for Gemini Flash

You are being asked to help build this project incrementally. The human will:
- Tell you what file to work on
- Provide context from Knowledge Items
- Test your changes
- Report back with results

Your job is to:
- Write clean, minimal code
- Explain your changes clearly
- Ask questions when requirements are unclear
- Stay within the scope defined above

**Remember:** This is a rewrite/simplification of an existing complex extension. We are NOT building all features - just the minimal bridge pattern. Less is more.

---

## Quick Reference Commands

| Task | Command/Action |
|------|---------------|
| Check for TypeScript errors | `npx tsc --noEmit` |
| Build extension for testing | Load `extension/` folder in Chrome |
| Start desktop app dev | `npm run tauri dev` |
| Check WebSocket connection | Desktop app status bar shows connected |

---

## Version Tracking

| Version | Date | Changes |
|---------|------|---------|
| 0.0.1 | TBD | Initial workspace setup |

---

*Last updated: Session continuation from GVP architecture analysis*
