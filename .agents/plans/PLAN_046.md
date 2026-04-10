
**[COPY START]**
`/flash-implement`

# PLAN_046: GALLERY INTERACTIVITY (PROMPT ROUTING)

**Context:** The UVH Gallery is successfully loading authenticated media. We now need to activate the "Copy Prompt" and "Send to Text Area" buttons in the Center Stage drawer so the user can route prompts from their history back into the generator.

**Task:** Add state and click handlers to `src-desktop/components/GalleryPanel.tsx` to enable clipboard copying and Tauri backend prompt syncing.

**Action 1:** MODIFY_EXISTING
**File:** `src-desktop/components/GalleryPanel.tsx`
**Find Exact Block:**
```tsx
    const [selectedNode, setSelectedNode] = createSignal<UVHNode | null>(null);
    const[activeMedia, setActiveMedia] = createSignal<ActiveMedia | null>(null);

    async function loadGallery() {
```
**Replace With:**
```tsx
    const [selectedNode, setSelectedNode] = createSignal<UVHNode | null>(null);
    const [activeMedia, setActiveMedia] = createSignal<ActiveMedia | null>(null);
    
    // Button visual feedback states
    const [copyBtnText, setCopyBtnText] = createSignal('Copy Prompt');
    const [sendBtnText, setSendBtnText] = createSignal('Send to Text Area');

    async function handleCopyPrompt() {
        const prompt = activeMedia()?.prompt;
        if (!prompt) return;
        try {
            await navigator.clipboard.writeText(prompt);
            setCopyBtnText('✓ Copied!');
            setTimeout(() => setCopyBtnText('Copy Prompt'), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }

    async function handleSendToTextArea() {
        const prompt = activeMedia()?.prompt;
        if (!prompt) return;
        try {
            await invoke('set_prompt', { prompt });
            setSendBtnText('✓ Sent!');
            setTimeout(() => setSendBtnText('Send to Text Area'), 2000);
        } catch (err) {
            console.error('Failed to send prompt:', err);
        }
    }

    async function loadGallery() {
```

**Action 2:** MODIFY_EXISTING
**File:** `src-desktop/components/GalleryPanel.tsx`
**Find Exact Block:**
```tsx
                                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "font-size": "0.85rem" }}>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <button style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "not-allowed", opacity: 0.5, "font-weight": 500 }} title="Coming soon">Copy Prompt</button>
                                        <button style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "not-allowed", opacity: 0.5, "font-weight": 500 }} title="Coming soon">Send to Text Area</button>
                                        <a href={activeMedia()?.url} target="_blank" rel="noopener noreferrer" style={{ background: "#0ea5e9", color: "white", "text-decoration": "none", padding: "6px 12px", "border-radius": "4px" }}>Open Original</a>
                                    </div>
```
**Replace With:**
```tsx
                                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "font-size": "0.85rem" }}>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <button 
                                            onClick={handleCopyPrompt}
                                            style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "pointer", "font-weight": 500, transition: "0.2s" }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = "#52525b"}
                                            onMouseLeave={(e) => e.currentTarget.style.background = "#3f3f46"}
                                        >
                                            {copyBtnText()}
                                        </button>
                                        <button 
                                            onClick={handleSendToTextArea}
                                            style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "pointer", "font-weight": 500, transition: "0.2s" }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = "#52525b"}
                                            onMouseLeave={(e) => e.currentTarget.style.background = "#3f3f46"}
                                        >
                                            {sendBtnText()}
                                        </button>
                                        <a href={activeMedia()?.url} target="_blank" rel="noopener noreferrer" style={{ background: "#0ea5e9", color: "white", "text-decoration": "none", padding: "6px 12px", "border-radius": "4px" }}>Open Original</a>
                                    </div>
```
**[COPY END]**

***