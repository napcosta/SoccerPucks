param(
  [ValidateRange(0, 65535)]
  [int]$Port = 0,
  [switch]$NoBrowser
)

$root = $PSScriptRoot
$candidates = if ($Port -gt 0) { @($Port) } else { @(8765, 5173, 5500, 8888, 9000, 8080, 8000) }

function Test-LoopbackPort([int]$candidatePort) {
  $probe = $null
  try {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidatePort)
    $probe.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $probe) { $probe.Stop() }
  }
}

# Codex Desktop's PowerShell runtime does not support HttpListener. Prefer its
# bundled Python when available, then fall back to Python installed on PATH.
$userProfilePath = $env:USERPROFILE
$bundledPythonPath = Join-Path $userProfilePath '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$pythonCommand = $null

if (Test-Path $bundledPythonPath -PathType Leaf) {
  $pythonCommand = $bundledPythonPath
} else {
  foreach ($commandName in @('python', 'python3', 'py')) {
    $resolvedCommand = Get-Command $commandName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($resolvedCommand) {
      $pythonCommand = $resolvedCommand.Source
      break
    }
  }
}

if ($pythonCommand) {
  $Port = 0
  foreach ($candidate in $candidates) {
    if (Test-LoopbackPort $candidate) {
      $Port = $candidate
      break
    }
  }

  if ($Port -eq 0) {
    Write-Host 'Could not start a local server because the requested ports are busy.'
    Write-Host 'Close another dev server, or run: .\serve.ps1 -Port 9123'
    exit 1
  }

  $url = "http://localhost:$Port/"
  Write-Host "Serving $root with Python"
  Write-Host "Open $url"
  Write-Host 'Press Ctrl+C to stop.'
  if (-not $NoBrowser) { Start-Process $url }

  & $pythonCommand -m http.server $Port --bind 127.0.0.1 --directory $root
  exit $LASTEXITCODE
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
}

function Get-LocalPath([string]$urlPath) {
  $path = [System.Uri]::UnescapeDataString($urlPath.TrimStart('/'))
  if ([string]::IsNullOrEmpty($path)) { return Join-Path $root 'index.html' }
  Join-Path $root ($path -replace '/', [IO.Path]::DirectorySeparatorChar)
}

function New-GameListener([int]$port) {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$port/")
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  return $listener
}

$listener = $null
$Port = 0

foreach ($candidate in $candidates) {
  try {
    $listener = New-GameListener $candidate
    $Port = $candidate
    break
  } catch {
    continue
  }
}

if (-not $listener) {
  Write-Host 'Could not start a local server.'
  Write-Host 'Close other dev servers, or run: .\serve.ps1 -Port 9123'
  Write-Host ''
  Write-Host 'Stuck Python on port 8000? Run: .\stop-server.bat'
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host "Serving $root"
Write-Host "Open $url"
Write-Host 'Press Ctrl+C to stop.'
if (-not $NoBrowser) { Start-Process $url }

function Send-Response($request, $response, [int]$status, [byte[]]$bytes) {
  $response.StatusCode = $status
  $response.ContentLength64 = $bytes.Length
  if ($request.HttpMethod -ne 'HEAD') {
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
  }
  $response.Close()
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
      $localPath = Get-LocalPath $request.Url.AbsolutePath
      $resolved = [IO.Path]::GetFullPath($localPath)
      $rootFull = [IO.Path]::GetFullPath($root)

      if (-not $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $request $response 403 ([Text.Encoding]::UTF8.GetBytes('403 Forbidden'))
        continue
      }

      if (Test-Path $resolved -PathType Container) {
        $index = Join-Path $resolved 'index.html'
        if (Test-Path $index) { $resolved = $index }
      }

      if (-not (Test-Path $resolved -PathType Leaf)) {
        Send-Response $request $response 404 ([Text.Encoding]::UTF8.GetBytes('404 Not Found'))
        Write-Host "404 $($request.Url.LocalPath)"
        continue
      }

      $ext = [IO.Path]::GetExtension($resolved).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) {
        $response.ContentType = $mime[$ext]
      }

      Send-Response $request $response 200 ([IO.File]::ReadAllBytes($resolved))
      Write-Host "200 $($request.HttpMethod) $($request.Url.LocalPath)"
    } catch {
      Write-Host "ERR $($request.Url.LocalPath): $($_.Exception.Message)"
      try { $response.Abort() } catch {}
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
