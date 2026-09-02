$ErrorActionPreference = "Stop"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Get-RequiredTestCredential([string]$name) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable $name is not set. Refusing to run with a default credential."
    }
    return $value
}

$testLoginEmail = Get-RequiredTestCredential "SIMSA_TEST_EMAIL"
$testLoginPassword = Get-RequiredTestCredential "SIMSA_TEST_PASSWORD"
$body = @{ email = $testLoginEmail; password = $testLoginPassword } | ConvertTo-Json -Compress

try {
    $loginR = Invoke-WebRequest -Uri "http://localhost:3001/api/auth/sign-in/email" -Method POST -ContentType "application/json" -Body $body -WebSession $session -UseBasicParsing
    Write-Host "Login: $($loginR.StatusCode)"
}
catch {
    Write-Host "Login failed: $($_.Exception.Message)"
    exit 1
}

$times = @()
for ($i = 0; $i -lt 5; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3001/api/dashboard/stats" -WebSession $session -UseBasicParsing
        $sw.Stop()
        $times += $sw.ElapsedMilliseconds
        Write-Host "Run $($i+1): $($sw.ElapsedMilliseconds)ms (HTTP $($r.StatusCode))"
    }
    catch {
        $sw.Stop()
        Write-Host "Run $($i+1): FAILED after $($sw.ElapsedMilliseconds)ms - $($_.Exception.Message)"
    }
}

if ($times.Count -gt 0) {
    $avg = ($times | Measure-Object -Average).Average
    $min = ($times | Measure-Object -Minimum).Minimum
    $max = ($times | Measure-Object -Maximum).Maximum
    Write-Host ""
    Write-Host "=== RESULTS ==="
    Write-Host "Dashboard Stats AVG: $([math]::Round($avg))ms"
    Write-Host "Min: ${min}ms / Max: ${max}ms"
    Write-Host "Previous: 1541ms"
    Write-Host "Improvement: $([math]::Round((1 - $avg/1541) * 100))%"
}
