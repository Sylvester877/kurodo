; ──────────────────────────────────────────────────────────────────
;  Kurōdo  —  Minimal Space-Theme Installer
;
;  electron-builder auto-generates the full NSIS script (MUI2 pages,
;  bitmaps, auto-launch checkbox, uninstaller, language). This .nsh
;  file only adds custom augmentations:
;
;    1. Dark space background (MUI_BGCOLOR)
;    2. Custom branding text
;    3. .fresh-install marker → triggers first-run SetupWizard
;
;  All AniList/list/theme config is handled by the gorgeous Electron
;  SetupWizard on first launch — not in the installer.
; ──────────────────────────────────────────────────────────────────

  ; ── Cosmetic overrides (set BEFORE electron-builder's page inserts) ─
  !define MUI_BGCOLOR 0x0A0A0A

  ; ── Branding ──────────────────────────────────────────────────────
  BrandingText "Kurōdo  ·  discover & stream anime"

  ; ── Fresh install marker — the Electron app checks for this file
  ;     on startup and shows the SetupWizard if it's a new install. ──
  Function .onInstSuccess
    FileOpen $0 "$INSTDIR\.fresh-install" w
    FileClose $0
  FunctionEnd
