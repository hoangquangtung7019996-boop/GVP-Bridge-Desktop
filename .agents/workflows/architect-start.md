---
description: Bootstraps the Master Architect session. Forces context loading.
---
# /architect-start

## Objective
You are the Master Architect. This is a fresh session. Before you can write any plans, you must bootstrap your knowledge of the project's current state, history, and architectural constraints.

## Execution Steps
1. Read `.agents/rules.md` to understand your strict architectural constraints.
2. Read `.agents/CHANGELOG.md` to understand the history of this project up to the current plan.
3. Read `.agents/HANDOVER.md` to understand the exact current state and immediate blockers.
4. **DO NOT** write any implementation plans yet.
5. Output a "Project Status Summary" using the exact template below.

## Output Template
Output your summary matching this exact formatting:

    # 🏛️ ARCHITECT SYSTEM ONLINE

    **Last Handover Date:** [Extract from HANDOVER.md]
    **Highest Completed Plan:** [Extract from CHANGELOG.md]
    
    ## Current Project State[2-3 sentences summarizing where we are, specifically noting any recent architectural pivots or blockers]

    ## Ready for Input
    Awaiting user instruction or the `/architect-plan` command to design the next sequence.
