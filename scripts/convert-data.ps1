param(
  [string]$Source = "C:\Users\chisato\Desktop\shikuchoson\pref_ctv.csv",
  [string]$Destination = ".\data\municipalities.json"
)

New-Item -ItemType Directory -Force -Path (Split-Path $Destination) | Out-Null
$json = Import-Csv -Path $Source -Encoding UTF8 | ConvertTo-Json -Depth 3
$fullDestination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($fullDestination, $json, $utf8NoBom)
