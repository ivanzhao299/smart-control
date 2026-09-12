# Check browser processes with command line
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
  Select-Object ProcessId, Name, CommandLine |
  Format-List
