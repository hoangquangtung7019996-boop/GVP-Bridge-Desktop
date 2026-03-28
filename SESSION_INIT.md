# GVP Bridge — Session Initialization Prompt

Copy and paste everything below the line into a fresh Antigravity session.

---

You are starting a fresh session for the **GVP Bridge** project.

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

## What This Project Is

GVP Bridge is a **hybrid architecture** that connects a desktop application to a minimal Chrome extension via WebSocket. The extension acts as a "dumb bridge" that only handles browser-specific DOM operations on Grok's website (x.com/i/grok).

**Core Flow:**
1. User types prompt in desktop app (Tauri + SolidJS)
2. User clicks gallery card on Grok → URL changes to `/imagine/post/{imageId}`
3. Extension detects URL change
4. Extension requests prompt from desktop app via WebSocket
5. Extension injects prompt into TipTap editor
6. Extension fakes Enter key or clicks send button

---

## Project Location

```
A:\Tools n Programs\GVP-Desktop\
```

---

## File Structure

```
A:\Tools n Programs\GVP-Desktop\
├── .agents\
│   ├── rules.md                      ← Project rules and constraints
│   ├── ARCHITECTURE.md               ← Architecture map from original GVP
│   ├── metadata.json                 ← Knowledge Item index
│   ├── HANDOVER.md                   ← Previous session summary
│   ├── CHANGELOG.md                  ← Running change history
│   ├── knowledge_items\              ← Reference KIs from original GVP
│   │   ├── gvp-tiptap-prosemirror-injection\
│   │   └── ... (other KIs)
│   ├── workflows\
│   │   ├── start.md                  ← Bootstrap workflow
│   │   ├── implement.md              ← Plan execution workflow
│   │   ├── report.md                 ← Report generation workflow
│   │   ├── correction.md             ← Correction handling workflow
│   │   └── close-and-prepare.md      ← Session close workflow
│   ├── plans\                        ← Implementation plans
│   └── reports\                      ← Report packages & artifacts
│
├── src-desktop\                      ← Tauri + SolidJS desktop app
├── src-extension\                    ← Minimal Chrome extension
├── src-tauri\                        ← Rust backend
│
├── package.json
├── PROJECT_CONTEXT.md                ← Current project state
├── README.md
├── REFERENCE_ReactAutomation.md      ← How prompt injection works
└── REFERENCE_Selectors.md            ← Grok DOM selectors
```

---

## Your Task

**Step 1:** Read and execute the start workflow located at:
```
A:\Tools n Programs\GVP-Desktop\.agents\workflows\start.md
```

**Step 2:** The start workflow's FIRST action is to:
- **Save a copy of any provided plan** to `.agents\plans\` with version suffix
- Filename format: `[PLAN_NAME]_v[VERSION]_[YYYYMMDD]_[HHMM].md`

**Step 3:** The start workflow will then instruct you to:
- Load `.agents\rules.md`
- Load `.agents\ARCHITECTURE.md`
- Load relevant Knowledge Items from `.agents\knowledge_items\`
- Load `REFERENCE_ReactAutomation.md` and `REFERENCE_Selectors.md`
- Load `PROJECT_CONTEXT.md`
- Check for `.agents\HANDOVER.md`
- Check for `.agents\CHANGELOG.md`

**Step 4:** For this session, load these KIs:
- `gvp-tiptap-prosemirror-injection` — How to inject prompts into Grok's editor

**Step 5:** After completing the start workflow, output the session ready banner as specified in the workflow.

**Step 6:** STOP. Do not start implementing anything. Report that you are ready and waiting for the first implementation plan.

---

Begin by reading the start workflow file at:
```
A:\Tools n Programs\GVP-Desktop\.agents\workflows\start.md
```
