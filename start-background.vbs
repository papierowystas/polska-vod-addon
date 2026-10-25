Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\mondo\.gemini\antigravity\brain\0e2ed14f-762d-434e-ad30-706ab2178092\scratch\polska-vod-addon"
WshShell.Run "cmd /c node server.js > server.log 2>&1", 0, False
