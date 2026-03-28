---
description: MANDATORY bootstrap workflow for all fresh sessions. Loads project context, rules, knowledge items, and prepares the LLM for work on GVP Bridge project.
---

# /start — GVP Bridge Session Bootstrap

> **INVOKE THIS WORKFLOW AT THE START OF EVERY FRESH SESSION.**
> This workflow loads all necessary context and prepares you for implementation work.

---

## Phase 0: Save Implementation Plan (FIRST PRIORITY)

> **THIS IS THE FIRST THING YOU DO - BEFORE LOADING ANY CONTEXT**

**Step 0.1 — Check if user provided an implementation plan:**
If the user provided an implementation plan alongside this workflow:

1. Read the plan content
2. Generate version suffix: `v1_YYYYMMDD_HHMM` (use current date/time)
3. Save a copy to: `A:\Tools n Programs\GVP-Desktop\.agents\plans\`
4. Filename format: `[PLAN_NAME]_[VERSION].md`
   - Example: `PLAN_001_EXTENSION_MVP_v1_20250328_1430.md`

**Step 0.2 — Confirm plan saved:**
Output:
```
✅ PLAN SAVED: .agents/plans/[filename]
```

If NO plan was provided, output:
```
ℹ️ NO PLAN PROVIDED: Will check for existing plans in .agents/plans/
```

**Step 0.3 — List available plans:**
Read the `.agents/plans/` folder and list any existing plans.

---

## Phase 1: Load Core Rules

**Step 1.1 — Read the project rules:**
Read and internalize: `A:\Tools n Programs\GVP-Desktop\.agents\rules.md`

This file contains:
- Project context and architecture overview
- Critical rules (scope limitation, file size constraints, etc.)
- Code style guidelines
- Architecture decisions (non-negotiable)
- What NOT to build
- Development workflow

**Step 1.2 — Confirm rules loaded:**
Output:
```
✅ RULES LOADED: GVP Bridge project scope understood
```

---

## Phase 2: Load Architecture Context

**Step 2.1 — Read the architecture map:**
Read: `A:\Tools n Programs\GVP-Desktop\.agents\ARCHITECTURE.md`

This file contains:
- Complete feature & file dependency graph (Mermaid)
- File inventory (76 JavaScript files from original GVP)
- Feature-to-file mapping
- Data flow architecture
- Storage architecture
- Key integration points

**Step 2.2 — Read Knowledge Items metadata:**
Read: `A:\Tools n Programs\GVP-Desktop\.agents\metadata.json`

**Step 2.3 — Load relevant Knowledge Items:**
Based on the task at hand, load the appropriate KIs from `A:\Tools n Programs\GVP-Desktop\.agents\knowledge_items\`:

### Most Relevant KIs for GVP Bridge MVP

| KI Folder | What It Covers | When to Load |
|-----------|----------------|--------------|
| `gvp-tiptap-prosemirror-injection` | How to inject prompts into Grok's editor | **ALWAYS** - core functionality |
| `gvp-manager-pattern-architecture` | Manager class patterns | When building extension structure |
| `gvp-dual-layer-fetch-interception` | Network interception | If implementing fetch override |
| `gvp-network-guard-gatekeeper` | Request/response protection | Advanced features |
| `gvp-shadow-dom-isolation` | Shadow DOM patterns | **SKIP** - not needed for minimal bridge |
| `gvp-indexeddb-schema-v19` | IndexedDB patterns | **SKIP** - not needed for MVP |
| `gvp-video-queue-pipeline` | Video queue system | **SKIP** - not building this |
| `gvp-gallery-mini-ui-rails` | Gallery UI | **SKIP** - not building this |
| `gvp-unified-queue-history-flow` | Queue management | **SKIP** - not building this |
| `gvp-multi-tab-synchronization` | Tab sync | **SKIP** - not building this |
| `gvp-account-isolation-architecture` | Account handling | **SKIP** - not building this |
| `gvp-terminal-state-persistence` | State persistence | **SKIP** - not building this |
| `gvp-sse-json-stream-decoding` | Stream parsing | **SKIP** - not building this |
| `gvp-toast-notification-system` | Toast notifications | **SKIP** - not building this |
| `gvp-triple-layer-defense` | Security layers | **SKIP** - not building this |

**Step 2.4 — Confirm architecture loaded:**
Output:
```
✅ ARCHITECTURE LOADED: [list which KIs were loaded]
```

---

## Phase 3: Load Reference Documentation

**Step 3.1 — Read reference files:**
Read the following reference files (extracted from original GVP for guidance):
- `A:\Tools n Programs\GVP-Desktop\REFERENCE_ReactAutomation.md` — How prompt injection works
- `A:\Tools n Programs\GVP-Desktop\REFERENCE_Selectors.md` — Grok DOM selectors

**Step 3.2 — Read project context:**
Read: `A:\Tools n Programs\GVP-Desktop\PROJECT_CONTEXT.md`

This contains current project state and priorities.

---

## Phase 4: Load Session State

**Step 4.1 — Check for handover document:**
Look for: `A:\Tools n Programs\GVP-Desktop\.agents\HANDOVER.md`

If exists, read it completely. It contains:
- What was done in the previous session
- Current project state
- What needs to be done next
- Priority order for tasks
- Any blockers or issues

**Step 4.2 — Check for changelog:**
Look for: `A:\Tools n Programs\GVP-Desktop\.agents\CHANGELOG.md`

If exists, read the last 20-30 entries to understand recent changes.

**Step 4.3 — Confirm session state loaded:**
Output:
```
✅ SESSION STATE LOADED:
   Handover: [FOUND/NOT FOUND]
   Changelog: [N entries reviewed]
   Active Plan: [Plan filename or NONE]
```

---

## Phase 5: Reference to Original GVP

**Step 5.1 — Understand the reference relationship:**
The original GVP extension is located at:
```
A:\Tools n Programs\SD-GrokScripts\grok-video-prompter-extension\
```

This is for **REFERENCE ONLY**. Look at files there to understand patterns, but:
- **DO NOT** copy entire files
- **DO NOT** recreate complex features
- **ONLY** extract minimal patterns needed for the bridge

---

## Phase 6: Ready Confirmation

After completing all phases, output the session ready banner:

```
╔══════════════════════════════════════════════════════════════════════╗
║  GVP BRIDGE SESSION READY                                            ║
║                                                                      ║
║  Plan Saved: ✅ [filename or "No new plan"]                          ║
║  Rules: ✅ Loaded                                                    ║
║  Architecture: ✅ Loaded (KIs: [list KI names])                      ║
║  Session State: ✅ [Handover status]                                 ║
║  Reference Docs: ✅ ReactAutomation, Selectors                       ║
║                                                                      ║
║  Ready for: [NEXT TASK from handover OR plan execution]             ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## ⛔ CRITICAL: ARTIFACT STORAGE LOCATION

**ALL artifacts must be stored in the PROJECT folder:**
```
A:\Tools n Programs\GVP-Desktop\.agents\
```

**DO NOT store anything in:**
```
C:\Users\Greepo\.gemini\antigravity\brain\
C:\Users\Greepo\.gemini\antigravity\context\
```

These folders are WIPED between sessions. All work must be persisted in the project folder.

### Required Storage Locations

| Artifact Type | Location |
|---------------|----------|
| Plans | `A:\Tools n Programs\GVP-Desktop\.agents\plans\` |
| Reports | `A:\Tools n Programs\GVP-Desktop\.agents\reports\` |
| Handover | `A:\Tools n Programs\GVP-Desktop\.agents\HANDOVER.md` |
| Changelog | `A:\Tools n Programs\GVP-Desktop\.agents\CHANGELOG.md` |
| Work artifacts | `A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[DATE]\` |

---

## Appendix: Project File Structure

```
A:\Tools n Programs\GVP-Desktop\
├── .agents\                          ← ALL artifacts go here
│   ├── rules.md
│   ├── ARCHITECTURE.md
│   ├── metadata.json
│   ├── HANDOVER.md
│   ├── CHANGELOG.md
│   ├── knowledge_items\
│   ├── workflows\
│   ├── plans\                        ← Implementation plans
│   │   └── PLAN_XXX_v1_YYYYMMDD_HHMM.md
│   └── reports\                      ← Reports and artifacts
│       └── PLAN_XXX_YYYYMMDD\
│           ├── REPORT.md
│           ├── PLAN_COPY.md
│           └── [modified files]
│
├── src-desktop\
├── src-extension\
├── src-tauri\
│
├── package.json
├── PROJECT_CONTEXT.md
├── README.md
├── REFERENCE_ReactAutomation.md
└── REFERENCE_Selectors.md
```

---

*Workflow version: 1.1.0*
*Last updated: Added plan saving as first step, artifact storage requirements*
