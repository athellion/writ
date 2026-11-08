; Writ's own additions to its installer (electron-builder's NSIS installer, run inside Vestibulum).
;
; Writ is offered in "Open with" for Word documents (.docx), without taking them over: Word (or
; whatever opens .docx today) stays the app a double-click opens. Only Bjørnar chooses that, in
; Windows' own "Open with → Choose another app" or Default apps.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\Writ.Document" "" "Word document"
  WriteRegStr HKCU "Software\Classes\Writ.Document\DefaultIcon" "" "$INSTDIR\Writ.exe,0"
  WriteRegStr HKCU "Software\Classes\Writ.Document\shell\open\command" "" '"$INSTDIR\Writ.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.docx\OpenWithProgids" "Writ.Document" ""
  WriteRegStr HKCU "Software\Classes\Applications\Writ.exe" "FriendlyAppName" "Writ"
  WriteRegStr HKCU "Software\Classes\Applications\Writ.exe\SupportedTypes" ".docx" ""
  WriteRegStr HKCU "Software\Classes\Applications\Writ.exe\shell\open\command" "" '"$INSTDIR\Writ.exe" "%1"'
  ; tell Explorer, so "Open with" knows at once
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Classes\.docx\OpenWithProgids" "Writ.Document"
  DeleteRegKey HKCU "Software\Classes\Writ.Document"
  DeleteRegKey HKCU "Software\Classes\Applications\Writ.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
