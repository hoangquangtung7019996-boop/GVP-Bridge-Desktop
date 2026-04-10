---
description: Generates a strict before/after report for the Architect to review.
---
# /flash-report

## Objective
Generate a structured report of your modifications so the Architect AI can review your work.

## Execution Steps
1. Identify all files you just modified in the previous step.
2. Output a report using the exact template below.

## Output Template
Output your report matching this exact formatting:

    # REPORT FOR PLAN_[ID]
    **Status:** SUCCESS / UNCERTAIN

    ## STEP 1
    **File:** `path/to/file`
    
    **Code Now In File:**
    ```javascript
    // Paste the exact code you just wrote to the file here for the Architect to review.
    ```