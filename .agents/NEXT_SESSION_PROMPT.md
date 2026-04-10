# Next Architect Session — Starting Prompt

Paste this into the next Architect session to bootstrap context:

---

```
/architect-start

You are resuming the GVP Bridge project. Read these files in order:

1. `.agents/rules.md` — Project architecture rules
2. `.agents/HANDOVER.md` — Full session handover (CRITICAL: read top to bottom)
3. `.agents/CHANGELOG.md` — Version 0.6.0 entry at the top
4. `src-extension/content.bundle.js` — Content script (lines 440-525 for DOM automation functions)
5. `src-extension/background.js` — Background script (Ghost Window lifecycle goes here)
6. `src-extension/manifest.json` — Current permissions

CONTEXT SUMMARY:
- API replay / Fetch Harvester is DEAD. Killed by Cloudflare WAF TLS fingerprinting. Do NOT revisit.
- The approved architecture is "Stripped Ghost Window" — a Chrome PWA of grok.com/imagine/saved, minimized, with all media blocked at the network layer.
- Push infrastructure (trigger_fire, broadcast channel, trigger_remote_fetch) from PLAN_039 is REUSABLE.
- DOM automation code (waitForEditor, injectPrompt, clickSubmit, returnToGallery) is PROVEN and REUSABLE.

YOUR FIRST TASK:
Generate PLAN_040: Stripped Ghost Window Implementation.
- Strip content.bundle.js to WS client + DOM automation only (~200 lines)
- Delete or gut gvpFetchInterceptor.js
- Add chrome.declarativeNetRequest media blocking in background.js
- Add ghost window lifecycle management in background.js
- Add CSS cloaking injection
- Modify trigger_remote_fetch handler to call injectAndSubmitAsync() directly
- Add "windows" + "declarativeNetRequest" permissions to manifest.json
- Strip harvester state from main.rs and PromptInput.tsx
```
