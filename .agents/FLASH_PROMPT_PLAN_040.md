# COPY EVERYTHING BELOW THIS LINE INTO GEMINI FLASH

/flash-start

Then immediately follow with:

/flash-implement

## PLAN_040: Stripped Ghost Window Implementation

### Execution Instructions
- Steps 1, 2, 3 are REPLACE_ENTIRE_FILE operations. Delete all existing content and write the new content exactly.
- Steps 4–7 are MODIFY_EXISTING (find/replace). Match the **Find Exact Block** character-for-character and replace with the **Replace With** block.
- If any Find Exact Block does not match: output `[UNCERTAIN]: Find block not matched in [File]. STOPPING.`
- Do NOT add, remove, or modify any code outside the specified blocks.
- When complete, run `/flash-report`.

### Files to modify (in order):
1. `src-extension/content.bundle.js` — REPLACE_ENTIRE_FILE
2. `src-extension/injected/gvpFetchInterceptor.js` — REPLACE_ENTIRE_FILE
3. `src-extension/background.js` — REPLACE_ENTIRE_FILE
4. `src-extension/manifest.json` — MODIFY_EXISTING (1 find/replace)
5. `src-tauri/src/main.rs` — MODIFY_EXISTING (7 find/replace blocks: 5a–5g)
6. `src-desktop/components/PromptInput.tsx` — MODIFY_EXISTING (4 find/replace blocks: 6a–6d)
7. `src-desktop/App.tsx` — MODIFY_EXISTING (1 find/replace)

### ⚠️ TRAPS — DO NOT VIOLATE
1. **CSS Cloak**: Do NOT use `pointer-events: none`. Use `opacity: 0.01` only.
2. **Virtualized List**: Do NOT search DOM for specific imageId. Click FIRST card: `document.querySelector('a[href*="/imagine/post/"]')`.
3. **No Window Creation**: Extension does NOT call `chrome.windows.create()`. Desktop App spawns the ghost window.

---

The full plan with all code blocks is in:
`.agents/plans/PLAN_040_STRIPPED_GHOST_WINDOW.md`

**Tell Flash to read that file first**, then execute each step in order.
