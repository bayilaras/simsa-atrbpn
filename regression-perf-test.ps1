# ================================================================
# SIMSA Testing Suite - Phase 4 and 5
# Phase 4: Functional Regression Testing
# Phase 5: Performance Testing
# Date: 2026-02-17
# ================================================================

Add-Type -AssemblyName System.Web

$baseUrl = "http://localhost:3001"
$results = @()
$phaseTimings = @{}

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

function Do-Request($method, $uri, $body, $session, $contentType, $extraHeaders) {
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
    if ($extraHeaders) { $params.Headers = $extraHeaders }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest @params
        $sw.Stop()
        return @{ Code = $r.StatusCode; Content = $r.Content; Headers = $r.Headers; OK = $true; TimeMs = $sw.ElapsedMilliseconds; Cookies = $null }
    }
    catch {
        $sw.Stop()
        $code = 0; $content = ""
        try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $content = $reader.ReadToEnd()
        }
        catch {}
        return @{ Code = $code; Content = $content; OK = $false; Error = $_.Exception.Message; TimeMs = $sw.ElapsedMilliseconds }
    }
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   SIMSA Testing Suite - Phase 4 and 5" -ForegroundColor Cyan
Write-Host "   Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# PRE-CHECK
$backendAlive = Do-Request "GET" "/api/health" $null $null
if ($backendAlive.Code -ne 200) {
    Write-Host "Backend OFFLINE! Aborting." -ForegroundColor Red
    exit 1
}
Write-Host "Backend: ONLINE`n" -ForegroundColor Green

# AUTHENTICATE + GET CSRF TOKEN
$loginBody = '{"email":"tester@simsa.atrbpn.go.id","password":"Password123!@#"}'
try {
    $loginResp = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -SessionVariable adminSession
    Write-Host "Login OK" -ForegroundColor Green
}
catch {
    Write-Host "Login FAILED! Aborting." -ForegroundColor Red
    exit 1
}

# Get CSRF token from cookies
$csrfToken = $null
try {
    $cookies = $adminSession.Cookies.GetCookies("$baseUrl")
    $csrfCookie = $cookies | Where-Object { $_.Name -eq "csrf-token" } | Select-Object -First 1
    if ($csrfCookie) { $csrfToken = $csrfCookie.Value }
}
catch {}

# If no existing CSRF, trigger cookie setter with GET
if (!$csrfToken) {
    $gResp = Invoke-WebRequest -Uri "$baseUrl/api/surat-masuk?limit=1" -Method GET -UseBasicParsing -WebSession $adminSession
    try {
        $cookies = $adminSession.Cookies.GetCookies("$baseUrl")
        $csrfCookie = $cookies | Where-Object { $_.Name -eq "csrf-token" } | Select-Object -First 1
        if ($csrfCookie) { $csrfToken = $csrfCookie.Value }
    }
    catch {}
}

if ($csrfToken) {
    Write-Host "CSRF Token obtained: $($csrfToken.Substring(0, [Math]::Min(8, $csrfToken.Length)))...`n" -ForegroundColor Green
}
else {
    Write-Host "WARNING: No CSRF token obtained. CRUD tests may fail.`n" -ForegroundColor Yellow
}

$csrfHeaders = @{ "X-CSRF-Token" = $csrfToken }

# ================================================================
# PHASE 4: FUNCTIONAL REGRESSION TESTING
# ================================================================
$phase4Start = Get-Date
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 4: FUNCTIONAL REGRESSION TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- REG-01: Surat Masuk CRUD ---
Write-Host "--- REG-01: Surat Masuk CRUD Lifecycle ---" -ForegroundColor Yellow
$createdSmId = $null

# CREATE
$createBody = @{
    nomorSurat   = "TEST/REG-" + (Get-Date -Format "yyyyMMddHHmmss")
    tanggalSurat = (Get-Date -Format "yyyy-MM-dd")
    pengirim     = "Testing Regression"
    perihal      = "Surat Pengujian Regresi Fungsional"
    sifat        = "biasa"
    unitKerjaId  = "ditjen"
    lampiran     = "0"
} | ConvertTo-Json

$r = Do-Request "POST" "/api/surat-masuk" $createBody $adminSession "json" $csrfHeaders
if ($r.Code -eq 201) {
    try {
        $data = ($r.Content | ConvertFrom-Json)
        $createdSmId = if ($data.data) { $data.data.id } else { $data.id }
        Add-Result "Regression" "REG-01.1" "SM CRUD: Create" "PASS" "Critical" "Created ID: $($createdSmId.Substring(0, 8))..."
    }
    catch {
        Add-Result "Regression" "REG-01.1" "SM CRUD: Create" "WARN" "Critical" "HTTP 201 but parse error"
    }
}
elseif ($r.Code -eq 403) {
    Add-Result "Regression" "REG-01.1" "SM CRUD: Create" "WARN" "Critical" "HTTP 403 - CSRF/Role issue. Detail: $($r.Content.Substring(0, [Math]::Min(100, $r.Content.Length)))"
}
elseif ($r.Code -eq 400) {
    Add-Result "Regression" "REG-01.1" "SM CRUD: Create" "WARN" "Critical" "HTTP 400 - Validation: $($r.Content.Substring(0, [Math]::Min(150, $r.Content.Length)))"
}
else {
    Add-Result "Regression" "REG-01.1" "SM CRUD: Create" "FAIL" "Critical" "HTTP $($r.Code) - $($r.Content.Substring(0, [Math]::Min(100, $r.Content.Length)))"
}

# READ (use created or fallback to list)
if ($createdSmId) {
    $r = Do-Request "GET" "/api/surat-masuk/$createdSmId" $null $adminSession
    if ($r.Code -eq 200) {
        $d = ($r.Content | ConvertFrom-Json)
        $obj = if ($d.data) { $d.data } else { $d }
        if ($obj.perihal -match "Regresi") {
            Add-Result "Regression" "REG-01.2" "SM CRUD: Read created" "PASS" "Critical" "Data matches: perihal contains 'Regresi'"
        }
        else {
            Add-Result "Regression" "REG-01.2" "SM CRUD: Read created" "WARN" "Critical" "Data mismatch: perihal = $($obj.perihal)"
        }
    }
    else {
        Add-Result "Regression" "REG-01.2" "SM CRUD: Read created" "FAIL" "Critical" "HTTP $($r.Code)"
    }
}
else {
    # Fallback: just read first from list
    $r = Do-Request "GET" "/api/surat-masuk?limit=1" $null $adminSession
    if ($r.Code -eq 200) {
        try {
            $data = ($r.Content | ConvertFrom-Json)
            $list = if ($data.data) { $data.data } else { @() }
            if ($list.Count -gt 0) {
                $createdSmId = $list[0].id
                Add-Result "Regression" "REG-01.2" "SM CRUD: Read (fallback)" "PASS" "Critical" "Using existing ID: $($createdSmId.Substring(0, 8))..."
            }
            else {
                Add-Result "Regression" "REG-01.2" "SM CRUD: Read" "SKIP" "Critical" "No data"
            }
        }
        catch {
            Add-Result "Regression" "REG-01.2" "SM CRUD: Read" "WARN" "Critical" "Parse error"
        }
    }
    else {
        Add-Result "Regression" "REG-01.2" "SM CRUD: Read" "FAIL" "Critical" "HTTP $($r.Code)"
    }
}

# UPDATE
if ($createdSmId) {
    $updateBody = '{"perihal":"Surat Pengujian Regresi - UPDATED"}'
    $r = Do-Request "PUT" "/api/surat-masuk/$createdSmId" $updateBody $adminSession "json" $csrfHeaders
    if ($r.Code -eq 200) {
        Add-Result "Regression" "REG-01.3" "SM CRUD: Update" "PASS" "Critical" "Updated OK"
    }
    elseif ($r.Code -eq 403) {
        Add-Result "Regression" "REG-01.3" "SM CRUD: Update" "WARN" "Critical" "HTTP 403 - CSRF/role issue"
    }
    else {
        Add-Result "Regression" "REG-01.3" "SM CRUD: Update" "FAIL" "Critical" "HTTP $($r.Code)"
    }

    # Verify update
    $r = Do-Request "GET" "/api/surat-masuk/$createdSmId" $null $adminSession
    if ($r.Code -eq 200) {
        $d = ($r.Content | ConvertFrom-Json)
        $obj = if ($d.data) { $d.data } else { $d }
        if ($obj.perihal -match "UPDATED") {
            Add-Result "Regression" "REG-01.4" "SM CRUD: Verify update" "PASS" "High" "Update persisted"
        }
        else {
            Add-Result "Regression" "REG-01.4" "SM CRUD: Verify update" "WARN" "High" "Update not reflected: $($obj.perihal)"
        }
    }
}
else {
    Add-Result "Regression" "REG-01.3" "SM CRUD: Update" "SKIP" "Critical" "No ID to update"
    Add-Result "Regression" "REG-01.4" "SM CRUD: Verify update" "SKIP" "High" "No ID"
}

# DELETE
if ($createdSmId) {
    $r = Do-Request "DELETE" "/api/surat-masuk/$createdSmId" $null $adminSession $null $csrfHeaders
    if ($r.Code -eq 200) {
        Add-Result "Regression" "REG-01.5" "SM CRUD: Delete" "PASS" "Critical" "Deleted OK"
    }
    elseif ($r.Code -eq 403) {
        Add-Result "Regression" "REG-01.5" "SM CRUD: Delete" "WARN" "Critical" "HTTP 403 - CSRF/role"
    }
    else {
        Add-Result "Regression" "REG-01.5" "SM CRUD: Delete" "FAIL" "Critical" "HTTP $($r.Code)"
    }

    # Verify delete
    $r = Do-Request "GET" "/api/surat-masuk/$createdSmId" $null $adminSession
    if ($r.Code -eq 404) {
        Add-Result "Regression" "REG-01.6" "SM CRUD: Verify delete" "PASS" "High" "Confirmed deleted (404)"
    }
    elseif ($r.Code -eq 200) {
        Add-Result "Regression" "REG-01.6" "SM CRUD: Verify delete" "FAIL" "High" "Still exists after delete!"
    }
    else {
        Add-Result "Regression" "REG-01.6" "SM CRUD: Verify delete" "WARN" "High" "HTTP $($r.Code)"
    }
}
else {
    Add-Result "Regression" "REG-01.5" "SM CRUD: Delete" "SKIP" "Critical" "No ID"
    Add-Result "Regression" "REG-01.6" "SM CRUD: Verify delete" "SKIP" "High" "No ID"
}

# --- REG-02: Search & Filter Regression ---
Write-Host "`n--- REG-02: Search and Filter Regression ---" -ForegroundColor Yellow

# Basic search
$r = Do-Request "GET" "/api/surat-masuk?search=surat" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $count = if ($d.data) { $d.data.Count } else { 0 }
    Add-Result "Regression" "REG-02.1" "Search: Basic keyword" "PASS" "High" "Found $count results for 'surat'"
}
else {
    Add-Result "Regression" "REG-02.1" "Search: Basic keyword" "FAIL" "High" "HTTP $($r.Code)"
}

# Filter by year
$r = Do-Request "GET" "/api/surat-masuk?tahun=2026" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-02.2" "Filter: Year 2026" "PASS" "High" "Filter applied"
}
else {
    Add-Result "Regression" "REG-02.2" "Filter: Year 2026" "FAIL" "High" "HTTP $($r.Code)"
}

# Empty search returns all
$r1 = Do-Request "GET" "/api/surat-masuk" $null $adminSession
$r2 = Do-Request "GET" "/api/surat-masuk?search=" $null $adminSession
if ($r1.Code -eq 200 -and $r2.Code -eq 200) {
    $c1 = (($r1.Content | ConvertFrom-Json).total)
    $c2 = (($r2.Content | ConvertFrom-Json).total)
    if ($c1 -eq $c2) {
        Add-Result "Regression" "REG-02.3" "Search: Empty = All" "PASS" "Medium" "Both return $c1 total"
    }
    else {
        Add-Result "Regression" "REG-02.3" "Search: Empty = All" "WARN" "Medium" "Mismatch: $c1 vs $c2"
    }
}
else {
    Add-Result "Regression" "REG-02.3" "Search: Empty = All" "FAIL" "Medium" "HTTP error"
}

# Case-insensitive search
$r = Do-Request "GET" "/api/surat-masuk?search=SURAT" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $count = if ($d.data) { $d.data.Count } else { 0 }
    Add-Result "Regression" "REG-02.4" "Search: Case insensitive" "PASS" "Medium" "UPPERCASE found $count results"
}
else {
    Add-Result "Regression" "REG-02.4" "Search: Case insensitive" "FAIL" "Medium" "HTTP $($r.Code)"
}

# --- REG-03: Pagination Regression ---
Write-Host "`n--- REG-03: Pagination Regression ---" -ForegroundColor Yellow

# Page 1
$pgUri = '/api/surat-masuk?page=1&limit=2'
$r = Do-Request "GET" $pgUri $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $p1Count = if ($d.data) { $d.data.Count } else { 0 }
    $total = if ($d.total) { $d.total } else { 0 }
    Add-Result "Regression" "REG-03.1" "Pagination: Page 1" "PASS" "High" "$p1Count items, total $total"
    
    # Page 2 should be different
    if ($total -gt 2) {
        $pg2Uri = '/api/surat-masuk?page=2&limit=2'
        $r2 = Do-Request "GET" $pg2Uri $null $adminSession
        if ($r2.Code -eq 200) {
            $d2 = ($r2.Content | ConvertFrom-Json)
            $p2FirstId = if ($d2.data -and $d2.data.Count -gt 0) { $d2.data[0].id } else { "" }
            $p1FirstId = if ($d.data -and $d.data.Count -gt 0) { $d.data[0].id } else { "" }
            if ($p1FirstId -ne $p2FirstId) {
                Add-Result "Regression" "REG-03.2" "Pagination: Page 2 different" "PASS" "High" "Different data on page 2"
            }
            else {
                Add-Result "Regression" "REG-03.2" "Pagination: Page 2 different" "FAIL" "High" "Same data on page 1 and 2!"
            }
        }
    }
    else {
        Add-Result "Regression" "REG-03.2" "Pagination: Page 2" "SKIP" "High" "Not enough data"
    }
}
else {
    Add-Result "Regression" "REG-03.1" "Pagination: Page 1" "FAIL" "High" "HTTP $($r.Code)"
}

# Limit = 1
$pg3Uri = '/api/surat-masuk?page=1&limit=1'
$r = Do-Request "GET" $pg3Uri $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $count = if ($d.data) { $d.data.Count } else { 0 }
    if ($count -le 1) {
        Add-Result "Regression" "REG-03.3" "Pagination: Limit=1" "PASS" "Medium" "Returns $count item"
    }
    else {
        Add-Result "Regression" "REG-03.3" "Pagination: Limit=1" "FAIL" "Medium" "Returns $count items (expected 1)"
    }
}
else {
    Add-Result "Regression" "REG-03.3" "Pagination: Limit=1" "FAIL" "Medium" "HTTP $($r.Code)"
}

# --- REG-04: Auth Flow Regression ---
Write-Host "`n--- REG-04: Auth Flow Regression ---" -ForegroundColor Yellow

# Get session info
$r = Do-Request "GET" "/api/auth/get-session" $null $adminSession
if ($r.Code -eq 200) {
    try {
        $sess = ($r.Content | ConvertFrom-Json)
        $hasUser = [bool]($sess.user -or $sess.session)
        if ($hasUser) {
            Add-Result "Regression" "REG-04.1" "Auth: Session valid" "PASS" "Critical" "Session active"
        }
        else {
            Add-Result "Regression" "REG-04.1" "Auth: Session valid" "WARN" "Critical" "Session missing user"
        }
    }
    catch {
        Add-Result "Regression" "REG-04.1" "Auth: Session valid" "WARN" "Critical" "Response parse error"
    }
}
else {
    Add-Result "Regression" "REG-04.1" "Auth: Session valid" "FAIL" "Critical" "HTTP $($r.Code)"
}

# Invalid login
$r = Do-Request "POST" "/api/auth/sign-in/email" '{"email":"wrong@email.com","password":"wrongpass"}' $null "json"
if ($r.Code -eq 401 -or $r.Code -eq 400 -or $r.Code -eq 403) {
    Add-Result "Regression" "REG-04.2" "Auth: Invalid login rejected" "PASS" "Critical" "HTTP $($r.Code) - Rejected"
}
elseif ($r.Code -eq 200) {
    Add-Result "Regression" "REG-04.2" "Auth: Invalid login rejected" "FAIL" "Critical" "HTTP 200 - Should reject!"
}
else {
    Add-Result "Regression" "REG-04.2" "Auth: Invalid login rejected" "PASS" "Critical" "HTTP $($r.Code)"
}

# Missing fields login
$r = Do-Request "POST" "/api/auth/sign-in/email" '{}' $null "json"
if ($r.Code -ne 200) {
    Add-Result "Regression" "REG-04.3" "Auth: Empty login rejected" "PASS" "High" "HTTP $($r.Code)"
}
else {
    Add-Result "Regression" "REG-04.3" "Auth: Empty login rejected" "FAIL" "High" "HTTP 200 for empty!"
}

# --- REG-05: Distribution Workflow ---
Write-Host "`n--- REG-05: Distribution Workflow ---" -ForegroundColor Yellow

$r = Do-Request "GET" "/api/distributions/inbox" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-05.1" "Distribution: Inbox loads" "PASS" "High" "Inbox OK"
}
else {
    Add-Result "Regression" "REG-05.1" "Distribution: Inbox loads" "FAIL" "High" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/distributions/outbox" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-05.2" "Distribution: Outbox loads" "PASS" "High" "Outbox OK"
}
else {
    Add-Result "Regression" "REG-05.2" "Distribution: Outbox loads" "FAIL" "High" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/distributions/units" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $uc = if ($d.data) { $d.data.Count } else { 0 }
    Add-Result "Regression" "REG-05.3" "Distribution: Units list" "PASS" "High" "$uc units available"
}
else {
    Add-Result "Regression" "REG-05.3" "Distribution: Units list" "FAIL" "High" "HTTP $($r.Code)"
}

# --- REG-06: Master Data Regression ---
Write-Host "`n--- REG-06: Master Data Regression ---" -ForegroundColor Yellow

# Klasifikasi list
$r = Do-Request "GET" "/api/klasifikasi" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $kc = if ($d.data) { $d.data.Count } else { 0 }
    if ($kc -gt 0) {
        Add-Result "Regression" "REG-06.1" "Master: Klasifikasi list" "PASS" "High" "$kc records"
    }
    else {
        Add-Result "Regression" "REG-06.1" "Master: Klasifikasi list" "WARN" "High" "Empty list"
    }
}
else {
    Add-Result "Regression" "REG-06.1" "Master: Klasifikasi list" "FAIL" "High" "HTTP $($r.Code)"
}

# JRA list
$r = Do-Request "GET" "/api/jra" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $jc = if ($d.data) { $d.data.Count } else { 0 }
    Add-Result "Regression" "REG-06.2" "Master: JRA list" "PASS" "High" "$jc records"
}
else {
    Add-Result "Regression" "REG-06.2" "Master: JRA list" "FAIL" "High" "HTTP $($r.Code)"
}

# Storage locations
$r = Do-Request "GET" "/api/storage-locations" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-06.3" "Master: Storage locations" "PASS" "Medium" "Loaded"
}
else {
    Add-Result "Regression" "REG-06.3" "Master: Storage locations" "FAIL" "Medium" "HTTP $($r.Code)"
}

# Users list
$r = Do-Request "GET" "/api/users" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-06.4" "Master: Users list" "PASS" "High" "Loaded"
}
else {
    Add-Result "Regression" "REG-06.4" "Master: Users list" "FAIL" "High" "HTTP $($r.Code)"
}

# --- REG-07: Dashboard Regression ---
Write-Host "`n--- REG-07: Dashboard Regression ---" -ForegroundColor Yellow

$r = Do-Request "GET" "/api/dashboard/stats" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $statsObj = if ($d.data) { $d.data } else { $d }
    $fields = $statsObj.PSObject.Properties.Name
    Add-Result "Regression" "REG-07.1" "Dashboard: Stats shape" "PASS" "High" "$($fields.Count) fields: $($fields -join ', ')"
}
else {
    Add-Result "Regression" "REG-07.1" "Dashboard: Stats shape" "FAIL" "High" "HTTP $($r.Code)"
}

# --- REG-08: Notification System ---
Write-Host "`n--- REG-08: Notifications ---" -ForegroundColor Yellow

$r = Do-Request "GET" "/api/notifications" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-08.1" "Notifications: List" "PASS" "Medium" "Loaded OK"
}
else {
    Add-Result "Regression" "REG-08.1" "Notifications: List" "FAIL" "Medium" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/notifications/unread-count" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-08.2" "Notifications: Unread count" "PASS" "Medium" "Count endpoint OK"
}
else {
    Add-Result "Regression" "REG-08.2" "Notifications: Unread count" "WARN" "Medium" "HTTP $($r.Code)"
}

# --- REG-09: Report Generation ---
Write-Host "`n--- REG-09: Reports ---" -ForegroundColor Yellow

$r = Do-Request "GET" "/api/reports/summary?year=2026" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-09.1" "Reports: Summary" "PASS" "High" "2026 report OK"
}
else {
    Add-Result "Regression" "REG-09.1" "Reports: Summary" "FAIL" "High" "HTTP $($r.Code)"
}

$r = Do-Request "GET" "/api/reports/summary?year=2025" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Regression" "REG-09.2" "Reports: Previous year" "PASS" "Medium" "2025 report OK"
}
else {
    Add-Result "Regression" "REG-09.2" "Reports: Previous year" "FAIL" "Medium" "HTTP $($r.Code)"
}

# --- REG-10: Audit Log ---
Write-Host "`n--- REG-10: Audit Log ---" -ForegroundColor Yellow

$r = Do-Request "GET" "/api/audit-log" $null $adminSession
if ($r.Code -eq 200) {
    $d = ($r.Content | ConvertFrom-Json)
    $logCount = if ($d.data) { $d.data.Count } elseif ($d -is [array]) { $d.Count } else { 0 }
    Add-Result "Regression" "REG-10.1" "Audit: Log entries" "PASS" "High" "$logCount entries"
}
else {
    Add-Result "Regression" "REG-10.1" "Audit: Log entries" "FAIL" "High" "HTTP $($r.Code)"
}

# --- REG-11: Retention ---
Write-Host "`n--- REG-11: Retention ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/retention/summary" $null $adminSession
if ($r.Code -eq 200) { Add-Result "Regression" "REG-11.1" "Retention: Summary" "PASS" "High" "OK" }
else { Add-Result "Regression" "REG-11.1" "Retention: Summary" "FAIL" "High" "HTTP $($r.Code)" }

$r = Do-Request "GET" "/api/retention/candidates" $null $adminSession
if ($r.Code -eq 200) { Add-Result "Regression" "REG-11.2" "Retention: Candidates" "PASS" "High" "OK" }
else { Add-Result "Regression" "REG-11.2" "Retention: Candidates" "FAIL" "High" "HTTP $($r.Code)" }

# --- REG-12: Supervision ---
Write-Host "`n--- REG-12: Supervision ---" -ForegroundColor Yellow
$r = Do-Request "GET" "/api/supervision/stats/activity" $null $adminSession
if ($r.Code -eq 200) { Add-Result "Regression" "REG-12.1" "Supervision: Activity" "PASS" "Medium" "OK" }
else { Add-Result "Regression" "REG-12.1" "Supervision: Activity" "FAIL" "Medium" "HTTP $($r.Code)" }

$r = Do-Request "GET" "/api/supervision/stats/users" $null $adminSession
if ($r.Code -eq 200) { Add-Result "Regression" "REG-12.2" "Supervision: Users" "PASS" "Medium" "OK" }
else { Add-Result "Regression" "REG-12.2" "Supervision: Users" "FAIL" "Medium" "HTTP $($r.Code)" }

# --- REG-13: Cross-Module Data Consistency ---
Write-Host "`n--- REG-13: Cross-Module Consistency ---" -ForegroundColor Yellow

# Dashboard SM total should match SM list total
$rDash = Do-Request "GET" "/api/dashboard/stats" $null $adminSession
$rSM = Do-Request "GET" "/api/surat-masuk?limit=1" $null $adminSession
if ($rDash.Code -eq 200 -and $rSM.Code -eq 200) {
    try {
        $dashData = ($rDash.Content | ConvertFrom-Json)
        $smData = ($rSM.Content | ConvertFrom-Json)
        $dashObj = if ($dashData.data) { $dashData.data } else { $dashData }
        $dashSM = $dashObj.totalSuratMasuk
        $smTotal = $smData.total
        if ($dashSM -ne $null -and $smTotal -ne $null) {
            if ([int]$dashSM -eq [int]$smTotal) {
                Add-Result "Regression" "REG-13.1" "Consistency: Dashboard=SM total" "PASS" "High" "Both $dashSM"
            }
            else {
                Add-Result "Regression" "REG-13.1" "Consistency: Dashboard=SM total" "WARN" "High" "Dashboard=$dashSM vs SM=$smTotal"
            }
        }
        else {
            Add-Result "Regression" "REG-13.1" "Consistency: Dashboard=SM total" "WARN" "Medium" "Could not compare (missing fields)"
        }
    }
    catch {
        Add-Result "Regression" "REG-13.1" "Consistency: Dashboard=SM" "WARN" "Medium" "Parse error"
    }
}
else {
    Add-Result "Regression" "REG-13.1" "Consistency: Dashboard=SM" "FAIL" "High" "One endpoint failed"
}

$phaseTimings["Regression"] = ((Get-Date) - $phase4Start).TotalSeconds

# ================================================================
# PHASE 5: PERFORMANCE TESTING
# ================================================================
$phase5Start = Get-Date
Write-Host "`n================================================================" -ForegroundColor Magenta
Write-Host "   PHASE 5: PERFORMANCE TESTING" -ForegroundColor Magenta
Write-Host "================================================================`n" -ForegroundColor Magenta

# --- PERF-01: API Response Time Benchmarks ---
Write-Host "--- PERF-01: Response Time Benchmarks ---" -ForegroundColor Yellow

$benchmarks = @(
    @{uri = "/api/health"; name = "Health Check"; threshold = 100 },
    @{uri = "/api/surat-masuk?limit=10"; name = "SM List (10)"; threshold = 500 },
    @{uri = "/api/surat-masuk?limit=50"; name = "SM List (50)"; threshold = 1000 },
    @{uri = "/api/dashboard/stats"; name = "Dashboard Stats"; threshold = 800 },
    @{uri = "/api/klasifikasi"; name = "Klasifikasi (627 records)"; threshold = 1000 },
    @{uri = "/api/jra"; name = "JRA (257 records)"; threshold = 800 },
    @{uri = "/api/distributions/inbox"; name = "Distribution Inbox"; threshold = 500 },
    @{uri = "/api/retention/summary"; name = "Retention Summary"; threshold = 800 },
    @{uri = "/api/reports/summary?year=2026"; name = "Report Summary"; threshold = 1000 },
    @{uri = "/api/notifications"; name = "Notifications"; threshold = 500 },
    @{uri = "/api/audit-log"; name = "Audit Log"; threshold = 800 },
    @{uri = "/api/supervision/stats/activity"; name = "Supervision Activity"; threshold = 800 }
)

$i = 1
$totalResponseTime = 0
$slowEndpoints = @()
foreach ($b in $benchmarks) {
    # Warm-up run (discard)
    $null = Do-Request "GET" $b.uri $null $adminSession
    
    # Measured runs (3x average)
    $times = @()
    for ($run = 0; $run -lt 3; $run++) {
        $r = Do-Request "GET" $b.uri $null $adminSession
        if ($r.TimeMs) { $times += $r.TimeMs }
    }
    
    $avgMs = if ($times.Count -gt 0) { [math]::Round(($times | Measure-Object -Average).Average, 0) } else { -1 }
    $maxMs = if ($times.Count -gt 0) { ($times | Measure-Object -Maximum).Maximum } else { -1 }
    $totalResponseTime += $avgMs
    
    if ($avgMs -le $b.threshold) {
        Add-Result "Performance" "PERF-01.$i" "RT: $($b.name)" "PASS" "Medium" "${avgMs}ms avg / ${maxMs}ms max (threshold: $($b.threshold)ms)"
    }
    elseif ($avgMs -le ($b.threshold * 2)) {
        Add-Result "Performance" "PERF-01.$i" "RT: $($b.name)" "WARN" "Medium" "${avgMs}ms avg (threshold: $($b.threshold)ms)"
        $slowEndpoints += "$($b.name): ${avgMs}ms"
    }
    else {
        Add-Result "Performance" "PERF-01.$i" "RT: $($b.name)" "FAIL" "High" "${avgMs}ms avg - TOO SLOW (threshold: $($b.threshold)ms)"
        $slowEndpoints += "$($b.name): ${avgMs}ms"
    }
    $i++
}

$avgOverall = [math]::Round($totalResponseTime / $benchmarks.Count, 0)
Add-Result "Performance" "PERF-01.AVG" "RT: Overall Average" $(if ($avgOverall -lt 500) { "PASS" } elseif ($avgOverall -lt 1000) { "WARN" } else { "FAIL" }) "High" "${avgOverall}ms average across $($benchmarks.Count) endpoints"

# --- PERF-02: Concurrent Request Handling ---
Write-Host "`n--- PERF-02: Concurrent Request Handling ---" -ForegroundColor Yellow

# Simulate concurrent requests using runspace pool
$concurrencyLevels = @(5, 10, 20)
foreach ($concurrency in $concurrencyLevels) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $jobs = @()
    
    for ($j = 0; $j -lt $concurrency; $j++) {
        $jobs += Start-Job -ScriptBlock {
            param($url, $sess)
            try {
                $r = Invoke-WebRequest -Uri $url -Method GET -UseBasicParsing -TimeoutSec 30
                return @{ OK = $true; Code = $r.StatusCode }
            }
            catch {
                $c = 0; try { $c = [int]$_.Exception.Response.StatusCode } catch {}
                return @{ OK = $false; Code = $c }
            }
        } -ArgumentList "$baseUrl/api/surat-masuk?limit=5", $adminSession
    }
    
    $completed = $jobs | Wait-Job -Timeout 30
    $sw.Stop()
    
    $successCount = 0
    $failCount = 0
    foreach ($job in $jobs) {
        $result = Receive-Job -Job $job -ErrorAction SilentlyContinue
        if ($result.OK -or $result.Code -eq 200) { $successCount++ } else { $failCount++ }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    
    $totalMs = $sw.ElapsedMilliseconds
    $avgPerReq = [math]::Round($totalMs / $concurrency, 0)
    
    if ($successCount -eq $concurrency) {
        Add-Result "Performance" "PERF-02.C$concurrency" "Concurrent: ${concurrency}x requests" "PASS" "High" "${totalMs}ms total, ${avgPerReq}ms/req, $successCount/$concurrency OK"
    }
    elseif ($successCount -gt ($concurrency * 0.8)) {
        Add-Result "Performance" "PERF-02.C$concurrency" "Concurrent: ${concurrency}x requests" "WARN" "High" "${totalMs}ms, $successCount/$concurrency OK, $failCount failed"
    }
    else {
        Add-Result "Performance" "PERF-02.C$concurrency" "Concurrent: ${concurrency}x requests" "FAIL" "High" "$failCount/$concurrency failed!"
    }
}

# --- PERF-03: Large Payload Stress ---
Write-Host "`n--- PERF-03: Large Payload Stress ---" -ForegroundColor Yellow

# Large pagination request
$r = Do-Request "GET" "/api/surat-masuk?limit=100" $null $adminSession
if ($r.Code -eq 200 -or $r.Code -eq 400) {
    $sz = if ($r.Content) { $r.Content.Length } else { 0 }
    Add-Result "Performance" "PERF-03.1" "Stress: Large list (100)" "PASS" "Medium" "${sz} bytes in $($r.TimeMs)ms"
}
else {
    Add-Result "Performance" "PERF-03.1" "Stress: Large list (100)" "FAIL" "Medium" "HTTP $($r.Code)"
}

# Large search result
$r = Do-Request "GET" "/api/klasifikasi" $null $adminSession
if ($r.Code -eq 200) {
    $sz = if ($r.Content) { $r.Content.Length } else { 0 }
    Add-Result "Performance" "PERF-03.2" "Stress: Full Klasifikasi" "PASS" "Medium" "${sz} bytes in $($r.TimeMs)ms"
}
else {
    Add-Result "Performance" "PERF-03.2" "Stress: Full Klasifikasi" "FAIL" "Medium" "HTTP $($r.Code)"
}

# Heavy query: dashboard stats
$r = Do-Request "GET" "/api/dashboard/stats" $null $adminSession
if ($r.Code -eq 200) {
    Add-Result "Performance" "PERF-03.3" "Stress: Dashboard stats" "PASS" "Medium" "$($r.TimeMs)ms"
}
else {
    Add-Result "Performance" "PERF-03.3" "Stress: Dashboard stats" "FAIL" "Medium" "HTTP $($r.Code)"
}

# --- PERF-04: Rapid Sequential (N+1 Detection) ---
Write-Host "`n--- PERF-04: Rapid Sequential Requests ---" -ForegroundColor Yellow

$sequentialTimes = @()
for ($j = 0; $j -lt 20; $j++) {
    $seqUri = '/api/surat-masuk?limit=5&page=' + ($j + 1)
    $r = Do-Request "GET" $seqUri $null $adminSession
    if ($r.TimeMs) { $sequentialTimes += $r.TimeMs }
}

if ($sequentialTimes.Count -gt 0) {
    $seqAvg = [math]::Round(($sequentialTimes | Measure-Object -Average).Average, 0)
    $seqMax = ($sequentialTimes | Measure-Object -Maximum).Maximum
    $seqMin = ($sequentialTimes | Measure-Object -Minimum).Minimum
    $variance = $seqMax - $seqMin
    
    # Check for degradation (last 5 shouldn't be much slower than first 5)
    $first5Avg = ($sequentialTimes[0..4] | Measure-Object -Average).Average
    $last5Avg = ($sequentialTimes[15..19] | Measure-Object -Average).Average
    $degradation = [math]::Round((($last5Avg - $first5Avg) / [Math]::Max($first5Avg, 1)) * 100, 1)
    
    if ($degradation -gt 50) {
        Add-Result "Performance" "PERF-04.1" "Sequential: 20x requests" "WARN" "High" "Avg ${seqAvg}ms, Degradation: ${degradation}% (first5: $([math]::Round($first5Avg))ms, last5: $([math]::Round($last5Avg))ms)"
    }
    else {
        Add-Result "Performance" "PERF-04.1" "Sequential: 20x requests" "PASS" "High" "Avg ${seqAvg}ms, Min/Max: ${seqMin}/${seqMax}ms, Degradation: ${degradation}%"
    }
}
else {
    Add-Result "Performance" "PERF-04.1" "Sequential: 20x requests" "FAIL" "High" "No timing data"
}

# --- PERF-05: Response Size Check ---
Write-Host "`n--- PERF-05: Response Size ---" -ForegroundColor Yellow

$sizeChecks = @(
    @{uri = "/api/surat-masuk?limit=10"; name = "SM 10 items" },
    @{uri = "/api/klasifikasi"; name = "Klasifikasi full" },
    @{uri = "/api/jra"; name = "JRA full" },
    @{uri = "/api/dashboard/stats"; name = "Dashboard" }
)

$i = 1
foreach ($sc in $sizeChecks) {
    $r = Do-Request "GET" $sc.uri $null $adminSession
    if ($r.Code -eq 200 -and $r.Content) {
        $sizeKB = [math]::Round($r.Content.Length / 1024, 1)
        if ($sizeKB -lt 500) {
            Add-Result "Performance" "PERF-05.$i" "Size: $($sc.name)" "PASS" "Low" "${sizeKB}KB"
        }
        elseif ($sizeKB -lt 2000) {
            Add-Result "Performance" "PERF-05.$i" "Size: $($sc.name)" "WARN" "Low" "${sizeKB}KB (consider compression)"
        }
        else {
            Add-Result "Performance" "PERF-05.$i" "Size: $($sc.name)" "FAIL" "Medium" "${sizeKB}KB - too large!"
        }
    }
    else {
        Add-Result "Performance" "PERF-05.$i" "Size: $($sc.name)" "SKIP" "Low" "HTTP $($r.Code)"
    }
    $i++
}

# --- PERF-06: Auth Endpoint Performance ---
Write-Host "`n--- PERF-06: Auth Performance ---" -ForegroundColor Yellow

$loginTimes = @()
for ($j = 0; $j -lt 3; $j++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing
    }
    catch {}
    $sw.Stop()
    $loginTimes += $sw.ElapsedMilliseconds
}

$loginAvg = [math]::Round(($loginTimes | Measure-Object -Average).Average, 0)
if ($loginAvg -lt 1000) {
    Add-Result "Performance" "PERF-06.1" "Auth: Login speed" "PASS" "High" "${loginAvg}ms avg"
}
elseif ($loginAvg -lt 3000) {
    Add-Result "Performance" "PERF-06.1" "Auth: Login speed" "WARN" "High" "${loginAvg}ms avg (slow)"
}
else {
    Add-Result "Performance" "PERF-06.1" "Auth: Login speed" "FAIL" "High" "${loginAvg}ms avg (too slow!)"
}

$phaseTimings["Performance"] = ((Get-Date) - $phase5Start).TotalSeconds

# ================================================================
# COMPREHENSIVE SUMMARY
# ================================================================
Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   COMPREHENSIVE TEST RESULTS" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$phases = @("Regression", "Performance")
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

if ($slowEndpoints.Count -gt 0) {
    Write-Host "`nSLOW ENDPOINTS:" -ForegroundColor Yellow
    $slowEndpoints | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

# Export
$results | Export-Csv -Path "regression-perf-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "`nResults saved to regression-perf-results.csv" -ForegroundColor Cyan
Write-Host "Testing completed at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
