# Implementation Plan — Icon Assets for Tauri Desktop App

**Plan ID:** PLAN-004
**Feature:** Icon Assets Generation
**Target:** `src-tauri/icons/`
**Date:** 2025-03-28
**Depends On:** PLAN-001, PLAN-002, PLAN-003

---

## Overview

Generate all required icon assets for the Tauri desktop application:

1. **GVP Logo SVG** - Source vector graphic
2. **icon.ico** - Windows application icon (multi-size)
3. **icon.png** - Linux/default icon (1024x1024)
4. **32x32.png** - Small icon
5. **128x128.png** - Medium icon
6. **icon.icns** - macOS icon (optional, for future)

**Total Steps:** 6
**Estimated Files:** 5+ new files

---

## Icon Requirements

| File | Size | Format | Purpose |
|------|------|--------|---------|
| `icon.ico` | Multi: 16, 32, 48, 64, 128, 256 | ICO | Windows app icon |
| `icon.png` | 1024x1024 | PNG | Linux / Default |
| `32x32.png` | 32x32 | PNG | Taskbar / Small |
| `128x128.png` | 128x128 | PNG | Medium size |
| `256x256.png` | 256x256 | PNG | Large size |
| `icon.svg` | Vector | SVG | Source file |

---

## Design Concept

GVP Bridge logo should reflect:
- **Bridge/Connection theme** - Linking extension to desktop
- **Dark mode friendly** - Works on dark backgrounds
- **Simple, recognizable** - Clean at small sizes
- **Colors:** Red accent (#ef4444) matching Grok theme

---

## STEP 1 — Create Icons Directory

**Folder:** `src-tauri/icons/`
**Action:** CREATE DIRECTORY

Create the directory:
```
src-tauri/
└── icons/
```

---

## STEP 2 — Create SVG Source Icon

**File:** `src-tauri/icons/icon.svg`
**Action:** CREATE NEW FILE

**Code to write:**
```svg
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background circle -->
  <circle cx="512" cy="512" r="480" fill="#1a1a1a"/>
  
  <!-- Outer ring -->
  <circle cx="512" cy="512" r="440" stroke="#ef4444" stroke-width="16" fill="none"/>
  
  <!-- Bridge/Connection design -->
  <!-- Left node (Extension) -->
  <circle cx="320" cy="512" r="80" fill="#ef4444"/>
  <circle cx="320" cy="512" r="50" fill="#1a1a1a"/>
  
  <!-- Right node (Desktop) -->
  <circle cx="704" cy="512" r="80" fill="#ef4444"/>
  <circle cx="704" cy="512" r="50" fill="#1a1a1a"/>
  
  <!-- Connection bridge -->
  <rect x="360" y="490" width="304" height="44" rx="8" fill="#ef4444"/>
  
  <!-- Data flow indicators -->
  <circle cx="400" cy="512" r="12" fill="#fff"/>
  <circle cx="480" cy="512" r="12" fill="#fff"/>
  <circle cx="560" cy="512" r="12" fill="#fff"/>
  <circle cx="640" cy="512" r="12" fill="#fff"/>
  
  <!-- GVP text -->
  <text x="512" y="720" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" font-weight="bold" fill="#f4f4f5">GVP</text>
  
  <!-- Bridge subtitle -->
  <text x="512" y="820" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="#a3a3a3">BRIDGE</text>
</svg>
```

⚠️ DO NOT create this file in any other location.

---

## STEP 3 — Create PNG Icons (Multiple Sizes)

**Files:** `src-tauri/icons/icon.png`, `src-tauri/icons/32x32.png`, `src-tauri/icons/128x128.png`, `src-tauri/icons/256x256.png`
**Action:** CREATE NEW FILES

**Note:** PNG files are binary. Use one of these methods:

### Method A: Use ImageMagick (if installed)
```bash
# In src-tauri/icons folder
magick icon.svg -resize 1024x1024 icon.png
magick icon.svg -resize 32x32 32x32.png
magick icon.svg -resize 128x128 128x128.png
magick icon.svg -resize 256x256 256x256.png
```

### Method B: Use Online Converter
1. Open https://svgtopng.com/
2. Upload `icon.svg`
3. Download at sizes: 1024, 256, 128, 32
4. Rename appropriately

### Method C: Use Tauri Icon Command
```bash
npx tauri icon icon.svg
```

This auto-generates all required formats.

---

## STEP 4 — Create ICO File (Windows)

**File:** `src-tauri/icons/icon.ico`
**Action:** CREATE NEW FILE

**Note:** ICO files contain multiple sizes. Use one of these methods:

### Method A: Use ImageMagick
```bash
magick icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Method B: Use Online Converter
1. Open https://convertio.co/png-ico/
2. Upload `icon.png` (1024x1024)
3. Select "Multi-size ICO"
4. Download as `icon.ico`

### Method C: Use Tauri Icon Command
```bash
npx tauri icon icon.svg
```

---

## STEP 5 — Create ICNS File (macOS - Optional)

**File:** `src-tauri/icons/icon.icns`
**Action:** CREATE NEW FILE (Optional)

Only needed for macOS builds. Use:

```bash
npx tauri icon icon.svg
```

---

## STEP 6 — Verify Icons Exist

After generation, verify the following files exist:

```
src-tauri/icons/
├── icon.svg        (source)
├── icon.ico        (Windows)
├── icon.png        (1024x1024)
├── 32x32.png       (small)
├── 128x128.png     (medium)
├── 256x256.png     (large)
└── icon.icns       (macOS, optional)
```

---

## Alternative: Simplified Placeholder Icons

If image generation tools are unavailable, use these base64-encoded placeholder icons:

### STEP 2-4 Alternative — Create Placeholder icon.ico

**File:** `src-tauri/icons/icon.ico`
**Action:** CREATE NEW FILE

Download from Tauri's example repo:
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/icon.ico" -OutFile "src-tauri/icons/icon.ico"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/icon.png" -OutFile "src-tauri/icons/icon.png"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/32x32.png" -OutFile "src-tauri/icons/32x32.png"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/128x128.png" -OutFile "src-tauri/icons/128x128.png"
```

---

## Quick Command Summary

```powershell
# Navigate to project
cd "A:\Tools n Programs\GVP-Desktop"

# Create icons folder
mkdir src-tauri\icons

# Option 1: Download placeholder icons
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/icon.ico" -OutFile "src-tauri\icons\icon.ico"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/icon.png" -OutFile "src-tauri\icons\icon.png"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/32x32.png" -OutFile "src-tauri\icons\32x32.png"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tauri-apps/tauri/dev/examples/api/src-tauri/icons/128x128.png" -OutFile "src-tauri\icons\128x128.png"

# Option 2: Generate from SVG (if you create icon.svg first)
npx tauri icon src-tauri\icons\icon.svg

# Then run
npm run tauri dev
```

---

## VERIFICATION CHECKLIST

After completing all steps, verify:

| Check | Expected |
|-------|----------|
| `src-tauri/icons/` folder exists | YES |
| `src-tauri/icons/icon.ico` exists | YES |
| `src-tauri/icons/icon.png` exists | YES |
| `src-tauri/icons/32x32.png` exists | YES |
| `src-tauri/icons/128x128.png` exists | YES |
| `npm run tauri dev` runs without icon errors | YES |

---

## TESTING

After icons are created:

```powershell
cd "A:\Tools n Programs\GVP-Desktop"
npm run tauri dev
```

Expected result:
- Application window opens
- Taskbar shows the GVP Bridge icon
- No icon-related errors in build

---

## END OF PLAN

**STOP after completing all 6 steps.**
**Produce Work Report as specified in `/implement` workflow.**
