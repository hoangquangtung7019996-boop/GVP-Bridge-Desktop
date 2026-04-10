---
description: Reviews Flash's implementation report and applies fixes based on severity.
---
# /architect-review

## Objective
Review the implementation report provided by the Flash Agent, verify it matches your original plan, and handle any discrepancies based on severity.

## Execution Steps
1. Compare the code snippets in the user-provided `REPORT.md` against your original `PLAN_[ID]`.
2. Check for: Extra code (scope creep), missed steps, hallucinated syntax, or broken logic.
3. Evaluate the errors:

    **PATH A: Perfect Execution**
    * Condition: Zero errors.
    * Action: Output `STATUS: APPROVED. Ready for /flash-close.`

    **PATH B: The Fast-Track Fix (MCP Edit Allowed)**
    * Condition: <= 3 minor bugs (e.g., syntax, typos) OR exactly 1 major logical bug that is easily isolated.
    * Action: 
      1. Use your MCP file editing tools to fix the code directly in the file system.
      2. Output `STATUS: DIRECT_FIX_APPLIED.` 
      3. Provide a brief summary of what you fixed so the user can pass it to Flash for the final Changelog update.

    **PATH C: The Correction Plan (Too Complex)**
    * Condition: > 3 minor bugs, > 1 major bug, or widespread architectural misunderstanding.
    * Action: DO NOT edit the files directly. Output a Correction Plan (`PLAN_[ID]a_CORRECTION`) using the Find/Replace template from `/architect-plan` targeting the mistakes.