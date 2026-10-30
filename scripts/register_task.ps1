$action = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" -Argument "C:\Users\igles\.gemini\antigravity\scratch\or-nav\scripts\jules_hourly_orchestrator.mjs" -WorkingDirectory "C:\Users\igles\.gemini\antigravity\scratch\or-nav"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 365)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "ORNav_Jules_30Min_Orchestrator" -Action $action -Trigger $trigger -Settings $settings -Description "30-minute autonomous fleet orchestrator and local sync daemon for Jules" -Force
Get-ScheduledTask -TaskName "ORNav_Jules_30Min_Orchestrator" | Format-List TaskName, State, Description
