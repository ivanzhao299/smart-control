' Hidden launcher for the video-ai-analyzer service (D:\video-ai-analyzer).
' Window style 0 = hidden, bWaitOnReturn = False. ASCII-only.
' Used by the VideoAI-Run scheduled task to avoid a visible cmd / Windows Terminal
' window popping up on the LED dashboard whenever the AI watchdog restarts the service.
Option Explicit
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c ""D:\video-ai-analyzer\run_ai_service.bat""", 0, False
