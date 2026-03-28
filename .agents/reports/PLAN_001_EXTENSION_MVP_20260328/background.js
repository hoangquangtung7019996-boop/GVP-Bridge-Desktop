// GVP Quick Raw - Background Service Worker
//
// Minimal service worker for Manifest V3 compliance.
// Most logic lives in content.js.
//
// Future use:
// - Handle extension icon click
// - Manage extension state across tabs
// - Handle keyboard shortcuts

chrome.runtime.onInstalled.addListener(() => {
    console.log('[GVP Quick Raw] Extension installed');
});

// Optional: Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // TODO: Handle any background-level operations
    // For now, everything happens in content script
    return false;
});
