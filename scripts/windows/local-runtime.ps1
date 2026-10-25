[CmdletBinding()]
param(
    [ValidateSet('start', 'status', 'stop')][string]$Action = 'status',
    [switch]$StopDatabase,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Quote-NativeArgument([string]$value) {
    if ($value -match '[\x00-\x1f"]' -or $value.EndsWith('\')) { throw 'Argumen proses tidak aman.' }
    return '"' + $value + '"'
}

function Split-NativeCommandLine([string]$commandLine) {
    if (-not ('Simsa.LocalNativeArguments' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Simsa {
    public static class LocalNativeArguments {
        [DllImport("shell32.dll", SetLastError=true)]
        private static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
        public static string[] Split(string command) {
            int count; IntPtr block = CommandLineToArgvW(command, out count);
            if (block == IntPtr.Zero) throw new InvalidOperationException("Cannot inspect process arguments");
            try {
                string[] values = new string[count];
                for (int i=0; i<count; i++) values[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(block, i * IntPtr.Size));
                return values;
            } finally { LocalFree(block); }
        }
    }
}
'@
    }
    return [Simsa.LocalNativeArguments]::Split($commandLine)
}

function Same-Path([string]$left, [string]$right) {
    if (-not $left -or -not $right) { return $false }
    return [string]::Equals([IO.Path]::GetFullPath($left).TrimEnd('\'), [IO.Path]::GetFullPath($right).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

function Test-OwnedApplication($config, $state, $process) {
    if ($null -eq $state -or $null -eq $process) { return $false }
    try {
        if ([int]$state.processId -ne [int]$process.ProcessId -or
            $state.createdUtc -cne $process.CreationDate.ToUniversalTime().ToString('o') -or
            -not (Same-Path $process.ExecutablePath $config.nodePath)) { return $false }
        $arguments = @(Split-NativeCommandLine $process.CommandLine)
        return $arguments.Count -eq 3 -and (Same-Path $arguments[0] $config.nodePath) -and
            [string]::Equals($arguments[1], '--env-file=' + $config.envFile, [StringComparison]::OrdinalIgnoreCase) -and
            (Same-Path $arguments[2] $config.entryPath)
    } catch { return $false }
}

function Assert-OwnedListeners($listeners, [int]$processId) {
    foreach ($listener in $listeners) {
        if ([int]$listener.OwningProcess -ne $processId -or $listener.LocalAddress -ne '127.0.0.1') {
            throw 'Port digunakan proses lain atau bukan loopback. Proses tersebut tidak diubah.'
        }
    }
}

function Assert-PostgresProof($config, $proof) {
    if (-not (Same-Path $config.dataDirectory $proof.dataDirectory) -or
        [string]$proof.systemIdentifier -cne [string]$config.systemIdentifier -or
        [int]$proof.major -ne [int]$config.postgresMajor -or
        [int]$proof.port -ne [int]$config.postgresPort -or $proof.listenAddress -ne '127.0.0.1') {
        throw 'Identitas PostgreSQL berbeda dari konfigurasi lokal yang disetujui. Tidak ada perubahan dilakukan.'
    }
}

function Get-LocalProcess([int]$processId) {
    return Get-CimInstance Win32_Process -Filter ('ProcessId=' + $processId) -ErrorAction Stop
}

function Get-Listeners([int]$port) {
    return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Read-LauncherConfiguration([string]$repository) {
    $runtime = Join-Path $repository 'output/local-runtime'
    $configFile = Join-Path $runtime 'local-launcher.json'
    if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) {
        throw 'Konfigurasi lokal belum tersedia: output/local-runtime/local-launcher.json. Hubungi pengelola; launcher tidak membuat database baru.'
    }
    try { $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json } catch { throw 'Konfigurasi launcher tidak valid.' }
    if ($config.format -ne 1 -or $config.appPort -ne 3000 -or $config.postgresPort -ne 55432 -or
        $config.postgresMajor -ne 18 -or [string]$config.systemIdentifier -notmatch '^[0-9]{10,30}$') { throw 'Metadata launcher tidak valid.' }
    foreach ($field in @('nodePath', 'postgresBin', 'dataDirectory', 'envFile')) {
        $value = [string]$config.$field
        if (-not [IO.Path]::IsPathRooted($value) -or $value.StartsWith('\\') -or $value -match '[\x00-\x1f"]') { throw 'Path launcher harus berupa path lokal absolut.' }
        $config.$field = [IO.Path]::GetFullPath($value)
    }
    if (-not (Same-Path $config.nodePath (Join-Path $runtime 'node-v24.21.0-win-x64/node.exe')) -or
        -not (Same-Path $config.dataDirectory (Join-Path $runtime 'postgres-data')) -or
        -not (Same-Path $config.envFile (Join-Path $runtime 'backend.env'))) { throw 'Path runtime tidak cocok dengan checkout ini.' }
    foreach ($directory in @($repository, $runtime, $config.dataDirectory)) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container) -or
            ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Direktori runtime tidak tersedia atau merupakan tautan.' }
    }
    $config | Add-Member -NotePropertyName entryPath -NotePropertyValue (Join-Path $repository 'backend/dist/internal-runtime.js')
    $config | Add-Member -NotePropertyName runtimeRoot -NotePropertyValue $runtime
    $config | Add-Member -NotePropertyName repository -NotePropertyValue $repository
    return $config
}

function Read-PostgresProof($config) {
    $pgControl = Join-Path $config.postgresBin 'pg_controldata.exe'
    $postgres = Join-Path $config.postgresBin 'postgres.exe'
    foreach ($file in @($pgControl, $postgres, (Join-Path $config.postgresBin 'pg_ctl.exe'), (Join-Path $config.dataDirectory 'PG_VERSION'))) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'PostgreSQL 18 lokal belum tersedia. Hubungi pengelola; jangan membuat cluster pengganti.' }
    }
    $previousLocale = [Environment]::GetEnvironmentVariable('LC_ALL', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('LC_ALL', 'C', 'Process')
        $control = (& $pgControl $config.dataDirectory 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0 -or $control -notmatch 'Database system identifier:\s*([0-9]+)') { throw 'Identitas cluster PostgreSQL tidak dapat dibaca.' }
        $identifier = $Matches[1]
        $port = (& $postgres -D $config.dataDirectory -C port 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi port PostgreSQL tidak dapat dibaca.' }
        $address = (& $postgres -D $config.dataDirectory -C listen_addresses 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi listener PostgreSQL tidak dapat dibaca.' }
    } finally { [Environment]::SetEnvironmentVariable('LC_ALL', $previousLocale, 'Process') }
    $proof = [pscustomobject]@{
        dataDirectory = (Resolve-Path -LiteralPath $config.dataDirectory).Path
        systemIdentifier = $identifier
        major = [int](Get-Content -LiteralPath (Join-Path $config.dataDirectory 'PG_VERSION') -Raw).Trim()
        port = [int]$port
        listenAddress = $address
    }
    Assert-PostgresProof $config $proof
    return $proof
}

function Get-DatabaseStatus($config) {
    $null = Read-PostgresProof $config
    $listeners = @(Get-Listeners $config.postgresPort)
    $pidFile = Join-Path $config.dataDirectory 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
        if ($listeners.Count) { throw 'Port PostgreSQL digunakan cluster lain. Tidak ada perubahan dilakukan.' }
        return [pscustomobject]@{running=$false; processId=$null}
    }
    $lines = @(Get-Content -LiteralPath $pidFile)
    if ($lines.Count -lt 6 -or $lines[0] -notmatch '^[0-9]+$' -or
        -not (Same-Path $lines[1] $config.dataDirectory) -or [int]$lines[3] -ne $config.postgresPort -or $lines[5] -ne '127.0.0.1') { throw 'Metadata proses PostgreSQL tidak cocok.' }
    $process = Get-LocalProcess ([int]$lines[0])
    if ($null -eq $process) {
        if ($listeners.Count) { throw 'Port PostgreSQL digunakan proses yang tidak dikenal.' }
        return [pscustomobject]@{running=$false; processId=$null}
    }
    $arguments = @(Split-NativeCommandLine $process.CommandLine)
    if (-not (Same-Path $process.ExecutablePath (Join-Path $config.postgresBin 'postgres.exe')) -or
        $arguments.Count -ne 3 -or $arguments[1] -ne '-D' -or -not (Same-Path $arguments[2] $config.dataDirectory)) { throw 'Proses PostgreSQL bukan milik cluster lokal ini.' }
    $epoch = [datetime]'1970-01-01T00:00:00Z'
    $ageDifference = [Math]::Abs(($process.CreationDate.ToUniversalTime() - $epoch.ToUniversalTime()).TotalSeconds - [double]$lines[2])
    if ($ageDifference -gt 3) { throw 'PID PostgreSQL telah digunakan ulang. Proses tidak diubah.' }
    Assert-OwnedListeners $listeners $process.ProcessId
    if (-not $listeners.Count) { throw 'Proses PostgreSQL ada tetapi listener lokal belum siap.' }
    return [pscustomobject]@{running=$true; processId=$process.ProcessId}
}

function Read-AppState($config) {
    $file = Join-Path $config.runtimeRoot 'local-launcher-state.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        if ($state.format -ne 1 -or -not (Same-Path $state.repository $config.repository) -or [int]$state.processId -le 0) { throw 'Invalid state' }
        return $state
    } catch { throw 'State launcher tidak valid; hubungi pengelola sebelum melanjutkan.' }
}

function Get-AppStatus($config) {
    $state = Read-AppState $config
    $process = $null
    if ($null -ne $state) { $process = Get-LocalProcess ([int]$state.processId) }
    $owned = Test-OwnedApplication $config $state $process
    $listeners = @(Get-Listeners $config.appPort)
    if ($listeners.Count) {
        if (-not $owned) { throw 'Port 3000 digunakan proses di luar launcher ini. Tutup melalui pemiliknya; launcher tidak mengambil alih.' }
        Assert-OwnedListeners $listeners $process.ProcessId
    }
    return [pscustomobject]@{running=$owned; listening=($listeners.Count -gt 0); state=$state; process=$process}
}

function Read-AppReadiness {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/ready' -TimeoutSec 2
        $body = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -eq 200 -and $body.status -eq 'ready' -and $body.application.profile -eq 'internal') { return $body }
    } catch { return $null }
    return $null
}

function Write-AppReadiness($readiness) {
    Write-Output 'Aplikasi: siap. Buka http://127.0.0.1:3000'
    $storage = $readiness.dependencies.blobStorage
    if ($storage.configured -and $storage.ready -and $readiness.dependencies.malwareScanner.state -ne 'disabled') {
        Write-Output 'Penyimpanan berkas dan pemindai: dikonfigurasi; ikuti status pemeriksaan setiap berkas.'
    } else { Write-Output 'Berkas digital: belum siap (penyimpanan atau pemindai belum tersedia). Pengelolaan metadata tersedia.' }
    if (-not $readiness.application.externalIntegrations.srikandi.enabled) { Write-Output 'Integrasi SRIKANDI: nonaktif.' }
}

function Format-LocalBackupStatus($metadata, [datetime]$now) {
    try {
        if ($null -eq $metadata -or $metadata.format -ne 1) { throw 'Invalid metadata' }
        if ($metadata.PSObject.Properties['lastAttempt'] -and $metadata.lastAttempt.status -eq 'failed') {
            Write-Output 'Backup: operasi terakhir gagal. Pengelola perlu memeriksa laporan privat; bukti sukses sebelumnya tetap tercatat.'
        }
        if (-not $metadata.PSObject.Properties['lastBackup']) { Write-Output 'Backup: belum ada backup database lokal yang berhasil tercatat.'; return }
        $backup = $metadata.lastBackup
        $snapshot = [datetime]::MinValue
        if ($backup.status -ne 'passed' -or -not [datetime]::TryParse([string]$backup.snapshot_at, [ref]$snapshot) -or
            -not $backup.PSObject.Properties['run_id'] -or $snapshot.ToUniversalTime() -gt $now.ToUniversalTime()) { throw 'Invalid backup metadata' }
        $age = [Math]::Round(($now.ToUniversalTime() - $snapshot.ToUniversalTime()).TotalHours, 1)
        Write-Output ('Backup database: snapshot ' + $snapshot.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss') + ' (usia ' + $age + ' jam).')
        if ($metadata.PSObject.Properties['lastVerification'] -and $metadata.lastVerification.status -eq 'passed' -and
            $metadata.lastVerification.run_id -ceq $backup.run_id) {
            Write-Output 'Backup terbaru: restore terpisah terverifikasi. Ini bukti database; berkas digital eksternal tidak dicakup.'
        } else { Write-Output 'Backup terbaru: belum diuji restore. Jalankan prosedur verifikasi dalam docs/BACKUP_LOKAL.md.' }
    } catch { Write-Output 'Backup: metadata status tidak valid. Pengelola perlu memeriksa laporan privat.' }
}

function Write-LocalBackupStatus($config) {
    $file = Join-Path $config.runtimeRoot 'local-backup-status.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Write-Output 'Backup: belum ada backup database lokal yang berhasil tercatat.'; return }
    try {
        $item = Get-Item -LiteralPath $file
        if ($item.Length -gt 32768 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe status file' }
        Format-LocalBackupStatus (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json) ([datetime]::UtcNow)
    } catch { Write-Output 'Backup: metadata status tidak valid. Pengelola perlu memeriksa laporan privat.' }
}

function Stop-OwnedApplication($config) {
    $app = Get-AppStatus $config
    if ($app.running) {
        $process = Get-LocalProcess ([int]$app.state.processId)
        if (-not (Test-OwnedApplication $config $app.state $process)) { throw 'Identitas aplikasi berubah sebelum penghentian.' }
        Stop-Process -Id $process.ProcessId -ErrorAction Stop
        $deadline = [datetime]::UtcNow.AddSeconds(10)
        while ($null -ne (Get-LocalProcess $process.ProcessId)) {
            if ([datetime]::UtcNow -ge $deadline) { throw 'Aplikasi belum berhenti; periksa status sebelum mencoba lagi.' }
            Start-Sleep -Milliseconds 200
        }
    }
    Write-Output 'Aplikasi lokal berhenti.'
}

function Assert-BuiltRuntime($config) {
    foreach ($file in @($config.nodePath, $config.envFile, $config.entryPath, (Join-Path $config.repository 'frontend/dist/index.html'))) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Runtime atau hasil build belum lengkap. Pengelola perlu menyiapkan Node 24, backend.env, backend/dist/internal-runtime.js dan frontend/dist; launcher tidak menginstal atau membangun otomatis.' }
    }
}

function Start-OwnedApplication($config) {
    Assert-BuiltRuntime $config
    $environment = @{}
    # Node --env-file must not be overridden by inherited deployment credentials or injection flags.
    $controlled = '^(NODE_OPTIONS|NODE_PATH|NODE_ENV|PORT|DATABASE_URL|FRONTEND_URL|ADDITIONAL_TRUSTED_ORIGINS|COOKIE_DOMAIN|APP_MODE|APP_PROFILE|AUTH_PROVIDER|BETTER_AUTH_.*|SIMSA_.*|K_SERVICE|K_REVISION|K_CONFIGURATION|VERCEL.*|GOOGLE.*|GCP.*|FIREBASE.*|OBJECT_STORAGE_.*|STORAGE.*|FINAL_OBJECT.*|BLOB.*|MALWARE.*|SMTP.*|EMAIL.*|SRIKANDI.*|PG.*)$'
    foreach ($item in Get-ChildItem Env:) {
        if ($item.Name -match $controlled) { $environment[$item.Name] = $item.Value }
    }
    try {
        foreach ($name in @($environment.Keys)) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        [Environment]::SetEnvironmentVariable('SIMSA_INTERNAL_LOCAL', 'true', 'Process')
        [Environment]::SetEnvironmentVariable('SIMSA_INTERNAL_PORT', '3000', 'Process')
        $version = & $config.nodePath --version
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'Launcher memerlukan Node.js 24 lokal.' }
        $arguments = @((Quote-NativeArgument ('--env-file=' + $config.envFile)), (Quote-NativeArgument $config.entryPath))
        $child = Start-Process -FilePath $config.nodePath -ArgumentList $arguments -WorkingDirectory $config.repository -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $config.runtimeRoot 'internal-app.stdout.log') `
            -RedirectStandardError (Join-Path $config.runtimeRoot 'internal-app.stderr.log') -PassThru
    } finally {
        [Environment]::SetEnvironmentVariable('SIMSA_INTERNAL_LOCAL', $null, 'Process')
        [Environment]::SetEnvironmentVariable('SIMSA_INTERNAL_PORT', $null, 'Process')
        foreach ($name in @($environment.Keys)) { [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process') }
    }
    $process = Get-LocalProcess $child.Id
    if ($null -eq $process) { throw 'Aplikasi gagal mulai; pengelola dapat memeriksa internal-app.stderr.log.' }
    $state = [pscustomobject]@{format=1; repository=$config.repository; processId=$process.ProcessId; createdUtc=$process.CreationDate.ToUniversalTime().ToString('o')}
    if (-not (Test-OwnedApplication $config $state $process)) { throw 'Identitas proses baru tidak cocok; periksa proses secara manual.' }
    $stateFile = Join-Path $config.runtimeRoot 'local-launcher-state.json'
    [IO.File]::WriteAllText($stateFile + '.tmp', ($state | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath ($stateFile + '.tmp') -Destination $stateFile -Force
}

function Invoke-PostgresControl($config, [ValidateSet('start', 'stop')][string]$operation) {
    $arguments = @('-D', (Quote-NativeArgument $config.dataDirectory), '-w', '-t', '30')
    if ($operation -eq 'start') { $arguments += @('-l', (Quote-NativeArgument (Join-Path $config.runtimeRoot 'postgres.log'))) }
    else { $arguments += @('-m', 'fast') }
    $arguments += $operation
    # Wait for pg_ctl itself, not its long-lived PostgreSQL descendant. Redirected
    # files also prevent Windows descendants retaining a parent output pipe.
    $child = Start-Process -FilePath (Join-Path $config.postgresBin 'pg_ctl.exe') -ArgumentList $arguments -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $config.runtimeRoot 'postgres-control.stdout.log') `
        -RedirectStandardError (Join-Path $config.runtimeRoot 'postgres-control.stderr.log') -PassThru
    # PowerShell 5 can lose a short-lived child's exit code unless its process
    # handle is retained before waiting. Do not use Start-Process -Wait: that
    # also waits for PostgreSQL descendants during start.
    $null = $child.Handle
    if (-not $child.WaitForExit(35000)) { throw 'Perintah PostgreSQL belum selesai. Periksa status lokal sebelum mencoba kembali.' }
    $child.Refresh()
    if ($child.ExitCode -ne 0) { throw 'Perintah PostgreSQL gagal. Pengelola dapat memeriksa postgres-control.stderr.log; jangan membuat cluster pengganti.' }
}

function Invoke-LocalLauncher([string]$requestedAction, [bool]$stopPostgres, [bool]$openPage) {
    if ($stopPostgres -and $requestedAction -ne 'stop') { throw '-StopDatabase hanya berlaku untuk stop.' }
    $repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
    $config = Read-LauncherConfiguration $repository
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $mutexId = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($repository.ToLowerInvariant()))).Replace('-', '') } finally { $hash.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\SIMSA-local-' + $mutexId))
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Launcher SIMSA lain sedang berjalan. Tunggu sampai selesai.' }
        # Reject an unknown occupied application port before starting any service.
        $app = Get-AppStatus $config
        if ($requestedAction -eq 'start') { Assert-BuiltRuntime $config }
        $database = Get-DatabaseStatus $config
        if ($requestedAction -eq 'stop') {
            Stop-OwnedApplication $config
            if ($stopPostgres -and $database.running) {
                $database = Get-DatabaseStatus $config
                if ($database.running) {
                    Invoke-PostgresControl $config 'stop'
                    Write-Output 'PostgreSQL lokal berhenti.'
                }
            } elseif ($database.running) { Write-Output 'PostgreSQL tetap berjalan; data tidak diubah.' }
            return
        }
        if ($requestedAction -eq 'status') {
            if ($database.running) { Write-Output ('PostgreSQL: berjalan pada 127.0.0.1:55432 (PID ' + $database.processId + ').') } else { Write-Output 'PostgreSQL: berhenti.' }
            if ($app.running -and $app.listening) {
                $readiness = Read-AppReadiness
                if ($null -ne $readiness) { Write-AppReadiness $readiness } else { Write-Output 'Aplikasi: proses ada, tetapi belum siap. Periksa log lokal.' }
            } else { Write-Output 'Aplikasi: berhenti. Jalankan Mulai-SIMSA.cmd.' }
            Write-LocalBackupStatus $config
            return
        }
        if (-not $database.running) {
            # Identity and effective loopback configuration were checked above; no bootstrap/seed/migration.
            Invoke-PostgresControl $config 'start'
            $database = Get-DatabaseStatus $config
            if (-not $database.running) { throw 'PostgreSQL belum siap.' }
        }
        $startedHere = $false
        if (-not $app.running) { Start-OwnedApplication $config; $startedHere = $true }
        $deadline = [datetime]::UtcNow.AddSeconds(40)
        do {
            $app = Get-AppStatus $config
            if (-not $app.running) { throw 'Aplikasi berhenti sebelum siap. Pengelola dapat memeriksa internal-app.stderr.log.' }
            if ($app.listening) {
                $readiness = Read-AppReadiness
                if ($null -ne $readiness) {
                    Write-AppReadiness $readiness
                    if ($openPage) { Start-Process 'http://127.0.0.1:3000' }
                    return
                }
            }
            Start-Sleep -Milliseconds 500
        } while ([datetime]::UtcNow -lt $deadline)
        if ($startedHere) { Stop-OwnedApplication $config }
        throw 'Aplikasi belum siap setelah 40 detik. Periksa log lokal; PostgreSQL tetap berjalan.'
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-LocalLauncher $Action $StopDatabase.IsPresent $OpenBrowser.IsPresent; exit 0 }
    catch { Write-Output ('SIMSA: ' + $_.Exception.Message); exit 1 }
}
