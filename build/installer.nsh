; markupr Custom NSIS Installer Script
; Version: 0.4.0
; =============================================================================

!include "MUI2.nsh"

; =============================================================================
; Custom Macros
; =============================================================================

; Registry keys for context menu
!define CONTEXT_MENU_KEY "Software\Classes\Directory\Background\shell\markupr"
!define CONTEXT_MENU_COMMAND_KEY "Software\Classes\Directory\Background\shell\markupr\command"

; =============================================================================
; Custom Install Section
; =============================================================================

!macro customInstall
  ; Add context menu integration "Capture feedback here"
  WriteRegStr HKCU "${CONTEXT_MENU_KEY}" "" "Capture feedback here"
  WriteRegStr HKCU "${CONTEXT_MENU_KEY}" "Icon" "$INSTDIR\markupr.exe,0"
  WriteRegStr HKCU "${CONTEXT_MENU_COMMAND_KEY}" "" '"$INSTDIR\markupr.exe" "--capture-path=%V"'

  ; Add to folder context menu as well
  WriteRegStr HKCU "Software\Classes\Directory\shell\markupr" "" "Capture feedback here"
  WriteRegStr HKCU "Software\Classes\Directory\shell\markupr" "Icon" "$INSTDIR\markupr.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\markupr\command" "" '"$INSTDIR\markupr.exe" "--capture-path=%1"'

  ; Refresh shell to apply context menu changes
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; =============================================================================
; Custom Uninstall Section
; =============================================================================

!macro customUnInstall
  ; Remove context menu entries
  DeleteRegKey HKCU "${CONTEXT_MENU_KEY}"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\markupr"

  ; Refresh shell
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
