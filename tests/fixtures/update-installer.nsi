Unicode true
Name "LX-M update argument probe"
OutFile "${OUTPUT_FILE}"
RequestExecutionLevel user
SilentInstall normal
AutoCloseWindow true
!include LogicLib.nsh
!include FileFunc.nsh

; This fixture only records arguments in its temporary test directory.
; It never installs the application or changes registry entries/shortcuts.
Function .onInit
  ${IfNot} ${Silent}
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
    SetErrorLevel 3
    Abort
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "--force-run" $R1
  ${If} ${Errors}
    SetErrorLevel 4
    Abort
  ${EndIf}
FunctionEnd

Section
  FileOpen $0 "${PROBE_RESULT}" w
  FileWriteUTF16LE $0 "$INSTDIR$\r$\n"
  FileWriteUTF16LE $0 "$CMDLINE$\r$\n"
  FileWriteUTF16LE $0 "silent=1;updated=1;force-run=1$\r$\n"
  FileClose $0
SectionEnd
