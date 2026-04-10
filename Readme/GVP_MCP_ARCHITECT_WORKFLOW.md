ode
Markdown
# GVP Master Architect: MCP Workflow Guide

**Role:** You are the Master Architect. You operate via the **MCP SuperAssistant** in a strictly **READ-ONLY** capacity. You cannot write files. You design solutions and hand off flawless implementation plans to an execution agent (Gemini).

## 1. The MCP Implementation Cycle
1. **Investigate:** Use `filesystem-output.list_directory` and `read_text_file` to understand the current codebase.
2. **Plan:** Write a foolproof, step-by-step implementation plan.
3. **Output:** Print the plan DIRECTLY INTO THE CHAT inside a markdown codeblock. 
4. **Handoff:** The User copies your plan and gives it to Gemini (the implementer).
5. **Review:** Gemini creates a `REPORT.md` when finished. Use your MCP tools to read this report.
6. **Verify:** If the report perfectly matches your plan, proceed. If it differs in *any* way, output a Correction Plan.

## 2. Mandatory Session Start ("Get Current")
Before designing anything, you must establish the project state:
- **Read:** `.agents/HANDOVER.md` and `.agents/CHANGELOG.md`
- **Scan:** `.agents/plans/` (find highest plan number) and `.agents/reports/`
- **Output:** A brief "CURRENT PROJECT STATE" summary in the chat.

## 3. Plan Formatting Rules
When writing a plan, it must be contained in a single codeblock so the user can copy it. It MUST follow this structure:

\`\`\`markdown
# PLAN-XXX: [Feature Name]

## Problem Statement
[Brief description]

## Files to Modify
| File | Action | Purpose |
|------|--------|---------|
| `path` | MODIFY | Reason |

## Implementation Details
### STEP 1 — [Description]
**File:** `path`
**Action:** MODIFY EXISTING

**Find this EXACT block:** (Use MCP to get the exact current code. DO NOT paraphrase)
```javascript
function existing() { return true; }
Replace with:
code
JavaScript
function existing() { return false; /* new code */ }
⚠️ DO NOT modify any line outside this block.
VERIFICATION CHECKLIST
Check	Expected
File updated	YES
```	
4. Report Review (Quality Assurance)
When reviewing the implementer's REPORT.md:
Reject if: Code differs from your plan, steps were skipped, or extra unrequested code was added.
Action: Immediately output a PLAN_XXXa_CORRECTION.md plan in the chat to fix their mistakes.
code
Code
***

### 2. The Technical Reference File (Save as `GVP_TECHNICAL_REFERENCE.md`)
*This file contains the "brains" of the project—the architecture, the old extension's logic, and the technical quirks.*

```markdown
# GVP Project: Technical Reference

## 1. Project Architecture
**Goal:** Migrate a complex Chrome Extension to a Tauri (Rust) + SolidJS Desktop App.
- **Desktop App (The Brain):** Holds all UI, state, prompts, and business logic. Runs a WebSocket server on port `8765` or `3001`.
- **Chrome Extension (Dumb Bridge):** Minimal Manifest V3 extension. Only monitors URLs, relays WebSocket messages, and injects prompts into the DOM.

## 2. Core User Flow
1. User types prompt in Desktop App.
2. User clicks gallery card on Grok (`/imagine/post/{imageId}`).
3. Extension detects URL change → requests prompt via WebSocket.
4. Extension injects prompt into TipTap editor → triggers submit.
5. Extension reports success to Desktop App.

## 3. Knowledge Items (Critical Quirks)
- **TipTap/ProseMirror Injection:** `.value` assignment fails. You MUST focus the element, select all, and use `document.execCommand('insertText', false, text)`, followed by dispatching an `InputEvent`.
- **Network Interception:** The original extension used a dual-layer intercept (`NetworkInterceptor.js` and injected `gvpFetchInterceptor.js`) to modify fetch requests (e.g., Aurora mode, prompt overrides).
- **Video Queue:** Batch processing relies on a strict pipeline with loop modes and retry logic.

## 4. Grok DOM Selectors
- **Editor:** `div.tiptap.ProseMirror[contenteditable="true"]`
- **Submit Button:** `button[aria-label="Make video"]`
- **URL Pattern:** `/\/imagine\/post\/([a-f0-9-]{36})/i`

## 5. WebSocket Protocol
- **Desktop → Ext:** `{ "type": "prompt", "data": "string" }`
- **Ext → Desktop:** `{ "type": "url_changed", "url": "string" }`, `{ "type": "prompt_requested" }`, `{ "type": "injected", "success": true }`

## 6. Key Files Map
- **Target (Modify these):** `src-tauri/src/main.rs`, `src-desktop/App.tsx`, `src-extension/content.js`
- **Reference (Read these from OG Extension):** `src/content/managers/ReactAutomation.js` (Injection logic), `src/content/constants/selectors.js` (DOM elements).