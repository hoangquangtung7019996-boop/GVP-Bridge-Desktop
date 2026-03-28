---
description: MANDATORY workflow for producing comprehensive implementation reports. Documents every change with proof for reviewer verification.
---

# /report — GVP Bridge Implementation Report

> **INVOKE THIS WORKFLOW AFTER COMPLETING AN IMPLEMENTATION PLAN.**
> Produces comprehensive documentation of all changes made.

---

## ⛔ CRITICAL: ARTIFACT STORAGE LOCATION

**ALL reports and artifacts MUST be stored in the PROJECT folder:**
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\
```

**DO NOT store anything in these locations:**
```
❌ C:\Users\Greepo\.gemini\antigravity\brain\
❌ C:\Users\Greepo\.gemini\antigravity\context\
```

These folders are **WIPED between sessions**. All work must be persisted in the project folder.

---

## Phase 1: Preparation

**Step 1.1 — Confirm artifact folder exists:**
Verify that the artifact folder was created during implementation:
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
```

If it doesn't exist, create it now.

**Step 1.2 — Gather modified files:**
List every file that was touched during implementation.

**Step 1.3 — Read each modified file:**
Read the current state of each file. You need exact content for the report.

**Step 1.4 — Reference the plan:**
Have the implementation plan ready for cross-referencing.

**Step 1.5 — Reference the task list:**
Have your completed task list from `TASK_LIST.md` ready.

---

## Phase 2: Create Report Structure

Create the report file at:
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\REPORT.md
```

### Required Report Template

```markdown
╔══════════════════════════════════════════════════════════════════════╗
║  GVP BRIDGE IMPLEMENTATION REPORT                                    ║
║  Plan: [Plan name]                                                   ║
║  Date: [YYYY-MM-DD]                                                  ║
║  Status: ✅ COMPLETE / ⚠️ PARTIAL / ❌ FAILED                        ║
╚══════════════════════════════════════════════════════════════════════╝

---

## STORAGE LOCATION

**Artifact Folder:** `A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\`

This folder contains:
- `REPORT.md` (this file)
- `PLAN_COPY.md` (plan executed)
- `TASK_LIST.md` (task checklist)
- Post-edit copies of all modified files

---

## SECTION 1 — SUMMARY

**Plan Name:** [Name]
**Features Implemented:** [N] of [N]
**Total Steps:** [N]
**Steps Completed:** [N]
**Files Modified:** [N]

| File | Changes | Lines |
|------|---------|-------|
| `src-extension/content.js` | [Description] | ~N |

---

## SECTION 2 — CHANGE LOG

> One entry per task. Every entry must have ALL fields.

---

### CHANGE 1 — [Task Description]

**Task:** [Copy exact task from task list]
**File:** `src-extension/filename.js`
**Location:** `methodName()` at line ~[N]
**Action:** [INSERT BEFORE / INSERT AFTER / REPLACE WITH]

**Find block (from actual file):**
```javascript
// Paste the EXACT code you found in the file
// This is not from the plan — it's what was actually there
```

**Code written (now in file):**
```javascript
// Paste the EXACT code now in the file
// Not paraphrased — the literal content
```

**Verification:** [One sentence confirming it's correct and in the right place]

---

### CHANGE 2 — [Task Description]

[Same format]

---

[Continue for ALL changes]

---

## SECTION 3 — NEW SYMBOLS INTRODUCED

| Symbol | Type | File | Purpose |
|--------|------|------|---------|
| `functionName` | function | `src-extension/file.js` | [What it does] |
| `propertyName` | property | `src-desktop/file.tsx` | [What it stores] |

If none: Write "No new symbols introduced."

---

## SECTION 4 — UNCERTAINTY LOG

| File | Task | Issue |
|------|------|-------|
| `src-extension/file.js` | Task N | [GEMINI_UNCERTAIN reason] |

If none: Write "No uncertainties encountered."

---

## SECTION 5 — VERIFICATION CHECKLIST

### Scope Control
| Check | Result |
|-------|--------|
| Modified only files in plan? | YES / NO |
| Added code not in plan? | NO / YES — explain |
| Removed code not in plan? | NO / YES — explain |
| Refactored unrequested code? | NO / YES — explain |
| Renamed anything not in plan? | NO / YES — explain |

### Artifact Storage
| Check | Result |
|-------|--------|
| Report saved to `.agents\reports\`? | YES / NO |
| Plan copy in artifact folder? | YES / NO |
| Task list in artifact folder? | YES / NO |
| Modified files copied to artifact folder? | YES / NO |
| NOTHING saved to `brain\` or `context\`? | YES / NO |

### Symbol Verification
| Symbol | File | Exists? |
|--------|------|---------|
| `[symbol]` | `[file]` | YES / NO |

### Completeness
| Check | Result |
|-------|--------|
| All tasks from plan completed? | YES / NO |
| All GEMINI_UNCERTAIN documented? | YES / NO |
| All changes have code snippets? | YES / NO |

---

## SECTION 6 — FINAL STATUS

```
┌──────────────────────────────────────────┐
│  Features:     [N] / [N]                 │
│  Tasks:        [N] / [N]                 │
│  Files:        [N] modified              │
│  Uncertainties: [N]                      │
│  Status:       ✅ / ⚠️ / ❌              │
└──────────────────────────────────────────┘
```

If PARTIAL or FAILED: List exactly which tasks were not completed and why.

---

## SECTION 7 — ARTIFACT PACKAGE

The following files are in the artifact folder:

```
.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
├── REPORT.md              (this file)
├── PLAN_COPY.md           (plan executed)
├── TASK_LIST.md           (task checklist)
├── [file1.js]             (post-edit copy)
├── [file2.js]             (post-edit copy)
└── ...
```

---

## AWAITING REVIEW

Submit this report for review. The reviewer will:
1. Check each change against the plan
2. Verify code snippets are accurate
3. Run tests if applicable
4. Approve or send corrections

Do not proceed to next feature until approved.
```

---

## Phase 3: Create File Package

**Step 3.1 — Confirm artifact folder:**
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
```

**Step 3.2 — Copy modified files:**
For each file modified during implementation:
1. Read the current (post-edit) file
2. Write a copy to the artifact folder
3. Keep the same filename (no subdirectories)

**Step 3.3 — Verify PLAN_COPY.md exists:**
The plan copy should already be in the artifact folder from the implement workflow.

**Step 3.4 — Verify TASK_LIST.md exists:**
The task list should already be in the artifact folder from the implement workflow.

**Step 3.5 — Verify package contents:**
The folder MUST contain:
- `REPORT.md`
- `PLAN_COPY.md`
- `TASK_LIST.md`
- Post-edit copies of ALL modified files
- All files flat (no subdirectories)

---

## Phase 4: Report Submission

**Step 4.1 — Output the report:**
Display the complete report in your response.

**Step 4.2 — Confirm package created:**
```
✅ REPORT COMPLETE
   Report file: .agents/reports/[PLAN_NAME]_[YYYYMMDD]/REPORT.md
   Artifact folder: .agents/reports/[PLAN_NAME]_[YYYYMMDD]/
   Files in package: [N]
   Storage location: PROJECT FOLDER (persistent)
```

**Step 4.3 — Await review:**
Stop and wait for the reviewer to approve or send corrections.

---

## Appendix A: Artifact Folder Structure

Every implementation MUST create this structure:

```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
├── REPORT.md              ← Work report (this file)
├── PLAN_COPY.md           ← Copy of plan executed
├── TASK_LIST.md           ← Task checklist with status
├── selectors.js           ← Post-edit copy (example)
├── content.js             ← Post-edit copy (example)
├── ws-client.js           ← Post-edit copy (example)
├── dom-ops.js             ← Post-edit copy (example)
└── manifest.json          ← Post-edit copy (example)
```

---

## Appendix B: Report Rejection Criteria

A report will be **REJECTED** if:

| Issue | Why It's Rejected |
|-------|-------------------|
| Missing change entries | Not all changes documented |
| Paraphrased code | "Find block" shows plan text, not actual file content |
| Missing code snippets | "Code written" is described, not shown |
| Fabricated snippets | Code shown doesn't match actual file |
| Missing symbols | New symbols not listed in Section 3 |
| Incomplete verification | Checklist has unexplained YES in wrong places |
| Package incomplete | Missing REPORT.md, PLAN_COPY.md, TASK_LIST.md, or files |
| Wrong storage location | Anything saved to `brain\` or `context\` folders |
| Tasks claimed but not shown | Task list shows complete but no corresponding change entry |

A rejected report must be regenerated before proceeding.

---

## Appendix C: Storage Verification

Before submitting, verify:

| Check | Expected |
|-------|----------|
| Artifact folder in `.agents\reports\`? | YES |
| NOTHING in `C:\Users\Greepo\.gemini\antigravity\brain\`? | YES |
| NOTHING in `C:\Users\Greepo\.gemini\antigravity\context\`? | YES |

---

*Workflow version: 1.1.0*
*Last updated: Added strict artifact storage requirements*
