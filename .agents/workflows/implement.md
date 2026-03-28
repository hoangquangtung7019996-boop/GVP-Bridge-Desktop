---
description: MANDATORY workflow for executing implementation plans. Provides spoonfeeding-level instructions for zero-deviation plan execution.
---

# /implement — GVP Bridge Implementation Protocol

> **INVOKE THIS WORKFLOW BEFORE EXECUTING ANY IMPLEMENTATION PLAN.**
> This workflow governs how you read and execute plans with ZERO autonomy.

---

## ⛔ CRITICAL: ARTIFACT STORAGE

**ALL artifacts MUST be stored in the PROJECT folder:**
```
A:\Tools n Programs\GVP-Desktop\.agents\
```

**DO NOT store anything in these locations:**
```
❌ C:\Users\Greepo\.gemini\antigravity\brain\
❌ C:\Users\Greepo\.gemini\antigravity\context\
```

These folders are **WIPED between sessions**. All work must be persisted in the project folder.

---

## Phase 0: Pre-Implementation Checklist

> Before touching ANY file, complete these steps.

**Step 0.1 — Confirm context is loaded:**
If you haven't run `/start` this session, run it now.

**Step 0.2 — Read the ENTIRE plan:**
Read every step, every note, every warning. Do not start Step 1 until you've read the entire plan.

Output:
```
PLAN READ: [Plan name] | [N] features | [N] total steps | Target files: [list]
```

**Step 0.3 — Verify target files exist:**
For each file mentioned in the plan:
1. Check that the file exists in the correct location:
   - Extension files: `A:\Tools n Programs\GVP-Desktop\src-extension\`
   - Desktop app files: `A:\Tools n Programs\GVP-Desktop\src-desktop\`
   - Tauri backend: `A:\Tools n Programs\GVP-Desktop\src-tauri\`
2. If it doesn't exist, note whether it's a "create new file" operation

**Step 0.4 — Declare your scope:**
Output:
```
IMPLEMENTING: [Feature name]
FILES I WILL TOUCH: [exact list from plan]
FILES I WILL NOT TOUCH: everything else
```

**Step 0.5 — Create task list:**
Create a numbered task list with EVERY step from the plan:

```
TASK LIST — [Plan name]
[ ] Task 1: [Description from plan]
[ ] Task 2: [Description from plan]
[ ] Task 3: [Description from plan]
...
[ ] Task N: [Description from plan]

TOTAL TASKS: [N]
```

**Step 0.6 — Create artifact folder:**
Create the artifact folder for this implementation:
```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
```

This folder will contain:
- `PLAN_COPY.md` — Copy of the plan being executed
- `TASK_LIST.md` — Task list with completion status
- Post-edit copies of all modified files
- `REPORT.md` — Final work report

**Step 0.7 — Copy plan to artifact folder:**
Copy the implementation plan to the artifact folder as `PLAN_COPY.md`.

---

## Phase 1: Plan Execution

> Execute each step in order. One at a time. No parallelization.

### Rule 1.1 — One Step at a Time
Execute Task 1 completely before starting Task 2. Do not skip ahead. Do not reorder.

### Rule 1.2 — Find Strings Are EXACT
Every plan step contains a "Find this exact block" section. That text is copied **verbatim** from the actual file.

**If you cannot find the exact string:**
1. Read the file again from the beginning
2. Search for key identifiers (method names, variable names, comments)
3. If still not found after 2 attempts, write:
   ```
   // GEMINI_UNCERTAIN: Cannot locate find string "[first 30 chars]" — step skipped pending clarification
   ```
4. Continue to the next step
5. **DO NOT** invent an alternative location
6. **DO NOT** apply to a similar-looking method

### Rule 1.3 — Replacements Are COMPLETE
When a plan provides replacement code:
- Insert it **exactly** as written
- Do not truncate with `// ... rest of method`
- Do not "simplify" it
- Do not add lines not shown
- Do not remove lines you think are redundant
- Do not change variable names
- Do not add debugging statements

### Rule 1.4 — The DO NOT Boundary
Every step ends with:
```
⚠️ DO NOT modify any line outside this block.
```

This means:
- The line above the find string stays untouched
- The line below the replacement stays untouched
- If implementing requires touching nearby lines → **STOP and ask user**

### Rule 1.5 — Ask Before Assuming
If ANYTHING is unclear:
1. **STOP**
2. Do not write any code
3. Ask the user for clarification
4. Wait for response before continuing

**Better to ask than to guess wrong.**

### Rule 1.6 — Verify After Each Step
After completing each step:
1. Re-read the modified file
2. Compare to the plan
3. Confirm find string was located correctly
4. Confirm replacement matches plan exactly
5. Confirm no surrounding lines were altered

### Rule 1.7 — Update Task List
After completing each task, update `TASK_LIST.md` in the artifact folder:
```
[✅] Task 1: [Description] — COMPLETE
[ ] Task 2: [Description] — PENDING
```

---

## Phase 2: Handling Uncertainty

### When to Use GEMINI_UNCERTAIN
Use this marker when:
- Find string cannot be located after 2 attempts
- The plan references something that doesn't exist
- There's a genuine conflict in the plan

### How to Mark It
```javascript
// GEMINI_UNCERTAIN: [Specific question or issue]
```

### What NOT to Do
- Do not skip the step silently
- Do not make your best guess
- Do not assume the plan is wrong

---

## Phase 3: Completion & Reporting

> After implementing ALL steps in the current feature, produce a Work Report. Then STOP.

### Rule 3.1 — STOP After One Feature
**IMPLEMENT ONE FEATURE. PRODUCE WORK REPORT. STOP.**

Do not:
- Continue to Feature 2 "because you have time"
- Fix something you noticed "while you're there"
- Add a "quick improvement"

### Rule 3.2 — Create Report in Artifact Folder
After completing all tasks, create `REPORT.md` in the artifact folder:

```
A:\Tools n Programs\GVP-Desktop\.agents\reports\[PLAN_NAME]_[YYYYMMDD]\REPORT.md
```

### Rule 3.3 — Report Format

```markdown
## WORK REPORT — [Feature Name]
**Plan:** [Plan name]
**Date:** [YYYY-MM-DD]
**Artifact Folder:** .agents/reports/[PLAN_NAME]_[YYYYMMDD]/
**Files Modified:** [list]
**Tasks Completed:** [N] / [N]

---

### TASK 1 — [Description]
**File:** `src-extension/filename.js`
**Method:** `methodName()`

**Find block located:**
```javascript
[paste the exact code you found in the file]
```

**Code written:**
```javascript
[paste exactly what you inserted/replaced]
```

**Status:** ✅ Complete / ⚠️ GEMINI_UNCERTAIN

---

### TASK 2 — [Description]
[Same format]

---

[Continue for all tasks]

---

## VERIFICATION CHECKLIST

| Check | Result |
|-------|--------|
| Modified only files in plan? | YES/NO |
| Removed existing methods not in plan? | YES/NO |
| Added code not in plan? | YES/NO |
| Refactored unrequested code? | YES/NO |
| All GEMINI_UNCERTAIN noted? | [List or NONE] |
| All tasks marked complete? | YES/NO |

---

## ARTIFACT FOLDER CONTENTS

This folder contains:
- `REPORT.md` (this file)
- `PLAN_COPY.md` (plan executed)
- `TASK_LIST.md` (task checklist)
- [List post-edit file copies]

---

## AWAITING APPROVAL

Submit this report for review. Do not proceed to next feature until approved.
```

### Rule 3.4 — Copy Modified Files to Artifact Folder
Copy all modified files to the artifact folder for reference.

---

## Appendix A: Project File Locations

| Component | Location |
|-----------|----------|
| Chrome Extension | `A:\Tools n Programs\GVP-Desktop\src-extension\` |
| Desktop App (SolidJS) | `A:\Tools n Programs\GVP-Desktop\src-desktop\` |
| Tauri Backend (Rust) | `A:\Tools n Programs\GVP-Desktop\src-tauri\` |
| Plans | `A:\Tools n Programs\GVP-Desktop\.agents\plans\` |
| Reports & Artifacts | `A:\Tools n Programs\GVP-Desktop\.agents\reports\` |

---

## Appendix B: Artifact Folder Structure

```
.agents\reports\[PLAN_NAME]_[YYYYMMDD]\
├── REPORT.md              ← Work report
├── PLAN_COPY.md           ← Copy of plan executed
├── TASK_LIST.md           ← Task checklist
├── selectors.js           ← Post-edit copy (if modified)
├── content.js             ← Post-edit copy (if modified)
└── ...                    ← Other modified files
```

---

## Appendix C: Task List Format

Maintain `TASK_LIST.md` throughout implementation:

```markdown
# TASK LIST — [Plan Name]

**Started:** [YYYY-MM-DD HH:MM]
**Artifact Folder:** .agents/reports/[PLAN_NAME]_[YYYYMMDD]/

---

## Progress

[✅] Task 1: [Description] — COMPLETE at [HH:MM]
[✅] Task 2: [Description] — COMPLETE at [HH:MM]
[ ] Task 3: [Description] — IN PROGRESS
[ ] Task 4: [Description] — PENDING
[ ] Task 5: [Description] — PENDING

---

**Progress:** 2/5 (40%)
**Last Updated:** [YYYY-MM-DD HH:MM]
```

---

## Appendix D: Common Failure Modes

| # | Failure | What Happened | Prevention |
|---|---------|---------------|------------|
| 1 | Wrong file | Edited File B when plan said File A | Re-read target files before each step |
| 2 | Hallucinated find | Claimed "not found" on text that exists | Search 3+ words, read whole method |
| 3 | Autonomy creep | "Fixed" something not in plan | If not in plan, don't touch it |
| 4 | Skipped steps | Reported complete but missed tasks | Check task list against report |
| 5 | Fabricated code | Showed correct code not actually in file | Read file back, paste actual content |
| 6 | Continued past feature | Implemented multiple features | STOP after one feature, wait for approval |
| 7 | Wrong artifact location | Saved to brain/context folder | ALWAYS save to `.agents\reports\` |

---

## Appendix E: Emergency Reset

If you become confused:

1. **STOP** — Do not save any files
2. Re-read this workflow from the beginning
3. Re-read the plan from the beginning
4. Output: `RESET: Re-reading plan. Current task: [N]. Confirming target file: [filename].`
5. Continue from the current task

---

*Workflow version: 1.1.0*
*Last updated: Added artifact storage requirements, task list file*
