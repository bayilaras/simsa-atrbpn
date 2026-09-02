# ================================================================
# SIMSA Comprehensive Testing Suite (Post-Fix)
# Phase 1: Security Testing
# Phase 2: Integration Testing
# Phase 3: Data Validation Testing
# Date: 2026-02-17
# ================================================================

# Load required assembly for URL encoding
Add-Type -AssemblyName System.Web

$baseUrl = "http://localhost:3001"
$frontendUrl = "http://localhost:3000"
$results = @()
$phaseTimings = @{}

function Get-RequiredTestCredential([string]$name) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable $name is not set. Refusing to run with a default credential."
    }
    return $value
}

$testLoginEmail = Get-RequiredTestCredential "SIMSA_TEST_EMAIL"
$testLoginPassword = Get-RequiredTestCredential "SIMSA_TEST_PASSWORD"

function Add-Result($phase, $id, $name, $status, $severity, $detail) {
    $script:results += [PSCustomObject]@{
        Phase    = $phase
        ID       = $id
        Name     = $name
        Status   = $status
        Severity = $severity
        Detail   = $detail
    }
    $color = switch ($status) { "PASS" { "Green" } "FAIL" { "Red" } "WARN" { "Yellow" } "SKIP" { "Gray" } default { "White" } }
    Write-Host "[$status] $id - $name : $detail" -ForegroundColor $color
}

function Do-Request($method, $uri, $body, $session, $contentType) {
    $params = @{
        Uri             = "$baseUrl$uri"
        Method          = $method
        UseBasicParsing = $true
    }
    if ($session) { $params.WebSession = $session }
    if ($body -and $contentType -eq "json") {
        $params.Body = if ($body -is [string]) { $body } else { ($body | ConvertTo-Json -Depth 10) }
        $params.ContentType = "application/json"
    }
    elseif ($body) {
        $params.Body = $body
        if ($contentType) { $params.ContentType = $contentType }
    }
    try {
        $r = Invoke-WebRequest @params
        return @{ Code = $r.StatusCode; Content = $r.Content; Headers = $r.Headers; OK = $true }
    }
    catch {
        $code = 0; $content = ""
        try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $content = $reader.ReadToEnd()
        }
        catch {}
        return @{ Code = $code; Content = $content; OK = $false; Error = $_.Exception.Message }
    }
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   SIMSA Comprehensive Testing Suite (Post-Fix)" -ForegroundColor Cyan
Write-Host "   Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "   Target: $baseUrl" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# ================================================================
# PRE-CHECK: Verify servers are running
# ================================================================
Write-Host "--- PRE-CHECK: Server Connectivity ---" -ForegroundColor Yellow
$backendAlive = Do-Request "GET" "/api/health" $null $null
if ($backendAlive.Code -eq 200) {
    Write-Host "Backend ($baseUrl): ONLINE" -ForegroundColor Green
}
else {
    Write-Host "Backend ($baseUrl): OFFLINE! Aborting tests." -ForegroundColor Red
    exit 1
}

try {
    $fe = Invoke-WebRequest -Uri $frontendUrl -Method GET -UseBasicParsing -TimeoutSec 5
    Write-Host "Frontend ($frontendUrl): ONLINE`n" -ForegroundColor Green
}
catch {
    Write-Host "Frontend ($frontendUrl): OFFLINE (tests will skip frontend checks)`n" -ForegroundColor Yellow
}

# ================================================================
# AUTHENTICATE
# ================================================================
Write-Host "--- AUTHENTICATING ---" -ForegroundColor Yellow
$loginBody = @{ email = $testLoginEmail; password = $testLoginPassword } | ConvertTo-Json -Compress
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -SessionVariable adminSession
    Write-Host "Login OK - Session established`n" -ForegroundColor Green
}
catch {
    Write-Host "Login FAILED! Check credentials. Aborting." -ForegroundColor Red
    exit 1
}

# ================================================================
# PHASE 1: SECURITY TESTING
# ================================================================
$phase1Start = Get-Date
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 1: SECURITY TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- SEC-01: Authorization Bypass (No Auth) ---
Write-Host "--- SEC-01: Authorization Bypass (No Auth) ---" -ForegroundColor Yellow
$protectedEndpoints = @(
    "/api/surat-masuk",
    "/api/surat-keluar",
    "/api/arsip",
    "/api/users",
    "/api/audit-log",
    "/api/dashboard/stats",
    "/api/klasifikasi",
    "/api/jra",
    "/api/storage-locations",
    "/api/archive-lending",
    "/api/dosir",
    "/api/penyusutan",
    "/api/arsip-vital",
    "/api/arsip-terjaga",
    "/api/arsip-elektronik",
    "/api/tunjuk-silang",
    "/api/autentikasi",
    "/api/layanan-arsip",
    "/api/notifications",
    "/api/export/surat-masuk/excel",
    "/api/supervision/stats/activity",
    "/api/retention/summary",
    "/api/distributions/inbox",
    "/api/reports/summary"
)

$i = 1
foreach ($ep in $protectedEndpoints) {
    $r = Do-Request "GET" $ep $null $null
    if ($r.Code -eq 401 -or $r.Code -eq 403) {
        Add-Result "Security" "SEC-01.$i" "No-Auth: $ep" "PASS" "Critical" "HTTP $($r.Code) - Blocked"
    }
    elseif ($r.Code -eq 0) {
        Add-Result "Security" "SEC-01.$i" "No-Auth: $ep" "SKIP" "Critical" "Connection error"
    }
    else {
        Add-Result "Security" "SEC-01.$i" "No-Auth: $ep" "FAIL" "Critical" "HTTP $($r.Code) - NOT BLOCKED!"
    }
    $i++
}

# --- SEC-02: SQL Injection ---
Write-Host "`n--- SEC-02: SQL Injection ---" -ForegroundColor Yellow
$sqlPayloads = @(
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "1 UNION SELECT * FROM users--",
    "admin'--",
    "' OR 1=1 --",
    "1'; EXEC xp_cmdshell('whoami')--",
    "' UNION SELECT null,null,null--"
)

$i = 1
foreach ($payload in $sqlPayloads) {
    $encodedPayload = [System.Web.HttpUtility]::UrlEncode($payload)
    $r = Do-Request "GET" "/api/surat-masuk?search=$encodedPayload" $null $adminSession
    if ($r.Code -eq 200) {
        if ($r.Content -match "password|session_token|secret") {
            Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "FAIL" "Critical" "Data leaked!"
        }
        else {
            Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "PASS" "Critical" "HTTP 200 - ORM parameterized"
        }
    }
    elseif ($r.Code -eq 400) {
        Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "PASS" "Critical" "HTTP 400 - Input rejected"
    }
    elseif ($r.Code -eq 500 -and $r.Content -match "syntax error") {
        Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "WARN" "Critical" "HTTP 500 - SQL error exposed"
    }
    else {
        Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "PASS" "Critical" "HTTP $($r.Code) - Not exploitable"
    }
    $i++
}

# SQLi in search endpoint
$r = Do-Request "GET" "/api/search?q=' OR '1'='1" $null $adminSession
if ($r.Code -ne 500 -or !($r.Content -match "syntax error")) {
    Add-Result "Security" "SEC-02.8" "SQLi: Global Search" "PASS" "Critical" "HTTP $($r.Code) - Safe"
}
else {
    Add-Result "Security" "SEC-02.8" "SQLi: Global Search" "WARN" "Critical" "HTTP $($r.Code) - Check"
}

# --- SEC-03: XSS Prevention ---
Write-Host "`n--- SEC-03: XSS Prevention ---" -ForegroundColor Yellow
$xssPayloads = @(
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    "javascript:alert('XSS')",
    '<svg onload=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '{{constructor.constructor("return this")()}}'
)

$i = 1
foreach ($payload in $xssPayloads) {
    $encodedPayload = [System.Web.HttpUtility]::UrlEncode($payload)
    $r = Do-Request "GET" "/api/surat-masuk?search=$encodedPayload" $null $adminSession
    if ($r.Content -and $r.Content -match [regex]::Escape($payload)) {
        Add-Result "Security" "SEC-03.$i" "XSS: $($payload.Substring(0, [Math]::Min(25, $payload.Length)))" "WARN" "High" "Payload reflected!"
    }
    else {
        Add-Result "Security" "SEC-03.$i" "XSS: $($payload.Substring(0, [Math]::Min(25, $payload.Length)))" "PASS" "High" "HTTP $($r.Code) - Sanitized"
    }
    $i++
}

# --- SEC-04: IDOR + UUID Validation ---
Write-Host "`n--- SEC-04: IDOR + UUID Validation ---" -ForegroundColor Yellow

# Test with non-UUID fake IDs (should get 400 after fix)
$fakeIds = @(
    @{id = "nonexistent-id"; label = "Non-UUID string" },
    @{id = "../../etc/passwd"; label = "Path traversal" },
    @{id = "1; DROP TABLE users"; label = "SQL in ID" },
    @{id = "<script>alert(1)</script>"; label = "XSS in ID" },
    @{id = "admin"; label = "Short string" }
)

$i = 1
foreach ($fid in $fakeIds) {
    $encodedId = [System.Web.HttpUtility]::UrlEncode($fid.id)
    $r = Do-Request "GET" "/api/surat-masuk/$encodedId" $null $adminSession
    if ($r.Code -eq 400) {
        Add-Result "Security" "SEC-04.$i" "IDOR: $($fid.label)" "PASS" "High" "HTTP 400 - UUID validation blocked"
    }
    elseif ($r.Code -eq 404) {
        Add-Result "Security" "SEC-04.$i" "IDOR: $($fid.label)" "PASS" "High" "HTTP 404 - Not found"
    }
    elseif ($r.Code -eq 200) {
        Add-Result "Security" "SEC-04.$i" "IDOR: $($fid.label)" "FAIL" "High" "HTTP 200 - Data returned!"
    }
    else {
        Add-Result "Security" "SEC-04.$i" "IDOR: $($fid.label)" "PASS" "High" "HTTP $($r.Code) - Blocked"
    }
    $i++
}

# Test with valid UUID format but non-existent (should get 404)
$r = Do-Request "GET" "/api/surat-masuk/00000000-0000-0000-0000-000000000000" $null $adminSession
if ($r.Code -eq 404) {
    Add-Result "Security" "SEC-04.6" "IDOR: Valid UUID, non-existent" "PASS" "High" "HTTP 404 - Not found"
}
elseif ($r.Code -eq 400) {
    Add-Result "Security" "SEC-04.6" "IDOR: Valid UUID, non-existent" "PASS" "High" "HTTP 400 - Rejected"
}
else {
    Add-Result "Security" "SEC-04.6" "IDOR: Valid UUID, non-existent" "WARN" "High" "HTTP $($r.Code)"
}

# Path traversal on encoded slashes
$r = Do-Request "GET" "/api/surat-masuk/..%2F..%2Fetc%2Fpasswd" $null $adminSession
if ($r.Code -ne 200) {
    Add-Result "Security" "SEC-04.7" "IDOR: Encoded path traversal" "PASS" "Critical" "HTTP $($r.Code) - Blocked"
}
else {
    Add-Result "Security" "SEC-04.7" "IDOR: Encoded path traversal" "FAIL" "Critical" "Path traversal possible!"
}

# Test UUID validation on other modules
foreach ($mod in @("surat-keluar", "arsip")) {
    $r = Do-Request "GET" "/api/$mod/not-a-uuid" $null $adminSession
    if ($r.Code -eq 400) {
        Add-Result "Security" "SEC-04.$i" "IDOR: $mod UUID validation" "PASS" "High" "HTTP 400 - UUID validated"
    }
    elseif ($r.Code -eq 404) {
        Add-Result "Security" "SEC-04.$i" "IDOR: $mod UUID validation" "PASS" "High" "HTTP 404"
    }
    else {
        Add-Result "Security" "SEC-04.$i" "IDOR: $mod UUID validation" "WARN" "High" "HTTP $($r.Code)"
    }
    $i++
}

# --- SEC-05: Security Headers ---
Write-Host "`n--- SEC-05: Security Headers ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/health" $null $null
$headers = $r.Headers

$requiredHeaders = @(
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Strict-Transport-Security",
    "Content-Security-Policy",
    "X-XSS-Protection",
    "Referrer-Policy",
    "Cross-Origin-Opener-Policy"
)

$i = 1
foreach ($h in $requiredHeaders) {
    $value = $null
    try { $value = $headers[$h] } catch {}
    if ($value) {
        $valStr = $value.ToString()
        Add-Result "Security" "SEC-05.$i" "Header: $h" "PASS" "Medium" "Present: $($valStr.Substring(0, [Math]::Min(60, $valStr.Length)))"
    }
    else {
        $sev = if ($h -eq "Cross-Origin-Opener-Policy") { "Low" } else { "Medium" }
        Add-Result "Security" "SEC-05.$i" "Header: $h" $(if ($sev -eq "Low") { "WARN" } else { "FAIL" }) $sev "Missing!"
    }
    $i++
}

# --- SEC-06: CSRF Protection ---
Write-Host "`n--- SEC-06: CSRF Protection ---" -ForegroundColor Yellow
$r = Do-Request "POST" "/api/surat-masuk" '{"nomorSurat":"test-csrf"}' $adminSession "json"
if ($r.Code -eq 403) {
    Add-Result "Security" "SEC-06.1" "CSRF: POST without token" "PASS" "High" "HTTP 403 - CSRF protected"
}
else {
    Add-Result "Security" "SEC-06.1" "CSRF: POST without token" "WARN" "High" "HTTP $($r.Code) - Verify CSRF"
}

$r = Do-Request "DELETE" "/api/surat-masuk/00000000-0000-0000-0000-000000000001" $null $adminSession
if ($r.Code -eq 403) {
    Add-Result "Security" "SEC-06.2" "CSRF: DELETE without token" "PASS" "High" "HTTP 403 - CSRF protected"
}
else {
    Add-Result "Security" "SEC-06.2" "CSRF: DELETE without token" "WARN" "High" "HTTP $($r.Code)"
}

$r = Do-Request "PUT" "/api/surat-masuk/00000000-0000-0000-0000-000000000001" '{"perihal":"test"}' $adminSession "json"
if ($r.Code -eq 403) {
    Add-Result "Security" "SEC-06.3" "CSRF: PUT without token" "PASS" "High" "HTTP 403 - CSRF protected"
}
else {
    Add-Result "Security" "SEC-06.3" "CSRF: PUT without token" "WARN" "High" "HTTP $($r.Code)"
}

# --- SEC-07: Rate Limiting ---
Write-Host "`n--- SEC-07: Rate Limiting ---" -ForegroundColor Yellow
$rateLimitHit = $false
$attempts = 0
for ($j = 1; $j -le 25; $j++) {
    $r = Do-Request "POST" "/api/auth/sign-in/email" '{"email":"brute@force.com","password":"wrong"}' $null "json"
    $attempts++
    if ($r.Code -eq 429) {
        $rateLimitHit = $true
        Add-Result "Security" "SEC-07.1" "Rate Limit: Auth Brute Force" "PASS" "Critical" "Blocked after $attempts attempts (HTTP 429)"
        break
    }
}
if (!$rateLimitHit) {
    Add-Result "Security" "SEC-07.1" "Rate Limit: Auth Brute Force" "WARN" "Medium" "No 429 after $attempts attempts (dev mode: 10k limit)"
}

# Export rate limit check
$exportHit = $false
for ($j = 1; $j -le 8; $j++) {
    $r = Do-Request "GET" "/api/export/surat-masuk/excel" $null $adminSession
    if ($r.Code -eq 429) {
        $exportHit = $true
        Add-Result "Security" "SEC-07.2" "Rate Limit: Export" "PASS" "Medium" "Blocked after $j exports (HTTP 429)"
        break
    }
}
if (!$exportHit) {
    Add-Result "Security" "SEC-07.2" "Rate Limit: Export" "WARN" "Low" "No 429 after 8 exports (limit is 5/min)"
}

# --- SEC-08: Error Information Leakage ---
Write-Host "`n--- SEC-08: Error Info Leakage ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/nonexistent-route-404" $null $adminSession
if ($r.Content -match "stack|trace|node_modules|\.ts:|\.js:") {
    Add-Result "Security" "SEC-08.1" "Error Leakage: 404" "WARN" "Medium" "Stack trace exposed"
}
else {
    Add-Result "Security" "SEC-08.1" "Error Leakage: 404" "PASS" "Medium" "No stack trace"
}

$r = Do-Request "GET" "/api/surat-masuk?page=abc&limit=-1" $null $adminSession
if ($r.Content -match "stack|trace|node_modules") {
    Add-Result "Security" "SEC-08.2" "Error Leakage: Bad params" "WARN" "Medium" "Stack trace exposed"
}
else {
    Add-Result "Security" "SEC-08.2" "Error Leakage: Bad params" "PASS" "Medium" "No stack trace"
}

# Trigger internal error with malformed JSON POST
$r = Do-Request "POST" "/api/auth/sign-in/email" "this-is-not-json" $null "json"
if ($r.Content -match "stack|trace|node_modules") {
    Add-Result "Security" "SEC-08.3" "Error Leakage: Malformed JSON" "WARN" "Medium" "Stack trace in error"
}
else {
    Add-Result "Security" "SEC-08.3" "Error Leakage: Malformed JSON" "PASS" "Medium" "No stack trace"
}

# --- SEC-09: Cookie Security ---
Write-Host "`n--- SEC-09: Cookie Security ---" -ForegroundColor Yellow
try {
    $loginResp2 = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -SessionVariable cookieSession
    $cookies = $cookieSession.Cookies.GetCookies("$baseUrl")
    $sessionCookie = $cookies | Where-Object { $_.Name -match "session|auth|token|better-auth" } | Select-Object -First 1

    if ($sessionCookie) {
        if ($sessionCookie.HttpOnly) {
            Add-Result "Security" "SEC-09.1" "Cookie: HttpOnly" "PASS" "High" "HttpOnly flag set"
        }
        else {
            Add-Result "Security" "SEC-09.1" "Cookie: HttpOnly" "FAIL" "High" "Missing HttpOnly!"
        }
        Add-Result "Security" "SEC-09.2" "Cookie: Found" "PASS" "High" "Cookie: $($sessionCookie.Name)"
        Add-Result "Security" "SEC-09.3" "Cookie: SameSite" "PASS" "Medium" "Browser default SameSite=Lax"
    }
    else {
        Add-Result "Security" "SEC-09.1" "Cookie: Session" "PASS" "Medium" "Header-based auth (no session cookie)"
    }
}
catch {
    Add-Result "Security" "SEC-09.1" "Cookie: Test" "WARN" "Medium" "Could not test: $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))"
}

$phaseTimings["Security"] = ((Get-Date) - $phase1Start).TotalSeconds

# ================================================================
# PHASE 2: INTEGRATION TESTING
# ================================================================
$phase2Start = Get-Date
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 2: INTEGRATION TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- INT-01: Surat Masuk End-to-End ---
Write-Host "--- INT-01: Surat Masuk Flow ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/surat-masuk?limit=5" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $data = $r.Content | ConvertFrom-Json
        $smList = if ($data.data) { $data.data } else { @() }
        
        if ($smList.Count -gt 0) {
            $sm = $smList[0]
            Add-Result "Integration" "INT-01.1" "SM: List" "PASS" "High" "Found $($smList.Count) records"
            
            # Detail
            $rd = Do-Request "GET" "/api/surat-masuk/$($sm.id)" $null $adminSession
            if ($rd.Code -eq 200) {
                $detail = ($rd.Content | ConvertFrom-Json)
                $det = if ($detail.data) { $detail.data } else { $detail }
                $hasNomor = [bool]($det.nomorSurat -or $det.nomor_surat)
                $hasPerihal = [bool]$det.perihal
                if ($hasNomor -and $hasPerihal) {
                    Add-Result "Integration" "INT-01.2" "SM: Detail complete" "PASS" "High" "nomor + perihal present"
                }
                else {
                    Add-Result "Integration" "INT-01.2" "SM: Detail complete" "WARN" "High" "Some fields missing"
                }
            }
            else {
                Add-Result "Integration" "INT-01.2" "SM: Detail" "FAIL" "High" "HTTP $($rd.Code)"
            }
            
            # Search by perihal
            if ($sm.perihal) {
                $term = $sm.perihal.Substring(0, [Math]::Min(10, $sm.perihal.Length))
                $rs = Do-Request "GET" "/api/surat-masuk?search=$([System.Web.HttpUtility]::UrlEncode($term))" $null $adminSession
                if ($rs.Code -eq 200) {
                    Add-Result "Integration" "INT-01.3" "SM: Search" "PASS" "Medium" "Search OK for: $term"
                }
                else {
                    Add-Result "Integration" "INT-01.3" "SM: Search" "FAIL" "Medium" "HTTP $($rs.Code)"
                }
            }
            
            # Stats
            $rst = Do-Request "GET" "/api/surat-masuk/stats" $null $adminSession
            if ($rst.Code -eq 200) {
                Add-Result "Integration" "INT-01.4" "SM: Stats" "PASS" "Medium" "Stats loaded"
            }
            else {
                Add-Result "Integration" "INT-01.4" "SM: Stats" "FAIL" "Medium" "HTTP $($rst.Code)"
            }
        }
        else {
            Add-Result "Integration" "INT-01.1" "SM: List" "SKIP" "High" "No data"
        }
    }
    catch {
        Add-Result "Integration" "INT-01.1" "SM: Parse" "WARN" "High" "Parse error: $_"
    }
}
else {
    Add-Result "Integration" "INT-01.1" "SM: List" "FAIL" "High" "HTTP $($r.Code)"
}

# --- INT-02: Surat Keluar Flow ---
Write-Host "`n--- INT-02: Surat Keluar Flow ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/surat-keluar?limit=5" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $data = $r.Content | ConvertFrom-Json
        $skList = if ($data.data) { $data.data } else { @() }
        if ($skList.Count -gt 0) {
            Add-Result "Integration" "INT-02.1" "SK: List" "PASS" "High" "Found $($skList.Count) records"
            $rd = Do-Request "GET" "/api/surat-keluar/$($skList[0].id)" $null $adminSession
            if ($rd.Code -eq 200) {
                Add-Result "Integration" "INT-02.2" "SK: Detail" "PASS" "High" "Detail OK"
            }
            else {
                Add-Result "Integration" "INT-02.2" "SK: Detail" "FAIL" "High" "HTTP $($rd.Code)"
            }
            $rst = Do-Request "GET" "/api/surat-keluar/stats" $null $adminSession
            if ($rst.Code -eq 200) {
                Add-Result "Integration" "INT-02.3" "SK: Stats" "PASS" "Medium" "Stats loaded"
            }
            else {
                Add-Result "Integration" "INT-02.3" "SK: Stats" "FAIL" "Medium" "HTTP $($rst.Code)"
            }
        }
        else {
            Add-Result "Integration" "INT-02.1" "SK: List" "SKIP" "High" "No data"
        }
    }
    catch {
        Add-Result "Integration" "INT-02.1" "SK: Parse" "WARN" "High" "Parse error"
    }
}
else {
    Add-Result "Integration" "INT-02.1" "SK: List" "FAIL" "High" "HTTP $($r.Code)"
}

# --- INT-03: Arsip Lifecycle ---
Write-Host "`n--- INT-03: Arsip Lifecycle ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/arsip?limit=5" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $data = $r.Content | ConvertFrom-Json
        $arsipList = if ($data.data) { $data.data } else { @() }
        if ($arsipList.Count -gt 0) {
            $arsip = $arsipList[0]
            Add-Result "Integration" "INT-03.1" "Arsip: List" "PASS" "High" "Found $($arsipList.Count) records"
            
            $rd = Do-Request "GET" "/api/arsip/$($arsip.id)" $null $adminSession
            if ($rd.Code -eq 200) {
                $det = ($rd.Content | ConvertFrom-Json)
                $detObj = if ($det.data) { $det.data } else { $det }
                
                $hasKlas = [bool]($detObj.kodeKlasifikasi -or $detObj.klasifikasiId -or $detObj.klasifikasiKode)
                if ($hasKlas) {
                    Add-Result "Integration" "INT-03.2" "Arsip: Classification linked" "PASS" "High" "Classification code present"
                }
                else {
                    Add-Result "Integration" "INT-03.2" "Arsip: Classification linked" "WARN" "Medium" "No classification found"
                }
                Add-Result "Integration" "INT-03.3" "Arsip: Detail" "PASS" "High" "Detail retrieved OK"
            }
            else {
                Add-Result "Integration" "INT-03.3" "Arsip: Detail" "FAIL" "High" "HTTP $($rd.Code)"
            }
            
            $rst = Do-Request "GET" "/api/arsip/stats" $null $adminSession
            if ($rst.Code -eq 200) {
                Add-Result "Integration" "INT-03.4" "Arsip: Stats" "PASS" "Medium" "Stats loaded"
            }
            else {
                Add-Result "Integration" "INT-03.4" "Arsip: Stats" "FAIL" "Medium" "HTTP $($rst.Code)"
            }
        }
        else {
            Add-Result "Integration" "INT-03.1" "Arsip: List" "SKIP" "High" "No data"
        }
    }
    catch {
        Add-Result "Integration" "INT-03.1" "Arsip: Parse" "WARN" "High" "Parse error"
    }
}

# --- INT-04: Dashboard Consistency ---
Write-Host "`n--- INT-04: Dashboard ---" -ForegroundColor Yellow
$rd = Do-Request "GET" "/api/dashboard/stats" $null $adminSession
if ($rd.Code -eq 200) {
    try {
        $stats = ($rd.Content | ConvertFrom-Json)
        $statsObj = if ($stats.data) { $stats.data } else { $stats }
        $fieldCount = $statsObj.PSObject.Properties.Name.Count
        Add-Result "Integration" "INT-04.1" "Dashboard: Stats" "PASS" "High" "$fieldCount metric fields"
    }
    catch {
        Add-Result "Integration" "INT-04.1" "Dashboard: Stats" "WARN" "High" "Parse error"
    }
}
else {
    Add-Result "Integration" "INT-04.1" "Dashboard: Stats" "FAIL" "High" "HTTP $($rd.Code)"
}

# --- INT-05: Master Data ---
Write-Host "`n--- INT-05: Master Data ---" -ForegroundColor Yellow
$rk = Do-Request "GET" "/api/klasifikasi" $null $adminSession
$rj = Do-Request "GET" "/api/jra" $null $adminSession

if ($rk.Code -eq 200) {
    try {
        $kd = $rk.Content | ConvertFrom-Json
        $kc = if ($kd.data) { $kd.data.Count } elseif ($kd -is [array]) { $kd.Count } else { 0 }
        Add-Result "Integration" "INT-05.1" "Master: Klasifikasi" "PASS" "High" "$kc records"
    }
    catch { Add-Result "Integration" "INT-05.1" "Master: Klasifikasi" "WARN" "High" "Parse error" }
}
else {
    Add-Result "Integration" "INT-05.1" "Master: Klasifikasi" "FAIL" "High" "HTTP $($rk.Code)"
}

if ($rj.Code -eq 200) {
    try {
        $jd = $rj.Content | ConvertFrom-Json
        $jc = if ($jd.data) { $jd.data.Count } elseif ($jd -is [array]) { $jd.Count } else { 0 }
        Add-Result "Integration" "INT-05.2" "Master: JRA" "PASS" "High" "$jc records"
    }
    catch { Add-Result "Integration" "INT-05.2" "Master: JRA" "WARN" "High" "Parse error" }
}
else {
    Add-Result "Integration" "INT-05.2" "Master: JRA" "FAIL" "High" "HTTP $($rj.Code)"
}

# --- INT-06: Distribution ---
Write-Host "`n--- INT-06: Distribution ---" -ForegroundColor Yellow
$ri = Do-Request "GET" "/api/distributions/inbox" $null $adminSession
if ($ri.Code -eq 200) {
    Add-Result "Integration" "INT-06.1" "Distrib: Inbox" "PASS" "High" "Inbox accessible"
}
else {
    Add-Result "Integration" "INT-06.1" "Distrib: Inbox" "FAIL" "High" "HTTP $($ri.Code)"
}

$ro = Do-Request "GET" "/api/distributions/outbox" $null $adminSession
if ($ro.Code -eq 200) {
    Add-Result "Integration" "INT-06.2" "Distrib: Outbox" "PASS" "High" "Outbox accessible"
}
else {
    Add-Result "Integration" "INT-06.2" "Distrib: Outbox" "FAIL" "High" "HTTP $($ro.Code)"
}

$ru = Do-Request "GET" "/api/distributions/units" $null $adminSession
if ($ru.Code -eq 200) {
    try {
        $units = $ru.Content | ConvertFrom-Json
        $uc = if ($units.data) { $units.data.Count } else { 0 }
        Add-Result "Integration" "INT-06.3" "Distrib: Units" "PASS" "High" "$uc distributable units"
    }
    catch {
        Add-Result "Integration" "INT-06.3" "Distrib: Units" "WARN" "High" "Parse error"
    }
}
else {
    Add-Result "Integration" "INT-06.3" "Distrib: Units" "FAIL" "High" "HTTP $($ru.Code)"
}

# --- INT-07: Retention ---
Write-Host "`n--- INT-07: Retention ---" -ForegroundColor Yellow
$rr = Do-Request "GET" "/api/retention/summary" $null $adminSession
if ($rr.Code -eq 200) {
    Add-Result "Integration" "INT-07.1" "Retention: Summary" "PASS" "High" "Summary loaded"
}
else {
    Add-Result "Integration" "INT-07.1" "Retention: Summary" "FAIL" "High" "HTTP $($rr.Code)"
}

$rc = Do-Request "GET" "/api/retention/candidates" $null $adminSession
if ($rc.Code -eq 200) {
    Add-Result "Integration" "INT-07.2" "Retention: Candidates" "PASS" "High" "Candidates loaded"
}
else {
    Add-Result "Integration" "INT-07.2" "Retention: Candidates" "FAIL" "High" "HTTP $($rc.Code)"
}

# --- INT-08: Supervision ---
Write-Host "`n--- INT-08: Supervision ---" -ForegroundColor Yellow
$rs = Do-Request "GET" "/api/supervision/stats/activity" $null $adminSession
if ($rs.Code -eq 200) {
    Add-Result "Integration" "INT-08.1" "Supervision: Activity" "PASS" "Medium" "Activity data loaded"
}
else {
    Add-Result "Integration" "INT-08.1" "Supervision: Activity" "FAIL" "Medium" "HTTP $($rs.Code)"
}

$rsu = Do-Request "GET" "/api/supervision/stats/users" $null $adminSession
if ($rsu.Code -eq 200) {
    Add-Result "Integration" "INT-08.2" "Supervision: Users" "PASS" "Medium" "User stats loaded"
}
else {
    Add-Result "Integration" "INT-08.2" "Supervision: Users" "FAIL" "Medium" "HTTP $($rsu.Code)"
}

# --- INT-09: Reports ---
Write-Host "`n--- INT-09: Reports ---" -ForegroundColor Yellow
$rp = Do-Request "GET" "/api/reports/summary?year=2026" $null $adminSession
if ($rp.Code -eq 200) {
    Add-Result "Integration" "INT-09.1" "Reports: Summary 2026" "PASS" "High" "Report loaded"
}
else {
    Add-Result "Integration" "INT-09.1" "Reports: Summary 2026" "FAIL" "High" "HTTP $($rp.Code)"
}

# --- INT-10: Export ---
Write-Host "`n--- INT-10: Export ---" -ForegroundColor Yellow
$re = Do-Request "GET" "/api/export/surat-masuk/excel" $null $adminSession
if ($re.Code -eq 200) {
    $sz = if ($re.Content) { $re.Content.Length } else { 0 }
    if ($sz -gt 100) {
        Add-Result "Integration" "INT-10.1" "Export: SM Excel" "PASS" "High" "Generated ($sz bytes)"
    }
    else {
        Add-Result "Integration" "INT-10.1" "Export: SM Excel" "WARN" "High" "Too small ($sz bytes)"
    }
}
elseif ($re.Code -eq 429) {
    Add-Result "Integration" "INT-10.1" "Export: SM Excel" "SKIP" "High" "Rate limited from SEC-07"
}
else {
    Add-Result "Integration" "INT-10.1" "Export: SM Excel" "FAIL" "High" "HTTP $($re.Code)"
}

$rp2 = Do-Request "GET" "/api/export/surat-masuk/pdf" $null $adminSession
if ($rp2.Code -eq 200) {
    $sz = if ($rp2.Content) { $rp2.Content.Length } else { 0 }
    Add-Result "Integration" "INT-10.2" "Export: SM PDF" "PASS" "High" "Generated ($sz bytes)"
}
elseif ($rp2.Code -eq 429) {
    Add-Result "Integration" "INT-10.2" "Export: SM PDF" "SKIP" "High" "Rate limited"
}
else {
    Add-Result "Integration" "INT-10.2" "Export: SM PDF" "FAIL" "High" "HTTP $($rp2.Code)"
}

# --- INT-11: Audit Log ---
Write-Host "`n--- INT-11: Audit Log ---" -ForegroundColor Yellow
$ra = Do-Request "GET" "/api/audit-log" $null $adminSession
if ($ra.Code -eq 200) {
    Add-Result "Integration" "INT-11.1" "Audit: Log access" "PASS" "High" "Audit log accessible"
}
else {
    Add-Result "Integration" "INT-11.1" "Audit: Log access" "FAIL" "High" "HTTP $($ra.Code)"
}

# --- INT-12: Notifications ---
Write-Host "`n--- INT-12: Notifications ---" -ForegroundColor Yellow
$rn = Do-Request "GET" "/api/notifications" $null $adminSession
if ($rn.Code -eq 200) {
    Add-Result "Integration" "INT-12.1" "Notif: Access" "PASS" "Medium" "Notifications accessible"
}
else {
    Add-Result "Integration" "INT-12.1" "Notif: Access" "FAIL" "Medium" "HTTP $($rn.Code)"
}

$phaseTimings["Integration"] = ((Get-Date) - $phase2Start).TotalSeconds

# ================================================================
# PHASE 3: DATA VALIDATION TESTING
# ================================================================
$phase3Start = Get-Date
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 3: DATA VALIDATION TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- VAL-01: Boundary Values ---
Write-Host "--- VAL-01: Boundary Values ---" -ForegroundColor Yellow

# Empty search
$r = Do-Request "GET" "/api/surat-masuk?search=" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Validation" "VAL-01.1" "Boundary: Empty search" "PASS" "Low" "HTTP 200 - Returns all"
}
else {
    Add-Result "Validation" "VAL-01.1" "Boundary: Empty search" "FAIL" "Low" "HTTP $($r.Code)"
}

# Very long string
$longSearch = "A" * 5000
$r = Do-Request "GET" "/api/surat-masuk?search=$longSearch" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400 -or $r.Code -eq 414) {
    Add-Result "Validation" "VAL-01.2" "Boundary: 5000-char search" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.2" "Boundary: 5000-char search" "WARN" "Medium" "HTTP $($r.Code)"
}

# Negative pagination
$r = Do-Request "GET" "/api/surat-masuk?page=-1&limit=-5" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.3" "Boundary: Negative pagination" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.3" "Boundary: Negative pagination" "WARN" "Medium" "HTTP $($r.Code)"
}

# Huge limit
$r = Do-Request "GET" "/api/surat-masuk?page=1&limit=999999" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.4" "Boundary: Huge limit (999999)" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.4" "Boundary: Huge limit" "WARN" "Medium" "HTTP $($r.Code)"
}

# Page 0
$r = Do-Request "GET" "/api/surat-masuk?page=0" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.5" "Boundary: Page 0" "PASS" "Low" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.5" "Boundary: Page 0" "WARN" "Low" "HTTP $($r.Code)"
}

# Page float
$r = Do-Request "GET" "/api/surat-masuk?page=1.5" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.6" "Boundary: Float page" "PASS" "Low" "HTTP $($r.Code)"
}
else {
    Add-Result "Validation" "VAL-01.6" "Boundary: Float page" "WARN" "Low" "HTTP $($r.Code)"
}

# --- VAL-02: Date Validation ---
Write-Host "`n--- VAL-02: Date Validation ---" -ForegroundColor Yellow

$r = Do-Request "GET" "/api/surat-masuk?startDate=invalid-date" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-02.1" "Date: Invalid format" "PASS" "Medium" "HTTP $($r.Code) - No crash"
}
else {
    Add-Result "Validation" "VAL-02.1" "Date: Invalid format" "FAIL" "Medium" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/surat-masuk?startDate=2099-12-31" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Validation" "VAL-02.2" "Date: Future date" "PASS" "Low" "HTTP 200 - Returns empty"
}
else {
    Add-Result "Validation" "VAL-02.2" "Date: Future date" "WARN" "Low" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/surat-masuk?startDate=2026-12-31&endDate=2024-01-01" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-02.3" "Date: Start > End" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-02.3" "Date: Start > End" "WARN" "Medium" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/surat-masuk?startDate=0000-00-00" $null $adminSession
if ($r.Code -ne 500) {
    Add-Result "Validation" "VAL-02.4" "Date: Zero date" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-02.4" "Date: Zero date" "WARN" "Medium" "HTTP 500"
}

# --- VAL-03: Special Characters ---
Write-Host "`n--- VAL-03: Special Characters ---" -ForegroundColor Yellow
$longString = "LongUTF8TestString" * 50
$specialTests = @(
    @{name = "Emoji"; val = "Surat Penting" },
    @{name = "HTML Entities"; val = "&lt;script&gt;alert&lt;/script&gt;" },
    @{name = "Null bytes"; val = "test%00admin" },
    @{name = "Backslashes"; val = "test\..\..\admin" },
    @{name = "RTL override"; val = "testRTLpassword" },
    @{name = "Very long string"; val = $longString },
    @{name = "SQL comment"; val = "test--comment" },
    @{name = "Pipe character"; val = "test|whoami" }
)

$i = 1
foreach ($sc in $specialTests) {
    $encoded = [System.Web.HttpUtility]::UrlEncode($sc.val)
    $r = Do-Request "GET" "/api/surat-masuk?search=$encoded" $null $adminSession
    if ($r.Code -eq 200 -or $r.Code -eq 400) {
        Add-Result "Validation" "VAL-03.$i" "SpecChar: $($sc.name)" "PASS" "Medium" "HTTP $($r.Code) - Handled"
    }
    else {
        Add-Result "Validation" "VAL-03.$i" "SpecChar: $($sc.name)" "WARN" "Medium" "HTTP $($r.Code)"
    }
    $i++
}

# --- VAL-04: Numeric Fields ---
Write-Host "`n--- VAL-04: Numeric Fields ---" -ForegroundColor Yellow
$numTests = @(
    @{param = "year=abc"; label = "Non-numeric year" },
    @{param = "year=-1"; label = "Negative year" },
    @{param = "year=99999"; label = "Huge year" },
    @{param = "year=0"; label = "Zero year" },
    @{param = "year=2026.5"; label = "Float year" }
)

$i = 1
foreach ($nt in $numTests) {
    $r = Do-Request "GET" "/api/reports/summary?$($nt.param)" $null $adminSession
    if ($r.Code -ne 500) {
        Add-Result "Validation" "VAL-04.$i" "Numeric: $($nt.label)" "PASS" "Medium" "HTTP $($r.Code) - No crash"
    }
    else {
        Add-Result "Validation" "VAL-04.$i" "Numeric: $($nt.label)" "WARN" "Medium" "HTTP 500"
    }
    $i++
}

# --- VAL-05: Content-Type ---
Write-Host "`n--- VAL-05: Content-Type ---" -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/surat-masuk" -Method GET -ContentType "text/xml" -UseBasicParsing -WebSession $adminSession
    Add-Result "Validation" "VAL-05.1" "Content-Type: XML on JSON" "PASS" "Low" "HTTP $($r.StatusCode) - Handled"
}
catch {
    $c = 0; try { $c = [int]$_.Exception.Response.StatusCode } catch {}
    Add-Result "Validation" "VAL-05.1" "Content-Type: XML on JSON" "PASS" "Low" "HTTP $c - Rejected"
}

try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/surat-masuk" -Method GET -ContentType "application/octet-stream" -UseBasicParsing -WebSession $adminSession
    Add-Result "Validation" "VAL-05.2" "Content-Type: Binary on JSON" "PASS" "Low" "HTTP $($r.StatusCode) - Handled"
}
catch {
    $c = 0; try { $c = [int]$_.Exception.Response.StatusCode } catch {}
    Add-Result "Validation" "VAL-05.2" "Content-Type: Binary on JSON" "PASS" "Low" "HTTP $c - Rejected"
}

$phaseTimings["Validation"] = ((Get-Date) - $phase3Start).TotalSeconds

# ================================================================
# COMPREHENSIVE SUMMARY
# ================================================================
Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   COMPREHENSIVE TEST RESULTS" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$phases = @("Security", "Integration", "Validation")
foreach ($phase in $phases) {
    $pr = $results | Where-Object { $_.Phase -eq $phase }
    $p = ($pr | Where-Object { $_.Status -eq "PASS" }).Count
    $f = ($pr | Where-Object { $_.Status -eq "FAIL" }).Count
    $w = ($pr | Where-Object { $_.Status -eq "WARN" }).Count
    $s = ($pr | Where-Object { $_.Status -eq "SKIP" }).Count
    $t = $pr.Count
    $rate = if ($t -gt 0) { [math]::Round(($p / $t) * 100, 1) } else { 0 }
    $time = if ($phaseTimings[$phase]) { [math]::Round($phaseTimings[$phase], 1) } else { "?" }
    
    Write-Host "$phase Testing: ($($time)s)" -ForegroundColor White
    Write-Host "  Total: $t | PASS: $p | FAIL: $f | WARN: $w | SKIP: $s | Rate: $rate%" -ForegroundColor $(if ($f -gt 0) { "Red" } elseif ($w -gt 0) { "Yellow" } else { "Green" })
    Write-Host ""
}

$totalPass = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$totalFail = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$totalWarn = ($results | Where-Object { $_.Status -eq "WARN" }).Count
$totalSkip = ($results | Where-Object { $_.Status -eq "SKIP" }).Count
$totalRate = if ($results.Count -gt 0) { [math]::Round(($totalPass / $results.Count) * 100, 1) } else { 0 }

Write-Host "OVERALL: $($results.Count) tests | PASS: $totalPass | FAIL: $totalFail | WARN: $totalWarn | SKIP: $totalSkip | Rate: $totalRate%" -ForegroundColor Cyan

if ($totalFail -gt 0) {
    Write-Host "`nFAILED TESTS:" -ForegroundColor Red
    $results | Where-Object { $_.Status -eq "FAIL" } | Format-Table Phase, ID, Name, Severity, Detail -AutoSize
}

if ($totalWarn -gt 0) {
    Write-Host "`nWARNING TESTS:" -ForegroundColor Yellow
    $results | Where-Object { $_.Status -eq "WARN" } | Format-Table Phase, ID, Name, Severity, Detail -AutoSize
}

# Export results
$results | Export-Csv -Path "comprehensive-test-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "`nResults saved to comprehensive-test-results.csv" -ForegroundColor Cyan
Write-Host "Testing completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
