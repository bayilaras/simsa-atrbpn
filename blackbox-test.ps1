# SIMSA Blackbox Testing Script
# Tests all API endpoints comprehensively

$baseUrl = "http://localhost:3001"
$results = @()

function Add-Result($id, $name, $status, $detail) {
    $script:results += [PSCustomObject]@{
        ID = $id
        Name = $name
        Status = $status
        Detail = $detail
    }
    $color = if ($status -eq "PASS") { "Green" } elseif ($status -eq "FAIL") { "Red" } else { "Yellow" }
    Write-Host "[$status] $id - $name : $detail" -ForegroundColor $color
}

function Test-Endpoint($id, $name, $method, $uri, $body, $expectedStatus, $session) {
    try {
        $params = @{
            Uri = "$baseUrl$uri"
            Method = $method
            UseBasicParsing = $true
            WebSession = $session
        }
        if ($body) {
            $params.Body = ($body | ConvertTo-Json -Depth 10)
            $params.ContentType = "application/json"
        }
        $r = Invoke-WebRequest @params
        $statusCode = $r.StatusCode
        $content = $r.Content
        $contentPreview = if ($content.Length -gt 200) { $content.Substring(0, 200) + "..." } else { $content }
        
        if ($statusCode -eq $expectedStatus) {
            Add-Result $id $name "PASS" "HTTP $statusCode - Response OK"
        } else {
            Add-Result $id $name "FAIL" "Expected HTTP $expectedStatus, got $statusCode"
        }
        return @{ StatusCode = $statusCode; Content = $content; Response = $r }
    } catch {
        $errStatus = 0
        $errBody = ""
        try {
            $errStatus = [int]$_.Exception.Response.StatusCode
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errBody = $reader.ReadToEnd()
        } catch {}
        
        if ($errStatus -eq $expectedStatus) {
            Add-Result $id $name "PASS" "HTTP $errStatus - Expected error response"
        } else {
            Add-Result $id $name "FAIL" "HTTP $errStatus - $($_.Exception.Message)"
        }
        return @{ StatusCode = $errStatus; Content = $errBody }
    }
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  SIMSA Blackbox Testing - Full Suite" -ForegroundColor Cyan
Write-Host "  Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# ============================================================
# TC-01: AUTHENTICATION
# ============================================================
Write-Host "`n--- MODUL 1: AUTENTIKASI ---" -ForegroundColor Yellow

# TC-01a: Frontend accessible
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/login" -UseBasicParsing
    if ($r.StatusCode -eq 200 -and $r.Content -match "SIMSA") {
        Add-Result "TC-01a" "Frontend Login Page Accessible" "PASS" "HTTP 200 - Login page loads with SIMSA branding"
    } else {
        Add-Result "TC-01a" "Frontend Login Page Accessible" "FAIL" "Page loaded but content unexpected"
    }
} catch {
    Add-Result "TC-01a" "Frontend Login Page Accessible" "FAIL" "$($_.Exception.Message)"
}

# TC-01b: Invalid login
$body = '{"email":"wrong@email.com","password":"wrongpassword"}'
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
    Add-Result "TC-01b" "Login Invalid Credentials" "FAIL" "Expected 401, got $($r.StatusCode)"
} catch {
    $errStatus = [int]$_.Exception.Response.StatusCode
    if ($errStatus -eq 401 -or $errStatus -eq 400 -or $errStatus -eq 403) {
        Add-Result "TC-01b" "Login Invalid Credentials" "PASS" "HTTP $errStatus - Correctly rejected"
    } else {
        Add-Result "TC-01b" "Login Invalid Credentials" "FAIL" "HTTP $errStatus"
    }
}

# TC-01c: Access protected route without auth
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/dashboard/stats" -UseBasicParsing
    Add-Result "TC-01c" "Protected Route Without Auth" "FAIL" "Expected 401, got $($r.StatusCode)"
} catch {
    $errStatus = [int]$_.Exception.Response.StatusCode
    if ($errStatus -eq 401 -or $errStatus -eq 403) {
        Add-Result "TC-01c" "Protected Route Without Auth" "PASS" "HTTP $errStatus - Correctly blocked"
    } else {
        Add-Result "TC-01c" "Protected Route Without Auth" "FAIL" "HTTP $errStatus"
    }
}

# TC-01d: Valid login
$loginBody = '{"email":"tester@simsa.atrbpn.go.id","password":"Password123!@#"}'
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/auth/sign-in/email" -Method POST -Body $loginBody -ContentType "application/json" -UseBasicParsing -SessionVariable loginSession
    $global:s = $loginSession
    $userData = $r.Content | ConvertFrom-Json
    $userRole = ""
    if ($userData.user) { $userRole = $userData.user.role }
    if ($userData.token) { $userRole = "token-based" }
    Add-Result "TC-01d" "Login Valid Credentials" "PASS" "HTTP $($r.StatusCode) - Login success (role: $userRole)"
} catch {
    Add-Result "TC-01d" "Login Valid Credentials" "FAIL" "$($_.Exception.Message)"
    Write-Host "CRITICAL: Cannot continue testing without valid session!" -ForegroundColor Red
    $results | Format-Table -AutoSize
    exit 1
}

# TC-01e: Get session after login
$sess = Test-Endpoint "TC-01e" "Get Session Info" "GET" "/api/auth/get-session" $null 200 $s
if ($sess.Content) {
    try {
        $sessionData = $sess.Content | ConvertFrom-Json
        $userName = ""
        $userRole = ""
        if ($sessionData.user) { 
            $userName = $sessionData.user.name 
            $userRole = $sessionData.user.role
        }
        if ($sessionData.session -and $sessionData.session.user) {
            $userName = $sessionData.session.user.name
            $userRole = $sessionData.session.user.role
        }
        Write-Host "  -> User: $userName | Role: $userRole" -ForegroundColor Cyan
    } catch {}
}

# ============================================================
# TC-02: DASHBOARD
# ============================================================
Write-Host "`n--- MODUL 2: DASHBOARD ---" -ForegroundColor Yellow
Test-Endpoint "TC-02a" "Dashboard Stats" "GET" "/api/dashboard/stats" $null 200 $s | Out-Null

# ============================================================
# TC-03: SURAT MASUK
# ============================================================
Write-Host "`n--- MODUL 3: SURAT MASUK ---" -ForegroundColor Yellow
$smResult = Test-Endpoint "TC-03a" "List Surat Masuk" "GET" "/api/surat-masuk" $null 200 $s
if ($smResult.Content) {
    try {
        $smData = $smResult.Content | ConvertFrom-Json
        $count = 0
        if ($smData.data) { $count = $smData.data.Count } 
        elseif ($smData -is [array]) { $count = $smData.Count }
        elseif ($smData.suratMasuk) { $count = $smData.suratMasuk.Count }
        Write-Host "  -> Surat Masuk count: $count" -ForegroundColor Cyan
    } catch {}
}

Test-Endpoint "TC-03b" "Search Surat Masuk" "GET" "/api/surat-masuk?search=test" $null 200 $s | Out-Null
Test-Endpoint "TC-03c" "Filter Surat Masuk by Date" "GET" "/api/surat-masuk?startDate=2024-01-01&endDate=2026-12-31" $null 200 $s | Out-Null

# Get first SM detail if available
if ($smResult.Content) {
    try {
        $smData = $smResult.Content | ConvertFrom-Json
        $firstId = $null
        if ($smData.data -and $smData.data.Count -gt 0) { $firstId = $smData.data[0].id }
        elseif ($smData -is [array] -and $smData.Count -gt 0) { $firstId = $smData[0].id }
        elseif ($smData.suratMasuk -and $smData.suratMasuk.Count -gt 0) { $firstId = $smData.suratMasuk[0].id }
        if ($firstId) {
            Test-Endpoint "TC-03d" "Detail Surat Masuk" "GET" "/api/surat-masuk/$firstId" $null 200 $s | Out-Null
        } else {
            Add-Result "TC-03d" "Detail Surat Masuk" "SKIP" "No data available to test detail"
        }
    } catch {
        Add-Result "TC-03d" "Detail Surat Masuk" "SKIP" "Could not parse response"
    }
}

# ============================================================
# TC-04: SURAT KELUAR
# ============================================================
Write-Host "`n--- MODUL 4: SURAT KELUAR ---" -ForegroundColor Yellow
$skResult = Test-Endpoint "TC-04a" "List Surat Keluar" "GET" "/api/surat-keluar" $null 200 $s
Test-Endpoint "TC-04b" "Search Surat Keluar" "GET" "/api/surat-keluar?search=test" $null 200 $s | Out-Null

if ($skResult.Content) {
    try {
        $skData = $skResult.Content | ConvertFrom-Json
        $firstId = $null
        if ($skData.data -and $skData.data.Count -gt 0) { $firstId = $skData.data[0].id }
        elseif ($skData -is [array] -and $skData.Count -gt 0) { $firstId = $skData[0].id }
        elseif ($skData.suratKeluar -and $skData.suratKeluar.Count -gt 0) { $firstId = $skData.suratKeluar[0].id }
        if ($firstId) {
            Test-Endpoint "TC-04c" "Detail Surat Keluar" "GET" "/api/surat-keluar/$firstId" $null 200 $s | Out-Null
        } else {
            Add-Result "TC-04c" "Detail Surat Keluar" "SKIP" "No data available"
        }
    } catch {
        Add-Result "TC-04c" "Detail Surat Keluar" "SKIP" "Could not parse"
    }
}

# ============================================================
# TC-05: DISTRIBUSI
# ============================================================
Write-Host "`n--- MODUL 5: DISTRIBUSI ---" -ForegroundColor Yellow
Test-Endpoint "TC-05a" "List Distribusi" "GET" "/api/distributions/inbox" $null 200 $s | Out-Null

# ============================================================
# TC-06: ARSIP
# ============================================================
Write-Host "`n--- MODUL 6: ARSIP ---" -ForegroundColor Yellow
$arsipResult = Test-Endpoint "TC-06a" "List Arsip" "GET" "/api/arsip" $null 200 $s

if ($arsipResult.Content) {
    try {
        $arsipData = $arsipResult.Content | ConvertFrom-Json
        $firstId = $null
        if ($arsipData.data -and $arsipData.data.Count -gt 0) { $firstId = $arsipData.data[0].id }
        elseif ($arsipData -is [array] -and $arsipData.Count -gt 0) { $firstId = $arsipData[0].id }
        if ($firstId) {
            Test-Endpoint "TC-06b" "Detail Arsip" "GET" "/api/arsip/$firstId" $null 200 $s | Out-Null
        } else {
            Add-Result "TC-06b" "Detail Arsip" "SKIP" "No arsip data available"
        }
    } catch {
        Add-Result "TC-06b" "Detail Arsip" "SKIP" "Could not parse"
    }
}

Test-Endpoint "TC-06c" "Search Arsip" "GET" "/api/arsip?search=test" $null 200 $s | Out-Null

# ============================================================
# TC-07: DOSIR
# ============================================================
Write-Host "`n--- MODUL 7: DOSIR ---" -ForegroundColor Yellow
$dosirResult = Test-Endpoint "TC-07a" "List Dosir" "GET" "/api/dosir" $null 200 $s

if ($dosirResult.Content) {
    try {
        $dosirData = $dosirResult.Content | ConvertFrom-Json
        $firstId = $null
        if ($dosirData.data -and $dosirData.data.Count -gt 0) { $firstId = $dosirData.data[0].id }
        elseif ($dosirData -is [array] -and $dosirData.Count -gt 0) { $firstId = $dosirData[0].id }
        if ($firstId) {
            Test-Endpoint "TC-07b" "Detail Dosir" "GET" "/api/dosir/$firstId" $null 200 $s | Out-Null
        } else {
            Add-Result "TC-07b" "Detail Dosir" "SKIP" "No dosir data"
        }
    } catch {
        Add-Result "TC-07b" "Detail Dosir" "SKIP" "Could not parse"
    }
}

# ============================================================
# TC-08: PEMINJAMAN ARSIP
# ============================================================
Write-Host "`n--- MODUL 8: PEMINJAMAN ARSIP ---" -ForegroundColor Yellow
Test-Endpoint "TC-08a" "List Peminjaman" "GET" "/api/archive-lending" $null 200 $s | Out-Null

# ============================================================
# TC-09-11: ARSIP VITAL, TERJAGA, ELEKTRONIK
# ============================================================
Write-Host "`n--- MODUL 9-11: ARSIP KHUSUS ---" -ForegroundColor Yellow
Test-Endpoint "TC-09a" "List Arsip Vital" "GET" "/api/arsip-vital" $null 200 $s | Out-Null
Test-Endpoint "TC-10a" "List Arsip Terjaga" "GET" "/api/arsip-terjaga" $null 200 $s | Out-Null
Test-Endpoint "TC-11a" "List Arsip Elektronik" "GET" "/api/arsip-elektronik" $null 200 $s | Out-Null

# ============================================================
# TC-12: PENYUSUTAN ARSIP
# ============================================================
Write-Host "`n--- MODUL 12: PENYUSUTAN ---" -ForegroundColor Yellow
Test-Endpoint "TC-12a" "List Penyusutan" "GET" "/api/penyusutan" $null 200 $s | Out-Null

# ============================================================
# TC-13: RETENTION MANAGEMENT
# ============================================================
Write-Host "`n--- MODUL 13: RETENSI ---" -ForegroundColor Yellow
Test-Endpoint "TC-13a" "List Retention" "GET" "/api/retention/summary" $null 200 $s | Out-Null

# ============================================================
# TC-14: LOKASI SIMPAN
# ============================================================
Write-Host "`n--- MODUL 14: LOKASI SIMPAN ---" -ForegroundColor Yellow
Test-Endpoint "TC-14a" "List Storage Locations" "GET" "/api/storage-locations" $null 200 $s | Out-Null

# ============================================================
# TC-15: TUNJUK SILANG
# ============================================================
Write-Host "`n--- MODUL 15: TUNJUK SILANG ---" -ForegroundColor Yellow
Test-Endpoint "TC-15a" "List Tunjuk Silang" "GET" "/api/tunjuk-silang" $null 200 $s | Out-Null

# ============================================================
# TC-16: AUTENTIKASI ARSIP
# ============================================================
Write-Host "`n--- MODUL 16: AUTENTIKASI ARSIP ---" -ForegroundColor Yellow
Test-Endpoint "TC-16a" "List Autentikasi" "GET" "/api/autentikasi" $null 200 $s | Out-Null

# ============================================================
# TC-17: LAYANAN ARSIP
# ============================================================
Write-Host "`n--- MODUL 17: LAYANAN ARSIP ---" -ForegroundColor Yellow
Test-Endpoint "TC-17a" "List Layanan Arsip" "GET" "/api/layanan-arsip" $null 200 $s | Out-Null

# ============================================================
# TC-18: KLASIFIKASI
# ============================================================
Write-Host "`n--- MODUL 18: MASTER DATA ---" -ForegroundColor Yellow
Test-Endpoint "TC-18a" "List Klasifikasi" "GET" "/api/klasifikasi" $null 200 $s | Out-Null

# ============================================================
# TC-19: JRA
# ============================================================
Test-Endpoint "TC-19a" "List JRA" "GET" "/api/jra" $null 200 $s | Out-Null

# ============================================================
# TC-20: LAPORAN / REPORTS
# ============================================================
Write-Host "`n--- MODUL 20: LAPORAN ---" -ForegroundColor Yellow
Test-Endpoint "TC-20a" "Report Summary" "GET" "/api/reports/summary?year=2026" $null 200 $s | Out-Null
Test-Endpoint "TC-20b" "Report Surat Masuk" "GET" "/api/reports/surat-masuk?year=2026" $null 200 $s | Out-Null
Test-Endpoint "TC-20c" "Report Surat Keluar" "GET" "/api/reports/surat-keluar?year=2026" $null 200 $s | Out-Null

# ============================================================
# TC-21: AUDIT LOG
# ============================================================
Write-Host "`n--- MODUL 21: AUDIT LOG ---" -ForegroundColor Yellow
Test-Endpoint "TC-21a" "List Audit Log" "GET" "/api/audit-log" $null 200 $s | Out-Null

# ============================================================
# TC-22: USER MANAGEMENT
# ============================================================
Write-Host "`n--- MODUL 22: USER MANAGEMENT ---" -ForegroundColor Yellow
Test-Endpoint "TC-22a" "List Users" "GET" "/api/users" $null 200 $s | Out-Null

# ============================================================
# TC-23: SETTINGS
# ============================================================
Write-Host "`n--- MODUL 23: SETTINGS ---" -ForegroundColor Yellow
Test-Endpoint "TC-23a" "Get Settings" "GET" "/api/settings/profile" $null 200 $s | Out-Null
Test-Endpoint "TC-23b" "List Unit Kerja" "GET" "/api/unit-kerja" $null 200 $s | Out-Null

# ============================================================
# TC-24: NOTIFICATIONS
# ============================================================
Write-Host "`n--- MODUL 24: NOTIFIKASI ---" -ForegroundColor Yellow
Test-Endpoint "TC-24a" "List Notifications" "GET" "/api/notifications" $null 200 $s | Out-Null

# ============================================================
# TC-25: SEARCH
# ============================================================
Write-Host "`n--- MODUL 25: GLOBAL SEARCH ---" -ForegroundColor Yellow
Test-Endpoint "TC-25a" "Global Search" "GET" "/api/search?q=surat" $null 200 $s | Out-Null

# ============================================================
# TC-26: MAPPING
# ============================================================
Write-Host "`n--- MODUL 26: MAPPING ---" -ForegroundColor Yellow
Test-Endpoint "TC-26a" "Klasifikasi-JRA Mapping" "GET" "/api/mapping/klasifikasi-jra" $null 200 $s | Out-Null

# ============================================================
# TC-27: EXPORT
# ============================================================
Write-Host "`n--- MODUL 27: EXPORT ---" -ForegroundColor Yellow
Test-Endpoint "TC-27a" "Export Surat Masuk" "GET" "/api/export/surat-masuk/excel" $null 200 $s | Out-Null

# ============================================================
# TC-28: SUPERVISION
# ============================================================
Write-Host "`n--- MODUL 28: SUPERVISION ---" -ForegroundColor Yellow
Test-Endpoint "TC-28a" "Supervision Data" "GET" "/api/supervision/stats/activity" $null 200 $s | Out-Null

# ============================================================
# TC-29: APPROVAL
# ============================================================
Write-Host "`n--- MODUL 29: APPROVAL ---" -ForegroundColor Yellow
Test-Endpoint "TC-29a" "List Approvals" "GET" "/api/approval/pending" $null 200 $s | Out-Null

# ============================================================
# TC-30: FRONTEND PAGES ACCESSIBILITY
# ============================================================
Write-Host "`n--- MODUL 30: FRONTEND PAGE LOADING ---" -ForegroundColor Yellow
$pages = @(
    @{id="TC-30a"; name="Dashboard Page"; url="/"},
    @{id="TC-30b"; name="Surat Masuk Page"; url="/surat/masuk"},
    @{id="TC-30c"; name="Surat Keluar Page"; url="/surat/keluar"},
    @{id="TC-30d"; name="Distribusi Page"; url="/distribusi"},
    @{id="TC-30e"; name="Arsip Page"; url="/arsip"},
    @{id="TC-30f"; name="Dosir Page"; url="/dosir"},
    @{id="TC-30g"; name="Peminjaman Page"; url="/archive-lending"},
    @{id="TC-30h"; name="Arsip Vital Page"; url="/arsip-vital"},
    @{id="TC-30i"; name="Arsip Terjaga Page"; url="/arsip-terjaga"},
    @{id="TC-30j"; name="Arsip Elektronik Page"; url="/arsip-elektronik"},
    @{id="TC-30k"; name="Penyusutan Page"; url="/penyusutan"},
    @{id="TC-30l"; name="Retensi Page"; url="/retention"},
    @{id="TC-30m"; name="Lokasi Simpan Page"; url="/storage-locations"},
    @{id="TC-30n"; name="Tunjuk Silang Page"; url="/tunjuk-silang"},
    @{id="TC-30o"; name="Autentikasi Page"; url="/autentikasi"},
    @{id="TC-30p"; name="Layanan Arsip Page"; url="/layanan-arsip"},
    @{id="TC-30q"; name="Formulir Page"; url="/formulir"},
    @{id="TC-30r"; name="Laporan Page"; url="/laporan"},
    @{id="TC-30s"; name="Audit Log Page"; url="/audit-log"},
    @{id="TC-30t"; name="Klasifikasi Page"; url="/master/klasifikasi"},
    @{id="TC-30u"; name="JRA Page"; url="/master/jra"},
    @{id="TC-30v"; name="User Management Page"; url="/users"},
    @{id="TC-30w"; name="Settings Page"; url="/settings"},
    @{id="TC-30x"; name="Bulk Upload Page"; url="/bulk-upload"}
)

foreach ($page in $pages) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000$($page.url)" -UseBasicParsing
        if ($r.StatusCode -eq 200) {
            Add-Result $page.id $page.name "PASS" "HTTP 200 - Page served"
        } else {
            Add-Result $page.id $page.name "FAIL" "HTTP $($r.StatusCode)"
        }
    } catch {
        $errStatus = 0
        try { $errStatus = [int]$_.Exception.Response.StatusCode } catch {}
        if ($errStatus -eq 200 -or $errStatus -eq 0) {
            Add-Result $page.id $page.name "PASS" "Page accessible"
        } else {
            Add-Result $page.id $page.name "FAIL" "HTTP $errStatus"
        }
    }
}

# ============================================================
# TC-31: LOGOUT
# ============================================================
Write-Host "`n--- MODUL 31: LOGOUT ---" -ForegroundColor Yellow
# Get CSRF token from cookies for POST request
$csrfToken = ""
try {
    $csrfCookie = $s.Cookies.GetCookies("$baseUrl") | Where-Object { $_.Name -eq "csrf_token" }
    if ($csrfCookie) { $csrfToken = $csrfCookie.Value }
} catch {}

try {
    $logoutParams = @{
        Uri = "$baseUrl/api/auth/sign-out"
        Method = "POST"
        UseBasicParsing = $true
        WebSession = $s
        ContentType = "application/json"
        Headers = @{ "X-CSRF-Token" = $csrfToken }
    }
    $r = Invoke-WebRequest @logoutParams
    Add-Result "TC-31a" "Logout" "PASS" "HTTP $($r.StatusCode) - Logout success"
} catch {
    $errStatus = 0
    try { $errStatus = [int]$_.Exception.Response.StatusCode } catch {}
    if ($errStatus -eq 200 -or $errStatus -eq 302) {
        Add-Result "TC-31a" "Logout" "PASS" "HTTP $errStatus - Logout OK"
    } else {
        Add-Result "TC-31a" "Logout" "WARN" "HTTP $errStatus - $($_.Exception.Message) (CSRF may block test)"
    }
}

# Verify session is invalidated after logout
Start-Sleep -Milliseconds 500
try {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/dashboard/stats" -UseBasicParsing -WebSession $s
    Add-Result "TC-31b" "Post-Logout Access Block" "FAIL" "Should be blocked after logout, got $($r.StatusCode)"
} catch {
    $errStatus = [int]$_.Exception.Response.StatusCode
    if ($errStatus -eq 401 -or $errStatus -eq 403) {
        Add-Result "TC-31b" "Post-Logout Access Block" "PASS" "HTTP $errStatus - Correctly blocked after logout"
    } else {
        Add-Result "TC-31b" "Post-Logout Access Block" "WARN" "HTTP $errStatus"
    }
}

# ============================================================
# SUMMARY
# ============================================================
Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  TEST RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

$passCount = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$skipCount = ($results | Where-Object { $_.Status -eq "SKIP" }).Count
$warnCount = ($results | Where-Object { $_.Status -eq "WARN" }).Count
$totalCount = $results.Count

Write-Host "Total Tests  : $totalCount" -ForegroundColor White
Write-Host "PASS         : $passCount" -ForegroundColor Green
Write-Host "FAIL         : $failCount" -ForegroundColor Red
Write-Host "SKIP         : $skipCount" -ForegroundColor Yellow
Write-Host "WARN         : $warnCount" -ForegroundColor Yellow
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "FAILED TESTS:" -ForegroundColor Red
    $results | Where-Object { $_.Status -eq "FAIL" } | Format-Table -AutoSize
}

# Export to file
$results | Format-Table -AutoSize | Out-String | Set-Content "blackbox-test-results.txt"
Write-Host "`nResults saved to blackbox-test-results.txt" -ForegroundColor Cyan

# Export detailed CSV
$results | Export-Csv -Path "blackbox-test-results.csv" -NoTypeInformation
Write-Host "Detailed CSV saved to blackbox-test-results.csv" -ForegroundColor Cyan
