param([int]$Port = 0)

$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
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

$candidates = if ($Port -gt 0) { @($Port) } else { @(8765, 5173, 5500, 8888, 9000, 8080, 8000) }
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
Start-Process $url

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $localPath = Get-LocalPath $request.Url.AbsolutePath
    $resolved = [IO.Path]::GetFullPath($localPath)
    $rootFull = [IO.Path]::GetFullPath($root)

    if (-not $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      $response.StatusCode = 403
      $bytes = [Text.Encoding]::UTF8.GetBytes('403 Forbidden')
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.Close()
      continue
    }

    if (Test-Path $resolved -PathType Container) {
      $index = Join-Path $resolved 'index.html'
      if (Test-Path $index) { $resolved = $index }
    }

    if (-not (Test-Path $resolved -PathType Leaf)) {
      $response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.Close()
      Write-Host "404 $($request.Url.LocalPath)"
      continue
    }

    $ext = [IO.Path]::GetExtension($resolved).ToLowerInvariant()
    if ($mime.ContainsKey($ext)) {
      $response.ContentType = $mime[$ext]
    }

    $bytes = [IO.File]::ReadAllBytes($resolved)
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
    Write-Host "200 $($request.Url.LocalPath)"
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
