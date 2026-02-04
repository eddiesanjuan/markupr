; FeedbackFlow Custom NSIS Installer Script
; Version: 0.4.0
; =============================================================================

!include "MUI2.nsh"
!include "FileAssociation.nsh"

; =============================================================================
; Custom Macros
; =============================================================================

; Registry keys for context menu
!define CONTEXT_MENU_KEY "Software\Classes\Directory\Background\shell\FeedbackFlow"
!define CONTEXT_MENU_COMMAND_KEY "Software\Classes\Directory\Background\shell\FeedbackFlow\command"

; =============================================================================
; Custom Install Section
; =============================================================================

!macro customInstall
  ; Register .feedbackflow file association
  ${registerExtension} "$INSTDIR\FeedbackFlow.exe" ".feedbackflow" "FeedbackFlow Session"

  ; Add context menu integration "Capture feedback here"
  WriteRegStr HKCU "${CONTEXT_MENU_KEY}" "" "Capture feedback here"
  WriteRegStr HKCU "${CONTEXT_MENU_KEY}" "Icon" "$INSTDIR\FeedbackFlow.exe,0"
  WriteRegStr HKCU "${CONTEXT_MENU_COMMAND_KEY}" "" '"$INSTDIR\FeedbackFlow.exe" "--capture-path=%V"'

  ; Add to folder context menu as well
  WriteRegStr HKCU "Software\Classes\Directory\shell\FeedbackFlow" "" "Capture feedback here"
  WriteRegStr HKCU "Software\Classes\Directory\shell\FeedbackFlow" "Icon" "$INSTDIR\FeedbackFlow.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\FeedbackFlow\command" "" '"$INSTDIR\FeedbackFlow.exe" "--capture-path=%1"'

  ; Refresh shell to apply context menu changes
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; =============================================================================
; Custom Uninstall Section
; =============================================================================

!macro customUnInstall
  ; Unregister .feedbackflow file association
  ${unregisterExtension} ".feedbackflow" "FeedbackFlow Session"

  ; Remove context menu entries
  DeleteRegKey HKCU "${CONTEXT_MENU_KEY}"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\FeedbackFlow"

  ; Refresh shell
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

; =============================================================================
; File Association Helper (inline since external may not be available)
; =============================================================================

!ifndef FileAssociation_INCLUDED
!define FileAssociation_INCLUDED

!macro registerExtension executable extension description
  Push "${executable}"
  Push "${extension}"
  Push "${description}"
  Call registerExtension
!macroend

!macro unregisterExtension extension description
  Push "${extension}"
  Push "${description}"
  Call un.unregisterExtension
!macroend

Function registerExtension
  Exch $R2 ; description
  Exch
  Exch $R1 ; extension
  Exch 2
  Exch $R0 ; executable

  WriteRegStr HKCU "Software\Classes\$R1" "" "FeedbackFlow.Session"
  WriteRegStr HKCU "Software\Classes\FeedbackFlow.Session" "" "$R2"
  WriteRegStr HKCU "Software\Classes\FeedbackFlow.Session\DefaultIcon" "" "$R0,0"
  WriteRegStr HKCU "Software\Classes\FeedbackFlow.Session\shell\open\command" "" '"$R0" "%1"'

  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Function un.unregisterExtension
  Exch $R1 ; description
  Exch
  Exch $R0 ; extension

  DeleteRegKey HKCU "Software\Classes\$R0"
  DeleteRegKey HKCU "Software\Classes\FeedbackFlow.Session"

  Pop $R1
  Pop $R0
FunctionEnd

!endif
