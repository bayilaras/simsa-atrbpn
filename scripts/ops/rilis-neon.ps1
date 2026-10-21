<#
.SYNOPSIS
Operasi Neon saat rilis SIMSA dengan kredensial dari prompt tersembunyi.

.DESCRIPTION
Meminta password (atau connection string utuh) lewat Read-Host -AsSecureString,
lalu menjalankan scripts/ops/rilis-neon.mjs. Kredensial tidak ditulis ke disk,
argumen, atau log: hanya hidup di env proses Node selama helper berjalan, lalu
dihapus. Lihat docs/RUNBOOK_KREDENSIAL_DATABASE.md.

  backup          simsa_backup    -> scripts/neon-backup.mjs create (bundle terenkripsi)
  diag-backup     simsa_backup    -> diagnosa langkah backup tanpa menulis bundle/kunci
  migrate         simsa_migration -> scripts/neon-database.mjs migrate --apply
  verify-runtime  simsa_api       -> scripts/neon-database.mjs verify-runtime (baca saja)
  rotate-migrate  pemilik (Owner) -> rotasi simsa_migration ke password acak sekali pakai, lalu migrate
  rotate-role     pemilik (Owner) -> rotasi -Role ke password baru dari password manager

.EXAMPLE
.\scripts\ops\rilis-neon.ps1 -Action migrate -NeonHost ep-xxx.c-3.ap-southeast-1.aws.neon.tech -Database neondb -Checkout ..\simsa-rilis-c57\source
#>
param(
    [Parameter(Mandatory)][ValidateSet('backup', 'diag-backup', 'migrate', 'verify-runtime', 'rotate-migrate', 'rotate-role')][string]$Action,
    # Target non-rahasia; nilainya ada di variabel GitHub NEON_BACKUP_EXPECTED_HOST/_DATABASE.
    [string]$NeonHost = $env:SIMSA_NEON_HOST,
    [string]$Database = $env:SIMSA_NEON_DATABASE,
    # Sumber beku rilis (hasil release-source.mjs). Bawaan: repository skrip ini.
    [string]$Checkout = (Join-Path $PSScriptRoot '..\..'),
    [ValidateSet('simsa_migration', 'simsa_backup', 'simsa_api', 'simsa_worker', 'simsa_operator')][string]$Role,
    [string]$Owner = 'neondb_owner',
    [string]$PgBin = $env:SIMSA_PG_BIN,
    [string]$Output,
    [string]$KeyDirectory,
    [string]$Node = 'node'
)
$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $secure.Dispose() }
}

if (-not $NeonHost -or -not $Database) { throw 'Isi -NeonHost dan -Database (atau SIMSA_NEON_HOST/SIMSA_NEON_DATABASE).' }
if ($Action -eq 'rotate-role' -and -not $Role) { throw 'rotate-role memerlukan -Role.' }
$nodeVersion = & $Node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or -not "$nodeVersion".StartsWith('24.')) { throw "Butuh Node.js 24 (ditemukan '$nodeVersion'); pakai -Node <path node.exe>." }
if ($Action -in 'backup', 'diag-backup' -and -not $PgBin) {
    $standard = Join-Path $env:ProgramFiles 'PostgreSQL\18\bin'
    if (Test-Path (Join-Path $standard 'pg_dump.exe')) { $PgBin = $standard } else { throw 'Isi -PgBin (folder bin PostgreSQL 18).' }
}

$arguments = @((Join-Path $PSScriptRoot 'rilis-neon.mjs'), $Action, '--host', $NeonHost, '--database', $Database,
    '--checkout', (Resolve-Path $Checkout).Path)
if ($Action -in 'rotate-migrate', 'rotate-role') { $arguments += '--owner', $Owner }
if ($Role) { $arguments += '--role', $Role }
if ($Action -in 'backup', 'diag-backup') {
    $arguments += '--pg-bin', $PgBin
    if ($Output) { $arguments += '--output', $Output }
}
if ($Action -eq 'backup' -and $KeyDirectory) { $arguments += '--key-directory', $KeyDirectory }

$login = @{ 'backup' = 'simsa_backup'; 'diag-backup' = 'simsa_backup'; 'migrate' = 'simsa_migration'; 'verify-runtime' = 'simsa_api'
    'rotate-migrate' = $Owner; 'rotate-role' = $Owner }[$Action]
$code = 1
try {
    $env:SIMSA_OPS_CREDENTIAL = Read-Secret "Password atau connection string $login (tidak ditampilkan)"
    if ($Action -eq 'rotate-role') {
        $first = Read-Secret "Password BARU $Role dari password manager (tidak ditampilkan)"
        $second = Read-Secret "Ulangi password BARU $Role"
        if ($first -cne $second) { throw 'Password baru tidak sama; dibatalkan.' }
        $env:SIMSA_OPS_NEW_PASSWORD = $first
        $first = $null; $second = $null
    }
    & $Node @arguments
    $code = $LASTEXITCODE
} finally {
    Remove-Item 'env:SIMSA_OPS_CREDENTIAL', 'env:SIMSA_OPS_NEW_PASSWORD' -ErrorAction SilentlyContinue
}
exit $code
