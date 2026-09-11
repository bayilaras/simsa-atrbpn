$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-runtime.ps1')

$script:passed = 0
function Check($name, [scriptblock]$assertion) {
    & $assertion
    $script:passed++
    Write-Output ('PASS ' + $name)
}
function Must-Throw([scriptblock]$operation) {
    $threw = $false
    try { & $operation } catch { $threw = $true }
    if (-not $threw) { throw 'Expected a rejection' }
}
function Must-Be($actual, $expected) {
    if ($actual -cne $expected) { throw 'Unexpected result' }
}

$config = [pscustomobject]@{
    nodePath = 'D:\SIMSA local\node.exe'
    envFile = 'D:\SIMSA local\backend.env'
    entryPath = 'D:\SIMSA local\backend\dist\internal-runtime.js'
    dataDirectory = 'D:\SIMSA local\postgres-data'
    postgresBin = 'C:\Program Files\PostgreSQL\18\bin'
    postgresPort = 55432
    postgresMajor = 18
    systemIdentifier = '7684074739617773232'
}
$created = [datetime]'2026-09-11T01:00:00Z'
$process = [pscustomobject]@{
    ProcessId = 1234
    CreationDate = $created
    ExecutablePath = $config.nodePath
    CommandLine = '"D:\SIMSA local\node.exe" "--env-file=D:\SIMSA local\backend.env" "D:\SIMSA local\backend\dist\internal-runtime.js"'
}
$state = [pscustomobject]@{ processId = 1234; createdUtc = $created.ToUniversalTime().ToString('o') }

Check 'accepts only the recorded app with exact executable and argv' {
    Must-Be (Test-OwnedApplication $config $state $process) $true
}
Check 'rejects a reused PID' {
    $changed = $process.PSObject.Copy(); $changed.CreationDate = $created.AddSeconds(1)
    Must-Be (Test-OwnedApplication $config $state $changed) $false
}
Check 'rejects an unrelated executable at the recorded PID' {
    $changed = $process.PSObject.Copy(); $changed.ExecutablePath = 'C:\Other\node.exe'
    Must-Be (Test-OwnedApplication $config $state $changed) $false
}
Check 'rejects an unrecorded process' {
    Must-Be (Test-OwnedApplication $config $null $process) $false
}
Check 'rejects a different entry even when it contains the expected filename' {
    $changed = $process.PSObject.Copy(); $changed.CommandLine = $process.CommandLine.Replace('internal-runtime.js', 'internal-runtime.js.other')
    Must-Be (Test-OwnedApplication $config $state $changed) $false
}
Check 'rejects appended Node arguments' {
    $changed = $process.PSObject.Copy(); $changed.CommandLine += ' --inspect'
    Must-Be (Test-OwnedApplication $config $state $changed) $false
}
Check 'rejects a different environment file' {
    $changed = $process.PSObject.Copy(); $changed.CommandLine = $process.CommandLine.Replace('backend.env', 'foreign.env')
    Must-Be (Test-OwnedApplication $config $state $changed) $false
}
Check 'quotes paths containing spaces as one argument' {
    $arguments = @(Split-NativeCommandLine ('node.exe ' + (Quote-NativeArgument '--env-file=D:\SIMSA local\backend.env')))
    Must-Be $arguments.Count 2
    Must-Be $arguments[1] '--env-file=D:\SIMSA local\backend.env'
}
Check 'rejects control characters in native arguments' {
    Must-Throw { Quote-NativeArgument "path`nother" }
}

$proof = [pscustomobject]@{
    dataDirectory = $config.dataDirectory
    systemIdentifier = $config.systemIdentifier
    major = 18
    port = 55432
    listenAddress = '127.0.0.1'
}
Check 'accepts the pinned PostgreSQL identity' { Assert-PostgresProof $config $proof }
foreach ($mutation in @(
    @{field='systemIdentifier'; value='7684074739617773233'},
    @{field='dataDirectory'; value='D:\Other\postgres-data'},
    @{field='major'; value=17},
    @{field='port'; value=5432},
    @{field='listenAddress'; value='*'}
)) {
    Check ('rejects a changed PostgreSQL ' + $mutation.field) {
        $changed = $proof.PSObject.Copy(); $changed.($mutation.field) = $mutation.value
        Must-Throw { Assert-PostgresProof $config $changed }
    }
}
Check 'rejects a non-loopback listener even when the PID matches' {
    Must-Throw { Assert-OwnedListeners @([pscustomobject]@{OwningProcess=1234;LocalAddress='0.0.0.0'}) 1234 }
}
Check 'rejects a foreign listener' {
    Must-Throw { Assert-OwnedListeners @([pscustomobject]@{OwningProcess=5678;LocalAddress='127.0.0.1'}) 1234 }
}
Check 'accepts only the recorded loopback listener' {
    Assert-OwnedListeners @([pscustomobject]@{OwningProcess=1234;LocalAddress='127.0.0.1'}) 1234
}
Write-Output ('All ' + $script:passed + ' launcher guard tests passed.')
