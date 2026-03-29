# TASK LIST — PLAN-011: Submit and Return to Gallery

**Plan Storage:** [.agents/reports/PLAN_011_QUICK_RAW_RETURN_TO_GALLERY_20260329/PLAN_COPY.md](file:///A:/Tools%20n%20Programs/GVP-Desktop/.agents/reports/PLAN_011_QUICK_RAW_RETURN_TO_GALLERY_20260329/PLAN_COPY.md)

---

## IMPLEMENTATION STEPS

- [x] Task 1: Add simulateEscape() and returnToGallery() functions to content.bundle.js
- [x] Task 2: Modify injectAndSubmitAsync() to call returnToGallery() after submit
- [x] Task 3: Update handlePromptResponse() to report gallery return status

---

## CORRECTION TASKS (011b — Double Click & Multiprompt Fix)

[x] Correction 1: Add state variables for deduplication/locking in content.bundle.js
[x] Correction 2: Replace clickSubmit() with reactClick() (synthetic only)
[x] Correction 3: Overhaul URL monitoring (polling + popstate + debouncing)
[x] Correction 4: Implement handleUrlChange() with deduplication logic
[x] Correction 5: Add locking/try-finally to handlePromptResponse()
[x] Correction 6: Update injectAndSubmitAsync() for sync clickSubmit()

Total corrections: 6
