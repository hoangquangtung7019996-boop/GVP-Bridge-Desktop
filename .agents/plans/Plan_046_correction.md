**

**[COPY START]**
`/flash-implement`

**Context:** Action 1 of PLAN_046 was successful, but Action 2 failed because the `Find` block hallucinated an `<a>` tag that had been moved to the header in a previous update. We are just activating the two prompt buttons in the bottom drawer.

**Action 2 (Corrected):** MODIFY_EXISTING
**File:** `src-desktop/components/GalleryPanel.tsx`
**Find Exact Block:**
```tsx
                                <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "font-size": "0.85rem" }}>
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        <button style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "not-allowed", opacity: 0.5, "font-weight": 500 }} title="Coming soon">Copy Prompt</button>
                                        <button style={{ background: "#3f3f46", color: "white", border: "1px solid #52525b", padding: "6px 14px", "border-radius": "6px", cursor: "not-allowed", opacity: 0.5, "font-weight": 500 }} title="Coming soon">Send to Text Area</button>
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
                                    </div>
```
**[COPY END]**

***