---
description: MANDATORY end-of-session workflow. Reviews conversation, verifies changelog accuracy, creates handover document for next session.
---

# /close-and-prepare — Session Close & Handover Preparation

> **INVOKE THIS WORKFLOW AT THE END OF EVERY SESSION.**
> This workflow ensures clean handover to the next session with no lost context.

---

## ⛔ CRITICAL: ARTIFACT STORAGE VERIFICATION

Before closing, verify ALL artifacts are in the PROJECT folder:
```
A:\Tools n Programs\GVP-Desktop\.agents\
```

**Verify NOTHING is stored in:**
```
❌ C:\Users\Greepo\.gemini\antigravity\brain\
❌ C:\Users\Greepo\.gemini\antigravity\context\
```

These folders are **WIPED between sessions**. Any work there will be LOST.

---

## Phase 1: Conversation Review

**Step 1.1 — Review the entire conversation:**
Scan through all messages exchanged in this session. Identify:
- Tasks that were requested
- Tasks that were completed
- Tasks that were started but not finished
- Issues or blockers encountered
- Decisions made
- Questions asked but not answered

**Step 1.2 — Create a conversation summary:**
Write a brief summary of what was discussed and accomplished:

```
CONVERSATION SUMMARY:
- Requested: [what the user asked for]
- Completed: [what was fully done]
- In Progress: [what was started but not finished]
- Blocked: [what couldn't be done and why]
- Decisions: [key decisions made]
- Open Questions: [unanswered questions]
```

---

## Phase 2: Artifact Verification

**Step 2.1 — List all artifact folders:**
Check `.agents\reports\` for all folders created this session.

**Step 2.2 — Verify each artifact folder contains:**

| Required File | Present? |
|---------------|----------|
| `REPORT.md` | YES/NO |
| `PLAN_COPY.md` | YES/NO |
| `TASK_LIST.md` | YES/NO |
| Post-edit file copies | YES/NO |

**Step 2.3 — Verify storage location:**
Confirm ALL artifacts are in:
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\
```

Output:
```
✅ ARTIFACTS VERIFIED:
   Folders: [N]
   All required files present: YES/NO
   Storage location correct: YES/NO
```

---

## Phase 3: Changelog Verification

**Step 3.1 — Read the current changelog:**
Read: `A:\Tools n Programs\GVP-Desktop\.agents\CHANGELOG.md`

**Step 3.2 — Verify changelog entries:**
For each entry added during this session, verify:
- The change was actually made
- The description is accurate
- No hallucinated changes are listed
- No actual changes are missing

**Step 3.3 — Cross-reference with files:**
For each changed file mentioned in the changelog:
1. Read the file
2. Verify the changes exist as described
3. Confirm no unintended changes were made

**Step 3.4 — Fix any discrepancies:**
If you find:
- **Missing entry**: Add it with correct details
- **Hallucinated entry**: Remove it and note the correction
- **Inaccurate description**: Update it to be accurate

**Step 3.5 — Output verification result:**
```
✅ CHANGELOG VERIFIED:
   Entries reviewed: [N]
   Discrepancies found: [N]
   Corrections made: [N]
```

---

## Phase 4: Handover Document Creation

**Step 4.1 — Create or update HANDOVER.md:**
Write a comprehensive handover document at:
```
A:\Tools n Programs\GVP-Desktop\.agents\HANDOVER.md
```

### Handover Document Template

```markdown
# GVP Bridge — Session Handover

**Session Date:** [YYYY-MM-DD]
**Session Type:** [Planning / Implementation / Review / Debugging]
**Overall Status:** [COMPLETE / PARTIAL / BLOCKED]

---

## What Was Done This Session

### Completed Tasks
1. [Task description with file references]
2. [Task description with file references]

### In-Progress Tasks
1. [Task description] — [status/next step]
2. [Task description] — [status/next step]

### Blocked Tasks
1. [Task description] — [blocker reason]

---

## Files Modified This Session

| File | Changes Made | Lines Changed |
|------|--------------|---------------|
| `src-extension/content.js` | Brief description | ~N lines |

---

## Artifact Folders Created

| Folder | Plan | Status |
|--------|------|--------|
| `.agents/reports/PLAN_001_20250328/` | Extension MVP | ✅ Complete |

---

## Key Decisions Made

1. **[Decision topic]:** [What was decided and why]

---

## Current Project State

### What's Working
- [List working features/components]

### What's Broken/Incomplete
- [List known issues]

### Technical Debt Noted
- [List any debt identified but not addressed]

---

## Priority Order for Next Session

1. **[Highest priority task]**
   - Why: [Reason]
   - Files to load: [List KIs or specific files]
   - Plan: [Link to plan file if exists]

2. **[Next priority task]**
   - Why: [Reason]
   - Files to load: [List KIs or specific files]

---

## Context to Load Next Session

### Must Load
- `.agents\rules.md` — Always required
- `.agents\reports\[PLAN_NAME]\REPORT.md` — Review previous work

### Should Load
- [Additional context that would help]

### Can Skip
- [Context not relevant to next task]

---

## Open Questions / Blockers

1. **[Question/blocker]**
   - Context: [Why this matters]
   - Needed from user: [What you need to proceed]

---

## Session Notes

[Any additional notes, observations, or learnings from this session]
```

---

## Phase 5: Update Metadata

**Step 5.1 — Update timestamp:**
Update `A:\Tools n Programs\GVP-Desktop\.agents\timestamp.json`:
```json
{
  "lastSession": "[YYYY-MM-DD HH:MM]",
  "lastHandover": ".agents/HANDOVER.md",
  "sessionCount": [increment],
  "projectVersion": "[current version]",
  "artifactsCreated": [N]
}
```

**Step 5.2 — Update CHANGELOG.md:**
Add session summary entry:
```markdown
## [X.X.X] - [YYYY-MM-DD]

### Session Summary
- Completed: [N] tasks
- Artifacts: [N] folders in .agents/reports/
- Files modified: [N]

### Added/Changed/Fixed
- [List specific changes]
```

---

## Phase 6: Final Verification

**Step 6.1 — Run through the checklist:**

| Check | Status |
|-------|--------|
| Conversation reviewed? | ✅/❌ |
| Artifacts in correct location? | ✅/❌ |
| NOTHING in brain/context folders? | ✅/❌ |
| Changelog verified? | ✅/❌ |
| Handover document created? | ✅/❌ |
| All changes documented? | ✅/❌ |
| No hallucinated changes? | ✅/❌ |
| Next session priorities clear? | ✅/❌ |
| Context loading guide provided? | ✅/❌ |

**Step 6.2 — Output session close banner:**

```
╔══════════════════════════════════════════════════════════════════════╗
║  SESSION CLOSED & PREPARED                                           ║
║                                                                      ║
║  Handover Document: ✅ .agents/HANDOVER.md                           ║
║  Changelog: ✅ Verified and accurate                                 ║
║  Artifacts: ✅ [N] folders in .agents/reports/                       ║
║  Storage: ✅ Project folder (persistent)                             ║
║                                                                      ║
║  Session Status: [COMPLETE / PARTIAL / BLOCKED]                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Appendix: Storage Checklist

Before closing, confirm:

| Location | Should Contain? |
|----------|-----------------|
| `A:\Tools n Programs\GVP-Desktop\.agents\` | ✅ YES - All work |
| `C:\Users\Greepo\.gemini\antigravity\brain\` | ❌ NO - Wiped |
| `C:\Users\Greepo\.gemini\antigravity\context\` | ❌ NO - Wiped |

---

*Workflow version: 1.1.0*
*Last updated: Added artifact storage verification*
