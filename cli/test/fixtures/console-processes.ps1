param([Parameter(Mandatory = $true)][uint32]$ProcessId, [switch]$Hold)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleProbe {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll")]
    public static extern bool FreeConsole();
    [DllImport("kernel32.dll")]
    public static extern uint GetConsoleProcessList([Out] uint[] ids, uint count);
}
'@

[void][ConsoleProbe]::FreeConsole()
$attached = [ConsoleProbe]::AttachConsole($ProcessId)
if (-not $attached) {
    throw "AttachConsole failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
    $members = New-Object System.UInt32[] 64
    $count = [ConsoleProbe]::GetConsoleProcessList($members, 64)
    if ($count -eq 0 -or $count -gt $members.Length) { throw 'Could not read console members' }
    ConvertTo-Json -InputObject @($members | Select-Object -First $count) -Compress
    if ($Hold) { Start-Sleep -Seconds 30 }
} finally {
    [void][ConsoleProbe]::FreeConsole()
}
