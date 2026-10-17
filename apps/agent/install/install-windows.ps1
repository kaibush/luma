$ErrorActionPreference = 'Stop'
# Per-user installation. The Agent must run in the logged-in desktop session.
$pythonPath = $null
$candidates = @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe")
foreach ($candidate in $candidates) { if (Test-Path $candidate) { $pythonPath = $candidate; break } }
if (-not $pythonPath) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $found = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0) { $pythonPath = $found }
    }
}
if (-not $pythonPath) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Python 3.12 from python.org with Tcl/Tk enabled, then run this installer again.' }
    Write-Host 'Installing Python 3.12 for the current user...'
    & winget install --id Python.Python.3.12 --exact --scope user --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
    $pythonPath = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
}
if (-not (Test-Path $pythonPath)) { throw 'Python not found. Install Python 3.12 and retry.' }
$appDir = Join-Path $env:LOCALAPPDATA 'RemoteConsole\app'
New-Item -ItemType Directory -Force $appDir | Out-Null
# Limit configuration and code to this user and SYSTEM.
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls (Split-Path $appDir) /inheritance:r /grant:r "*${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to protect client directory.' }
Copy-Item "$PSScriptRoot\*.py", "$PSScriptRoot\requirements.lock", "$PSScriptRoot\quality-profiles.json" $appDir -Force
& $pythonPath -m venv "$appDir\.venv"
if ($LASTEXITCODE -ne 0) { throw 'Unable to create Python environment.' }
& "$appDir\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "$appDir\requirements.lock"
if ($LASTEXITCODE -ne 0) { throw 'Dependencies could not be installed. Check the network and retry.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Remote Console.lnk')
$shortcut.TargetPath = "$appDir\.venv\Scripts\pythonw.exe"
$shortcut.Arguments = '"' + $appDir + '\client.py"'
$shortcut.WorkingDirectory = $appDir
$shortcut.Save()
Start-Process -FilePath "$appDir\.venv\Scripts\pythonw.exe" -ArgumentList ('"' + $appDir + '\client.py"')
Write-Host 'Installed. Open Remote Console from your desktop to configure this computer.'
