' Hidden PowerShell launcher (shared). arg0 = target .ps1, remaining args passed through.
' Window style 0 = hidden, bWaitOnReturn = False. ASCII-only.
Option Explicit
Dim sh, i, sArgs
Set sh = CreateObject("WScript.Shell")
sArgs = ""
For i = 1 To WScript.Arguments.Count - 1
  sArgs = sArgs & " " & WScript.Arguments(i)
Next
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """" & sArgs, 0, False
