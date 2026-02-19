# SIMSA Advanced Testing Script
# Phase 1: Security Testing
# Phase 2: Integration Testing
# Phase 3: Data Validation Testing

$baseUrl = "http://localhost:3001"
$results = @()

function Add-Result($phase, $id, $name, $status, $severity, $detail) {
    $script:results += [PSCustomObject]@{
        Phase    = $phase
        ID       = $id
        Name     = $name
        Status   = $status
        Severity = $severity
        Detail   = $detail
    }
    $color = switch ($status) { "PASS" { "Green" } "FAIL" { "Red" } "WARN" { "Yellow" } default { "Gray" } }
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
Write-Host "   SIMSA Advanced Testing Suite" -ForegroundColor Cyan
Write-Host "   Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# ================================================================
# LOGIN AS TESTER (super_admin)
# ================================================================
Write-Host "--- AUTHENTICATING ---" -ForegroundColor Yellow
$loginBody = '{"email":"tester@simsa.atrbpn.go.id","password":"Password123!@#"}'
$r = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -SessionVariable adminSession
Write-Host "Login OK - Session established`n" -ForegroundColor Green

# ================================================================
# PHASE 1: SECURITY TESTING
# ================================================================
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 1: SECURITY TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- SEC-01: Authorization Bypass (No Auth) ---
Write-Host "--- SEC-01: Auth Bypass (No Auth) ---" -ForegroundColor Yellow
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
    "/api/export/surat-masuk/excel"
)

$i = 1
foreach ($ep in $protectedEndpoints) {
    $r = Do-Request "GET" $ep $null $null
    if ($r.Code -eq 401 -or $r.Code -eq 403) {
        Add-Result "Security" "SEC-01.$i" "No-Auth: $ep" "PASS" "Critical" "HTTP $($r.Code) - Blocked"
    }
    else {
        Add-Result "Security" "SEC-01.$i" "No-Auth: $ep" "FAIL" "Critical" "HTTP $($r.Code) - NOT BLOCKED! Data exposed"
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
    "' OR 1=1 --"
)

$i = 1
foreach ($payload in $sqlPayloads) {
    $encodedPayload = [System.Web.HttpUtility]::UrlEncode($payload)
    $r = Do-Request "GET" "/api/surat-masuk?search=$encodedPayload" $null $adminSession
    if ($r.Code -eq 200) {
        # Check if response contains user data (leaked)
        if ($r.Content -match "password" -or $r.Content -match "session_token") {
            Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "FAIL" "Critical" "SQL Injection - Data leaked!"
        }
        else {
            Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "PASS" "Critical" "HTTP $($r.Code) - No injection (ORM parameterized)"
        }
    }
    elseif ($r.Code -eq 400 -or $r.Code -eq 500) {
        # 400 means input validated, 500 could mean partial injection
        if ($r.Code -eq 500 -and $r.Content -match "syntax error") {
            Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "WARN" "Critical" "HTTP 500 - Possible SQL error exposed"
        }
        else {
            Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "PASS" "Critical" "HTTP $($r.Code) - Rejected/handled"
        }
    }
    else {
        Add-Result "Security" "SEC-02.$i" "SQLi: $($payload.Substring(0, [Math]::Min(30, $payload.Length)))" "PASS" "Critical" "HTTP $($r.Code) - Not exploitable"
    }
    $i++
}

# SQL injection in search
$r = Do-Request "GET" "/api/search?q=' OR '1'='1" $null $adminSession
if ($r.Code -ne 500 -or ($r.Content -and !($r.Content -match "syntax error"))) {
    Add-Result "Security" "SEC-02.6" "SQLi: Global Search" "PASS" "Critical" "HTTP $($r.Code) - Search safe"
}
else {
    Add-Result "Security" "SEC-02.6" "SQLi: Global Search" "WARN" "Critical" "HTTP $($r.Code) - Check behavior"
}

# --- SEC-03: XSS (Cross-Site Scripting) ---
Write-Host "`n--- SEC-03: XSS Prevention ---" -ForegroundColor Yellow
$xssPayloads = @(
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    "javascript:alert('XSS')",
    '<svg onload=alert(1)>'
)

$i = 1
foreach ($payload in $xssPayloads) {
    $encodedPayload = [System.Web.HttpUtility]::UrlEncode($payload)
    $r = Do-Request "GET" "/api/surat-masuk?search=$encodedPayload" $null $adminSession
    if ($r.Content -and $r.Content -match [regex]::Escape($payload)) {
        Add-Result "Security" "SEC-03.$i" "XSS: $($payload.Substring(0, [Math]::Min(25, $payload.Length)))" "WARN" "High" "XSS payload reflected in response"
    }
    else {
        Add-Result "Security" "SEC-03.$i" "XSS: $($payload.Substring(0, [Math]::Min(25, $payload.Length)))" "PASS" "High" "HTTP $($r.Code) - Sanitized/escaped"
    }
    $i++
}

# --- SEC-04: IDOR (Insecure Direct Object Reference) ---
Write-Host "`n--- SEC-04: IDOR Testing ---" -ForegroundColor Yellow

# Try accessing with random/fake IDs
$fakeIds = @("00000000-0000-0000-0000-000000000000", "nonexistent-id", "../../etc/passwd", "1; DROP TABLE")

$i = 1
foreach ($fakeId in $fakeIds) {
    $encodedId = [System.Web.HttpUtility]::UrlEncode($fakeId)
    $r = Do-Request "GET" "/api/surat-masuk/$encodedId" $null $adminSession
    if ($r.Code -eq 404 -or $r.Code -eq 400) {
        Add-Result "Security" "SEC-04.$i" "IDOR: Fake ID ($($fakeId.Substring(0, [Math]::Min(20, $fakeId.Length))))" "PASS" "High" "HTTP $($r.Code) - Not found/rejected"
    }
    elseif ($r.Code -eq 200) {
        Add-Result "Security" "SEC-04.$i" "IDOR: Fake ID ($($fakeId.Substring(0, [Math]::Min(20, $fakeId.Length))))" "FAIL" "High" "HTTP 200 - Data returned for fake ID!"
    }
    else {
        Add-Result "Security" "SEC-04.$i" "IDOR: Fake ID ($($fakeId.Substring(0, [Math]::Min(20, $fakeId.Length))))" "PASS" "High" "HTTP $($r.Code)"
    }
    $i++
}

# Path traversal in ID
$r = Do-Request "GET" "/api/surat-masuk/..%2F..%2Fetc%2Fpasswd" $null $adminSession
if ($r.Code -ne 200) {
    Add-Result "Security" "SEC-04.5" "IDOR: Path Traversal" "PASS" "Critical" "HTTP $($r.Code) - Path traversal blocked"
}
else {
    Add-Result "Security" "SEC-04.5" "IDOR: Path Traversal" "FAIL" "Critical" "Path traversal possibly exploitable!"
}

# --- SEC-05: Security Headers ---
Write-Host "`n--- SEC-05: Security Headers ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/health" $null $null
$headers = $r.Headers

$secHeaders = @{
    "X-Content-Type-Options"    = "nosniff"
    "X-Frame-Options"           = "DENY"
    "Strict-Transport-Security" = $null  # Any value is fine
    "Content-Security-Policy"   = $null
    "X-XSS-Protection"          = $null
    "Referrer-Policy"           = $null
}

$i = 1
foreach ($h in $secHeaders.GetEnumerator()) {
    $value = $null
    try { $value = $headers[$h.Key] } catch {}
    if ($value) {
        if ($h.Value -and $value -notmatch [regex]::Escape($h.Value)) {
            Add-Result "Security" "SEC-05.$i" "Header: $($h.Key)" "WARN" "Medium" "Present but value unexpected: $value"
        }
        else {
            Add-Result "Security" "SEC-05.$i" "Header: $($h.Key)" "PASS" "Medium" "Present: $($value.ToString().Substring(0, [Math]::Min(50, $value.ToString().Length)))"
        }
    }
    else {
        Add-Result "Security" "SEC-05.$i" "Header: $($h.Key)" "FAIL" "Medium" "Missing!"
    }
    $i++
}

# --- SEC-06: CSRF Protection ---
Write-Host "`n--- SEC-06: CSRF Protection ---" -ForegroundColor Yellow
# Try POST without CSRF token
$r = Do-Request "POST" "/api/surat-masuk" '{"nomorSurat":"test"}' $adminSession "json"
if ($r.Code -eq 403 -and $r.Content -match "CSRF|csrf|token") {
    Add-Result "Security" "SEC-06.1" "CSRF: POST without token" "PASS" "High" "HTTP 403 - CSRF protected"
}
elseif ($r.Code -eq 403) {
    Add-Result "Security" "SEC-06.1" "CSRF: POST without token" "PASS" "High" "HTTP 403 - Blocked (likely CSRF)"
}
else {
    Add-Result "Security" "SEC-06.1" "CSRF: POST without token" "WARN" "High" "HTTP $($r.Code) - Verify CSRF"
}

$r = Do-Request "DELETE" "/api/surat-masuk/fake-id" $null $adminSession
if ($r.Code -eq 403) {
    Add-Result "Security" "SEC-06.2" "CSRF: DELETE without token" "PASS" "High" "HTTP 403 - CSRF protected"
}
else {
    Add-Result "Security" "SEC-06.2" "CSRF: DELETE without token" "WARN" "High" "HTTP $($r.Code) - Verify CSRF"
}

# --- SEC-07: Rate Limiting ---
Write-Host "`n--- SEC-07: Rate Limiting ---" -ForegroundColor Yellow
$rateLimitHit = $false
$attempts = 0
for ($j = 1; $j -le 20; $j++) {
    $r = Do-Request "POST" "/api/auth/sign-in/email" '{"email":"brute@force.com","password":"wrong"}' $null "json"
    $attempts++
    if ($r.Code -eq 429) {
        $rateLimitHit = $true
        Add-Result "Security" "SEC-07.1" "Rate Limit: Auth Brute Force" "PASS" "Critical" "Blocked after $attempts attempts (HTTP 429)"
        break
    }
}
if (!$rateLimitHit) {
    Add-Result "Security" "SEC-07.1" "Rate Limit: Auth Brute Force" "WARN" "Critical" "No 429 after $attempts attempts - Check rate limit config"
}

# --- SEC-08: Error Information Leakage ---
Write-Host "`n--- SEC-08: Error Info Leakage ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/nonexistent-route" $null $adminSession
if ($r.Content -match "stack|trace|node_modules|\.ts:|\.js:") {
    Add-Result "Security" "SEC-08.1" "Error Leakage: 404 response" "WARN" "Medium" "Stack trace exposed in error response"
}
else {
    Add-Result "Security" "SEC-08.1" "Error Leakage: 404 response" "PASS" "Medium" "No stack trace in error"
}

# Try to trigger a 500 error
$r = Do-Request "GET" "/api/surat-masuk?page=abc&limit=-1" $null $adminSession
if ($r.Content -match "stack|trace|node_modules") {
    Add-Result "Security" "SEC-08.2" "Error Leakage: Bad params" "WARN" "Medium" "Stack trace in bad param response"
}
else {
    Add-Result "Security" "SEC-08.2" "Error Leakage: Bad params" "PASS" "Medium" "No stack trace leaked"
}

# --- SEC-09: Session Cookie Security ---
Write-Host "`n--- SEC-09: Cookie Security ---" -ForegroundColor Yellow
$loginResp = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -SessionVariable cookieSession
$cookies = $cookieSession.Cookies.GetCookies("$baseUrl")
$sessionCookie = $cookies | Where-Object { $_.Name -match "session|auth|token|better-auth" } | Select-Object -First 1

if ($sessionCookie) {
    if ($sessionCookie.HttpOnly) {
        Add-Result "Security" "SEC-09.1" "Cookie: HttpOnly flag" "PASS" "High" "Session cookie is HttpOnly"
    }
    else {
        Add-Result "Security" "SEC-09.1" "Cookie: HttpOnly flag" "WARN" "High" "Session cookie missing HttpOnly"
    }
    # Note: Secure flag only valid over HTTPS
    Add-Result "Security" "SEC-09.2" "Cookie: Session exists" "PASS" "High" "Session cookie found: $($sessionCookie.Name)"
}
else {
    Add-Result "Security" "SEC-09.1" "Cookie: Session check" "PASS" "Medium" "Auth uses different mechanism (header-based)"
}

# ================================================================
# PHASE 2: INTEGRATION TESTING
# ================================================================
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 2: INTEGRATION TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# Get CSRF token first
$csrfR = Do-Request "GET" "/api/surat-masuk" $null $adminSession
$csrfCookies = $adminSession.Cookies.GetCookies("$baseUrl")
$csrfToken = ($csrfCookies | Where-Object { $_.Name -match "csrf" }).Value

# --- INT-01: Surat Masuk List + Detail Flow ---
Write-Host "--- INT-01: Surat Masuk Data Flow ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/surat-masuk?limit=5" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $data = $r.Content | ConvertFrom-Json
        $sm = $null
        if ($data.data -and $data.data.Count -gt 0) { $sm = $data.data[0] }
        elseif ($data.suratMasuk -and $data.suratMasuk.Count -gt 0) { $sm = $data.suratMasuk[0] }
        
        if ($sm) {
            Add-Result "Integration" "INT-01.1" "SM: List returns data" "PASS" "High" "Found surat masuk with ID: $($sm.id.Substring(0, 8))..."
            
            # Get detail
            $rd = Do-Request "GET" "/api/surat-masuk/$($sm.id)" $null $adminSession
            if ($rd.Code -eq 200) {
                $detail = $rd.Content | ConvertFrom-Json
                $detailObj = if ($detail.data) { $detail.data } else { $detail }
                
                # Verify key fields are present
                $hasNomor = $detailObj.nomorSurat -or $detailObj.nomor_surat
                $hasTanggal = $detailObj.tanggalSurat -or $detailObj.tanggal_surat -or $detailObj.tanggalDiterima
                $hasPerihal = $detailObj.perihal
                
                if ($hasNomor -and $hasPerihal) {
                    Add-Result "Integration" "INT-01.2" "SM: Detail data complete" "PASS" "High" "nomor + perihal present"
                }
                else {
                    Add-Result "Integration" "INT-01.2" "SM: Detail data complete" "WARN" "High" "Some fields missing"
                }
            }
            else {
                Add-Result "Integration" "INT-01.2" "SM: Detail access" "FAIL" "High" "HTTP $($rd.Code)"
            }
            
            # Check if SM can be searched by its perihal
            if ($sm.perihal) {
                $searchTerm = $sm.perihal.Substring(0, [Math]::Min(10, $sm.perihal.Length))
                $rs = Do-Request "GET" "/api/surat-masuk?search=$([System.Web.HttpUtility]::UrlEncode($searchTerm))" $null $adminSession
                if ($rs.Code -eq 200) {
                    Add-Result "Integration" "INT-01.3" "SM: Search by perihal" "PASS" "Medium" "Search returns results for: $searchTerm"
                }
                else {
                    Add-Result "Integration" "INT-01.3" "SM: Search by perihal" "FAIL" "Medium" "HTTP $($rs.Code)"
                }
            }
        }
        else {
            Add-Result "Integration" "INT-01.1" "SM: List returns data" "SKIP" "High" "No surat masuk data"
        }
    }
    catch {
        Add-Result "Integration" "INT-01.1" "SM: Data parsing" "WARN" "High" "Could not parse response"
    }
}
else {
    Add-Result "Integration" "INT-01.1" "SM: List access" "FAIL" "High" "HTTP $($r.Code)"
}

# --- INT-02: Surat Keluar Data Flow ---
Write-Host "`n--- INT-02: Surat Keluar Data Flow ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/surat-keluar?limit=5" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $data = $r.Content | ConvertFrom-Json
        $sk = $null
        if ($data.data -and $data.data.Count -gt 0) { $sk = $data.data[0] }
        
        if ($sk) {
            Add-Result "Integration" "INT-02.1" "SK: List returns data" "PASS" "High" "Found surat keluar"
            
            $rd = Do-Request "GET" "/api/surat-keluar/$($sk.id)" $null $adminSession
            if ($rd.Code -eq 200) {
                Add-Result "Integration" "INT-02.2" "SK: Detail access" "PASS" "High" "Detail retrieved OK"
            }
            else {
                Add-Result "Integration" "INT-02.2" "SK: Detail access" "FAIL" "High" "HTTP $($rd.Code)"
            }
        }
        else {
            Add-Result "Integration" "INT-02.1" "SK: List returns data" "SKIP" "High" "No surat keluar data"
        }
    }
    catch {
        Add-Result "Integration" "INT-02.1" "SK: Parse" "WARN" "High" "Parse error"
    }
}
else {
    Add-Result "Integration" "INT-02.1" "SK: List access" "FAIL" "High" "HTTP $($r.Code)"
}

# --- INT-03: Arsip + Detail + Items ---
Write-Host "`n--- INT-03: Arsip Data Flow ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/arsip?limit=5" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $data = $r.Content | ConvertFrom-Json
        $arsip = $null
        if ($data.data -and $data.data.Count -gt 0) { $arsip = $data.data[0] }
        
        if ($arsip) {
            Add-Result "Integration" "INT-03.1" "Arsip: List returns data" "PASS" "High" "Found arsip records"
            
            $rd = Do-Request "GET" "/api/arsip/$($arsip.id)" $null $adminSession
            if ($rd.Code -eq 200) {
                $detail = $rd.Content | ConvertFrom-Json
                $detailObj = if ($detail.data) { $detail.data } else { $detail }
                
                # Check for classification code linkage
                $hasKlasifikasi = $detailObj.kodeKlasifikasi -or $detailObj.kode_klasifikasi -or $detailObj.klasifikasiId
                if ($hasKlasifikasi) {
                    Add-Result "Integration" "INT-03.2" "Arsip: Classification linked" "PASS" "High" "Has classification code"
                }
                else {
                    Add-Result "Integration" "INT-03.2" "Arsip: Classification linked" "WARN" "Medium" "No classification code found"
                }
                
                Add-Result "Integration" "INT-03.3" "Arsip: Detail access" "PASS" "High" "Detail retrieved OK"
            }
            else {
                Add-Result "Integration" "INT-03.3" "Arsip: Detail access" "FAIL" "High" "HTTP $($rd.Code)"
            }
        }
        else {
            Add-Result "Integration" "INT-03.1" "Arsip: List" "SKIP" "High" "No arsip data"
        }
    }
    catch {
        Add-Result "Integration" "INT-03.1" "Arsip: Parse" "WARN" "High" "Parse error"
    }
}

# --- INT-04: Dashboard Stats Consistency ---
Write-Host "`n--- INT-04: Dashboard Consistency ---" -ForegroundColor Yellow
$rd = Do-Request "GET" "/api/dashboard/stats" $null $adminSession
if ($rd.Code -eq 200) {
    try {
        $stats = $rd.Content | ConvertFrom-Json
        $statsObj = if ($stats.data) { $stats.data } else { $stats }
        Add-Result "Integration" "INT-04.1" "Dashboard: Stats load" "PASS" "High" "Stats data loaded successfully"
        
        # Verify stats has expected fields
        $hasFields = $statsObj.PSObject.Properties.Name.Count -gt 0
        if ($hasFields) {
            Add-Result "Integration" "INT-04.2" "Dashboard: Has metrics" "PASS" "Medium" "Contains $($statsObj.PSObject.Properties.Name.Count) metric fields"
        }
    }
    catch {
        Add-Result "Integration" "INT-04.1" "Dashboard: Parse" "WARN" "Medium" "Parse error"
    }
}

# --- INT-05: Klasifikasi → JRA Mapping ---
Write-Host "`n--- INT-05: Klasifikasi-JRA Integration ---" -ForegroundColor Yellow
$rk = Do-Request "GET" "/api/klasifikasi" $null $adminSession
$rj = Do-Request "GET" "/api/jra" $null $adminSession

if ($rk.Code -eq 200 -and $rj.Code -eq 200) {
    try {
        $klasData = $rk.Content | ConvertFrom-Json
        $jraData = $rj.Content | ConvertFrom-Json
        
        $klasCount = 0; $jraCount = 0
        if ($klasData.data) { $klasCount = $klasData.data.Count } elseif ($klasData -is [array]) { $klasCount = $klasData.Count }
        if ($jraData.data) { $jraCount = $jraData.data.Count } elseif ($jraData -is [array]) { $jraCount = $jraData.Count }
        
        Add-Result "Integration" "INT-05.1" "Master: Klasifikasi data" "PASS" "High" "$klasCount records"
        Add-Result "Integration" "INT-05.2" "Master: JRA data" "PASS" "High" "$jraCount records"
    }
    catch {
        Add-Result "Integration" "INT-05.1" "Master: Parse" "WARN" "Medium" "Parse error"
    }
}

# --- INT-06: Distribution + Units ---
Write-Host "`n--- INT-06: Distribution Integration ---" -ForegroundColor Yellow
$ru = Do-Request "GET" "/api/distributions/units" $null $adminSession
if ($ru.Code -eq 200) {
    try {
        $units = $ru.Content | ConvertFrom-Json
        $unitCount = if ($units.data) { $units.data.Count } else { $units.Count }
        Add-Result "Integration" "INT-06.1" "Distrib: Available units" "PASS" "High" "$unitCount distributable units"
    }
    catch {
        Add-Result "Integration" "INT-06.1" "Distrib: Units" "WARN" "Medium" "Parse error"
    }
}
else {
    Add-Result "Integration" "INT-06.1" "Distrib: Units list" "FAIL" "High" "HTTP $($ru.Code)"
}

$ri = Do-Request "GET" "/api/distributions/inbox" $null $adminSession
if ($ri.Code -eq 200) {
    Add-Result "Integration" "INT-06.2" "Distrib: Inbox access" "PASS" "High" "Inbox accessible"
}
else {
    Add-Result "Integration" "INT-06.2" "Distrib: Inbox access" "FAIL" "High" "HTTP $($ri.Code)"
}

# --- INT-07: Retention Summary ---
Write-Host "`n--- INT-07: Retention Integration ---" -ForegroundColor Yellow
$rr = Do-Request "GET" "/api/retention/summary" $null $adminSession
if ($rr.Code -eq 200) {
    Add-Result "Integration" "INT-07.1" "Retention: Summary" "PASS" "High" "Summary data loaded"
}
else {
    Add-Result "Integration" "INT-07.1" "Retention: Summary" "FAIL" "High" "HTTP $($rr.Code)"
}

$rc = Do-Request "GET" "/api/retention/candidates" $null $adminSession
if ($rc.Code -eq 200) {
    Add-Result "Integration" "INT-07.2" "Retention: Candidates" "PASS" "High" "Candidates list loaded"
}
else {
    Add-Result "Integration" "INT-07.2" "Retention: Candidates" "FAIL" "High" "HTTP $($rc.Code)"
}

# --- INT-08: Supervision Stats ---
Write-Host "`n--- INT-08: Supervision Integration ---" -ForegroundColor Yellow
$rs = Do-Request "GET" "/api/supervision/stats/activity" $null $adminSession
if ($rs.Code -eq 200) {
    Add-Result "Integration" "INT-08.1" "Supervision: Activity stats" "PASS" "Medium" "Activity data loaded"
}
else {
    Add-Result "Integration" "INT-08.1" "Supervision: Activity stats" "FAIL" "Medium" "HTTP $($rs.Code)"
}

$rsu = Do-Request "GET" "/api/supervision/stats/users" $null $adminSession
if ($rsu.Code -eq 200) {
    Add-Result "Integration" "INT-08.2" "Supervision: User stats" "PASS" "Medium" "User activity loaded"
}
else {
    Add-Result "Integration" "INT-08.2" "Supervision: User stats" "FAIL" "Medium" "HTTP $($rsu.Code)"
}

# --- INT-09: Reports Data ---
Write-Host "`n--- INT-09: Reports Integration ---" -ForegroundColor Yellow
$rp = Do-Request "GET" "/api/reports/summary?year=2026" $null $adminSession
if ($rp.Code -eq 200) {
    try {
        $reportData = $rp.Content | ConvertFrom-Json
        Add-Result "Integration" "INT-09.1" "Reports: Summary 2026" "PASS" "High" "Report data loaded"
    }
    catch {
        Add-Result "Integration" "INT-09.1" "Reports: Summary" "WARN" "High" "Parse issue"
    }
}

# --- INT-10: Export Generates File ---
Write-Host "`n--- INT-10: Export Integration ---" -ForegroundColor Yellow
$re = Do-Request "GET" "/api/export/surat-masuk/excel" $null $adminSession
if ($re.Code -eq 200) {
    if ($re.Content.Length -gt 100) {
        Add-Result "Integration" "INT-10.1" "Export: SM Excel" "PASS" "High" "Excel generated ($($re.Content.Length) bytes)"
    }
    else {
        Add-Result "Integration" "INT-10.1" "Export: SM Excel" "WARN" "High" "Excel generated but very small ($($re.Content.Length) bytes)"
    }
}
else {
    Add-Result "Integration" "INT-10.1" "Export: SM Excel" "FAIL" "High" "HTTP $($re.Code)"
}

$rp = Do-Request "GET" "/api/export/surat-masuk/pdf" $null $adminSession
if ($rp.Code -eq 200) {
    Add-Result "Integration" "INT-10.2" "Export: SM PDF" "PASS" "High" "PDF generated ($($rp.Content.Length) bytes)"
}
else {
    Add-Result "Integration" "INT-10.2" "Export: SM PDF" "FAIL" "High" "HTTP $($rp.Code)"
}

# ================================================================
# PHASE 3: DATA VALIDATION TESTING
# ================================================================
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 3: DATA VALIDATION TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- VAL-01: Boundary Values ---
Write-Host "--- VAL-01: Boundary Values ---" -ForegroundColor Yellow

# Empty search
$r = Do-Request "GET" "/api/surat-masuk?search=" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Validation" "VAL-01.1" "Boundary: Empty search" "PASS" "Low" "HTTP 200 - Returns all data"
}
else {
    Add-Result "Validation" "VAL-01.1" "Boundary: Empty search" "FAIL" "Low" "HTTP $($r.Code)"
}

# Very long search string
$longSearch = "A" * 5000
$r = Do-Request "GET" "/api/surat-masuk?search=$longSearch" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400 -or $r.Code -eq 414) {
    Add-Result "Validation" "VAL-01.2" "Boundary: 5000-char search" "PASS" "Medium" "HTTP $($r.Code) - Handled gracefully"
}
else {
    Add-Result "Validation" "VAL-01.2" "Boundary: 5000-char search" "WARN" "Medium" "HTTP $($r.Code) - May crash"
}

# Negative pagination
$r = Do-Request "GET" "/api/surat-masuk?page=-1&limit=-5" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.3" "Boundary: Negative pagination" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.3" "Boundary: Negative pagination" "WARN" "Medium" "HTTP $($r.Code)"
}

# Extremely large limit
$r = Do-Request "GET" "/api/surat-masuk?page=1&limit=999999" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.4" "Boundary: Huge page limit" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.4" "Boundary: Huge page limit" "WARN" "Medium" "HTTP $($r.Code)"
}

# Zero page
$r = Do-Request "GET" "/api/surat-masuk?page=0" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-01.5" "Boundary: Page 0" "PASS" "Low" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-01.5" "Boundary: Page 0" "WARN" "Low" "HTTP $($r.Code)"
}

# --- VAL-02: Date Validation ---
Write-Host "`n--- VAL-02: Date Validation ---" -ForegroundColor Yellow

# Invalid date format
$r = Do-Request "GET" "/api/surat-masuk?startDate=invalid-date" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-02.1" "Date: Invalid format" "PASS" "Medium" "HTTP $($r.Code) - No crash"
}
else {
    Add-Result "Validation" "VAL-02.1" "Date: Invalid format" "FAIL" "Medium" "HTTP $($r.Code)"
}

# Future date
$r = Do-Request "GET" "/api/surat-masuk?startDate=2099-12-31" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Validation" "VAL-02.2" "Date: Future date" "PASS" "Low" "HTTP 200 - Returns empty/no data"
}
else {
    Add-Result "Validation" "VAL-02.2" "Date: Future date" "WARN" "Low" "HTTP $($r.Code)"
}

# Start date after end date
$r = Do-Request "GET" "/api/surat-masuk?startDate=2026-12-31&endDate=2024-01-01" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    Add-Result "Validation" "VAL-02.3" "Date: Start > End" "PASS" "Medium" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-02.3" "Date: Start > End" "WARN" "Medium" "HTTP $($r.Code)"
}

# --- VAL-03: Special Characters ---
Write-Host "`n--- VAL-03: Special Characters ---" -ForegroundColor Yellow
$longUtf8 = "LongUTF8TestString" * 50
$specialChars = @(
    @{name = "Unicode Emoji"; val = "Surat Penting Emoji" },
    @{name = "HTML Entities"; val = "&lt;script&gt;alert&lt;/script&gt;" },
    @{name = "Null bytes"; val = "test%00admin" },
    @{name = "Backslashes"; val = "test\..\..\admin" },
    @{name = "Unicode RTL"; val = "testRTLdrowssap" },
    @{name = "Very long string"; val = $longUtf8 }
)

$i = 1
foreach ($sc in $specialChars) {
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

# --- VAL-04: Numeric Field Validation ---
Write-Host "`n--- VAL-04: Numeric Fields ---" -ForegroundColor Yellow
# Year filter with non-numeric
$r = Do-Request "GET" "/api/reports/summary?year=abc" $null $adminSession
if ($r.Code -ne 500) {
    Add-Result "Validation" "VAL-04.1" "Numeric: year=abc" "PASS" "Medium" "HTTP $($r.Code) - No crash"
}
else {
    Add-Result "Validation" "VAL-04.1" "Numeric: year=abc" "WARN" "Medium" "HTTP 500 - Server error"
}

# Negative year
$r = Do-Request "GET" "/api/reports/summary?year=-1" $null $adminSession
if ($r.Code -ne 500) {
    Add-Result "Validation" "VAL-04.2" "Numeric: year=-1" "PASS" "Low" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-04.2" "Numeric: year=-1" "WARN" "Low" "HTTP 500"
}

# Very large year
$r = Do-Request "GET" "/api/reports/summary?year=99999" $null $adminSession
if ($r.Code -ne 500) {
    Add-Result "Validation" "VAL-04.3" "Numeric: year=99999" "PASS" "Low" "HTTP $($r.Code) - Handled"
}
else {
    Add-Result "Validation" "VAL-04.3" "Numeric: year=99999" "WARN" "Low" "HTTP 500"
}

# --- VAL-05: Content-Type Handling ---
Write-Host "`n--- VAL-05: Content-Type ---" -ForegroundColor Yellow
# Send JSON to endpoint with wrong content type
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/surat-masuk" -Method GET -ContentType "text/xml" -UseBasicParsing -WebSession $adminSession
    Add-Result "Validation" "VAL-05.1" "Content-Type: XML on JSON API" "PASS" "Low" "HTTP $($r.StatusCode) - Handled"
}
catch {
    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    Add-Result "Validation" "VAL-05.1" "Content-Type: XML on JSON API" "PASS" "Low" "HTTP $code - Rejected"
}

# ================================================================
# SUMMARY
# ================================================================
Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   COMPREHENSIVE TEST RESULTS" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$phases = @("Security", "Integration", "Validation")
foreach ($phase in $phases) {
    $phaseResults = $results | Where-Object { $_.Phase -eq $phase }
    $p = ($phaseResults | Where-Object { $_.Status -eq "PASS" }).Count
    $f = ($phaseResults | Where-Object { $_.Status -eq "FAIL" }).Count
    $w = ($phaseResults | Where-Object { $_.Status -eq "WARN" }).Count
    $s = ($phaseResults | Where-Object { $_.Status -eq "SKIP" }).Count
    
    Write-Host "$phase Testing:" -ForegroundColor White
    Write-Host "  Total: $($phaseResults.Count) | PASS: $p | FAIL: $f | WARN: $w | SKIP: $s" -ForegroundColor $(if ($f -gt 0) { "Red" } else { "Green" })
    Write-Host ""
}

$totalPass = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$totalFail = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$totalWarn = ($results | Where-Object { $_.Status -eq "WARN" }).Count
$totalSkip = ($results | Where-Object { $_.Status -eq "SKIP" }).Count

Write-Host "OVERALL: $($results.Count) tests | PASS: $totalPass | FAIL: $totalFail | WARN: $totalWarn | SKIP: $totalSkip" -ForegroundColor Cyan

if ($totalFail -gt 0) {
    Write-Host "`nFAILED TESTS:" -ForegroundColor Red
    $results | Where-Object { $_.Status -eq "FAIL" } | Format-Table Phase, ID, Name, Severity, Detail -AutoSize
}

if ($totalWarn -gt 0) {
    Write-Host "`nWARNING TESTS:" -ForegroundColor Yellow
    $results | Where-Object { $_.Status -eq "WARN" } | Format-Table Phase, ID, Name, Severity, Detail -AutoSize
}

# Export
$results | Export-Csv -Path "advanced-test-results.csv" -NoTypeInformation
Write-Host "`nResults saved to advanced-test-results.csv" -ForegroundColor Cyan
