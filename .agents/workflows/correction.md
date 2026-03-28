---
description: Workflow for handling corrections when implementation reports have errors, inconsistencies, or missing/hallucinated content.
---

# /correction — GVP Bridge Correction Protocol

> **INVOKE THIS WORKFLOW WHEN A REPORT IS REJECTED.**
> Guides proper correction handling without introducing new errors.

---

## ⛔ CRITICAL: ARTIFACT STORAGE

**ALL corrections and updated artifacts MUST be stored in the PROJECT folder:**
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

## Phase 1: Correction Intake

**Step 1.1 — Read the ENTIRE correction:**
Before touching any file, read the complete correction message. Identify:
- Which tasks/steps have issues
- What the specific problems are
- What the correct action should be

**Step 1.2 — Acknowledge the correction:**
Output:
```
CORRECTION RECEIVED:
Issues found: [N]
Affected files: [list]
Tasks requiring correction: [list task numbers]
Artifact folder: .agents/reports/[PLAN_NAME]_[YYYYMMDD]/
```

**Step 1.3 — Create correction task list:**
Update `TASK_LIST.md` in the artifact folder with correction tasks:

```markdown
## CORRECTION TASKS

[ ] Correction 1: [Issue description]
[ ] Correction 2: [Issue description]

Total corrections: [N]
```

---

## Phase 2: Apply Corrections

### Rule 2.1 — One Correction at a Time
Apply Correction 1 completely before starting Correction 2.

### Rule 2.2 — Only Touch What's Specified
The correction will specify:
- The exact file
- The exact location
- The exact change needed

Do not touch anything else.

### Rule 2.3 — Verify After Each Correction
After applying each correction:
1. Re-read the modified section
2. Confirm it matches what was requested
3. Confirm no other lines were affected

### Rule 2.4 — If Correction Seems Wrong
If the correction itself seems incorrect or impossible:
1. **STOP**
2. Do not apply it
3. Write: `GEMINI_QUESTION: [Your specific concern]`
4. Wait for clarification

### Rule 2.5 — Update Artifact Folder
After each correction:
1. Update the file copy in the artifact folder
2. Update `TASK_LIST.md` with correction status

---

## Phase 3: Correction Report

> After applying ALL corrections, update the artifact folder.

### Step 3.1 — Create CORRECTION_REPORT.md

Create in the artifact folder:
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\CORRECTION_REPORT.md
```

### Correction Report Template

```markdown
## CORRECTION REPORT — [Plan Name]

**Date:** [YYYY-MM-DD]
**Corrections Applied:** [N]
**Files Modified:** [list]
**Artifact Folder:** .agents/reports/[PLAN_NAME]_[YYYYMMDD]/

---

### CORRECTION 1 — [Issue Description]

**Issue:** [What was wrong]
**File:** `src-extension/filename.js`
**Location:** `methodName()` at line ~[N]

**Code BEFORE correction:**
```javascript
// What it looked like with the error
```

**Code AFTER correction:**
```javascript
// What it looks like now, corrected
```

**Verification:** [One sentence confirming the fix]

---

### CORRECTION 2 — [Issue Description]

[Same format]

---

## CORRECTION VERIFICATION

| Original Issue | Status |
|----------------|--------|
| [Issue 1 from correction] | ✅ Fixed |
| [Issue 2 from correction] | ✅ Fixed |

---

## SIDE EFFECTS CHECK

| Check | Result |
|-------|--------|
| Modified only corrected locations? | YES / NO |
| Introduced any new changes? | NO / YES — explain |
| All files still syntactically valid? | YES / NO |
| Artifact folder updated? | YES / NO |
| NOTHING saved to brain/context folders? | YES / NO |

---

## AWAITING APPROVAL

Corrections applied. Ready for re-review.
```

---

## Phase 4: Update Original Report

**Step 4.1 — Update REPORT.md:**
Update the original implementation report in the artifact folder:
- Mark corrected tasks with `(CORRECTED)`
- Update code snippets to show corrected content
- Add a "Corrections Applied" section at the end

**Step 4.2 — Update file copies:**
Replace the modified files in the artifact folder with corrected versions.

**Step 4.3 — Update TASK_LIST.md:**
Mark correction tasks as complete:
```markdown
[✅] Correction 1: [Issue] — FIXED
[✅] Correction 2: [Issue] — FIXED
```

**Step 4.4 — Confirm updates:**
```
✅ CORRECTIONS COMPLETE
   Main report updated: .agents/reports/[PLAN_NAME]_[YYYYMMDD]/REPORT.md
   Correction report: .agents/reports/[PLAN_NAME]_[YYYYMMDD]/CORRECTION_REPORT.md
   File package updated: [N] files replaced
   Storage location: PROJECT FOLDER (persistent)
```

---

## Appendix A: Artifact Folder After Corrections

```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
├── REPORT.md              ← Updated with corrections
├── CORRECTION_REPORT.md   ← New: correction details
├── PLAN_COPY.md           ← Unchanged
├── TASK_LIST.md           ← Updated with correction tasks
├── [file1.js]             ← Updated (corrected version)
├── [file2.js]             ← Updated (corrected version)
└── ...
```

---

## Appendix B: Common Correction Types

| Type | Description | How to Handle |
|------|-------------|---------------|
| **Missing change** | Task was claimed complete but not actually done | Find the location and apply the change |
| **Wrong location** | Change was applied to wrong method/file | Find correct location, move the change |
| **Hallucinated code** | Code shown in report doesn't match actual file | Read actual file, report truthfully |
| **Extra changes** | You modified things not in the plan | Revert those changes |
| **Syntax error** | Change introduced invalid syntax | Fix the syntax while staying close to plan intent |
| **Incomplete change** | Only part of the planned change was applied | Complete the remaining parts |

---

## Appendix C: What NOT to Do During Correction

| Don't | Why |
|-------|-----|
| Fix "similar issues" elsewhere | Scope creep — stay focused |
| Refactor the corrected code | Not in correction scope |
| Add comments explaining the fix | Not requested |
| Delete code to "clean up" | Might break things |
| Assume reviewer is wrong | Apply correction as given, ask if unclear |
| Save to brain/context folders | Will be wiped between sessions |

---

## Appendix D: Escalation

If the correction:
1. **Asks for something impossible** → Write `GEMINI_QUESTION: [issue]` and stop
2. **Contradicts the original plan** → Write `GEMINI_QUESTION: Correction conflicts with plan step [N]` and stop
3. **Seems to introduce a bug** → Write `GEMINI_WARNING: This correction may cause [specific issue]` but apply it anyway

---

*Workflow version: 1.1.0*
*Last updated: Added artifact storage requirements*
