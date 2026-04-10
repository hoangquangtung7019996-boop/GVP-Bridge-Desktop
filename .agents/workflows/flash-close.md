---
description: MANDATORY end-of-session workflow. Aggregates all work done in the current long chat, updates memory, and prepares for a fresh context window.
---
# /flash-close

## Objective
The current conversation has grown too long and the user is preparing to wipe the context and start a fresh session. Your job is to aggregate everything accomplished during this session and persist it to the project's memory files.

## Execution Steps
1. **Analyze the Session Context:** Review the entire chat history. Identify:
   - All `PLAN_[ID]`s successfully implemented.
   - Any manual corrections or "Fast-Track" fixes applied directly by the Architect.
   - The current architectural state and any unresolved blockers.
2. **Update CHANGELOG.md:** Add a single grouped entry for today's date documenting all completed features, plans, and minor Architect fixes from this session.
3. **Update HANDOVER.md:** Completely rewrite the handover document. Detail the "Current Project State", "Completed Tasks" from this session, and the immediate "Priority Order for Next Session".
4. **Final Verification:** Ensure NO data is left hanging in the chat that isn't written to the Handover or Changelog.
5. Output the following completion banner:

    # 🛑 SESSION CLOSED & PREPARED
    
    **Plans Completed This Session:**[List them, e.g., PLAN_038, PLAN_039]
    **Changelog:** ✅ Updated
    **Handover:** ✅ Updated

    **Safe to close this chat.** In the fresh session, run `/flash-start` here and `/architect-start` in the Master UI.