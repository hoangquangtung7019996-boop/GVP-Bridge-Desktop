---
description: Applies a correction plan provided by the Architect.
---
# /flash-correction

## Objective
You are the Implementer (Gemini Flash). The Master Architect has rejected your previous report and provided a Correction Plan (`PLAN_[ID]a_CORRECTION`). You must apply this exact fix.

## Execution Steps
1. Read the provided `PLAN_[ID]a_CORRECTION` from the user.
2. Locate the exact **Find Block** specified in the correction plan.
3. Replace it with the exact **Replace With** block.
4. DO NOT attempt to "clean up" or fix anything else. Do exactly what the correction plan says.
5. Save the file.
6. Automatically trigger the `/flash-report` command so the Architect can re-review the fix.