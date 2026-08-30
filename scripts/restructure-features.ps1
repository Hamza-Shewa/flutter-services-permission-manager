# Restructures the Flutter Config Manager source into feature-based folders.
# Moves files (backend .ts + frontend .js) into core/ and features/ and rewrites
# every relative import specifier so the graph stays consistent.
$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path

# Map: OLD relative path (repo root) -> NEW relative path
$moves = [ordered]@{
  # core / constants
  'src/constants/index.ts'                          = 'src/core/constants/index.ts'
  'src/constants/versions.ts'                       = 'src/core/constants/versions.ts'
  # core / shared
  'src/shared/index.ts'                             = 'src/core/shared/index.ts'
  'src/shared/errors.ts'                            = 'src/core/shared/errors.ts'
  'src/shared/logging.ts'                           = 'src/core/shared/logging.ts'
  'src/shared/result.ts'                            = 'src/core/shared/result.ts'
  'src/shared/xml.ts'                               = 'src/core/shared/xml.ts'
  'src/shared/xml-parser.ts'                        = 'src/core/shared/xml-parser.ts'
  'src/shared/plist-parser.ts'                      = 'src/core/shared/plist-parser.ts'
  # core / types
  'src/types/index.ts'                              = 'src/core/types/index.ts'
  'src/types/permissions.ts'                        = 'src/core/types/permissions.ts'
  'src/types/services.ts'                           = 'src/core/types/services.ts'
  'src/types/save-context.ts'                       = 'src/core/types/save-context.ts'
  'src/types/webview.ts'                            = 'src/core/types/webview.ts'
  # core / utils
  'src/utils/debounce.ts'                           = 'src/core/utils/debounce.ts'
  'src/utils/exec.ts'                               = 'src/core/utils/exec.ts'
  'src/utils/file.ts'                               = 'src/core/utils/file.ts'
  'src/utils/extractors.ts'                         = 'src/features/permissions/extractor.ts'
  # core / providers + services
  'src/providers/sidebar.provider.ts'               = 'src/core/providers/sidebar.provider.ts'
  'src/services/workspace.ts'                       = 'src/core/workspace.service.ts'
  'src/services/document.service.ts'                = 'src/core/document.service.ts'
  'src/services/index.ts'                           = 'src/features/index.ts'
  # core / platform / android
  'src/services/android/index.ts'                   = 'src/core/platform/android/index.ts'
  'src/services/android/manifest.service.ts'        = 'src/core/platform/android/manifest.service.ts'
  'src/services/android/strings.service.ts'         = 'src/core/platform/android/strings.service.ts'
  # core / platform / ios
  'src/services/ios/index.ts'                       = 'src/core/platform/ios/index.ts'
  'src/services/ios/appdelegate.service.ts'         = 'src/core/platform/ios/appdelegate.service.ts'
  'src/services/ios/entitlements.service.ts'        = 'src/core/platform/ios/entitlements.service.ts'
  'src/services/ios/plist.service.ts'               = 'src/core/platform/ios/plist.service.ts'
  'src/services/ios/podfile.service.ts'             = 'src/core/platform/ios/podfile.service.ts'
  # features / permissions
  # (extractor.ts moved above from utils/extractors.ts)
  # features / services
  'src/services/android/intent-parser.ts'           = 'src/features/services/intent-parser.ts'
  'src/services/services-extractor.service.ts'      = 'src/features/services/extractor.service.ts'
  'src/services/service-validator.ts'               = 'src/features/services/validator.service.ts'
  # features / localization
  'src/services/android/localization.service.ts'    = 'src/features/localization/android.localization.service.ts'
  'src/services/android/string-resolver.ts'         = 'src/features/localization/string-resolver.ts'
  'src/services/ios/localization.service.ts'        = 'src/features/localization/ios.localization.service.ts'
  # features / build
  'src/services/build-file-utils.ts'                = 'src/features/build/build-file-utils.ts'
  'src/services/android/version-fetcher.ts'         = 'src/features/build/version-fetcher.ts'
  # features / migration
  'src/services/android/migration-transforms.ts'    = 'src/features/migration/migration-transforms.ts'
  'src/services/android/migration.service.ts'       = 'src/features/migration/migration.service.ts'
  # features / packages
  'src/services/pub.service.ts'                     = 'src/features/packages/pub.service.ts'
  # features / assets
  'src/services/assets.service.ts'                  = 'src/features/assets/assets.service.ts'
  # frontend / core
  'src/webview/frontend/state.js'                   = 'src/webview/frontend/core/state.js'
  'src/webview/frontend/api.js'                     = 'src/webview/frontend/core/api.js'
  'src/webview/frontend/bus.js'                     = 'src/webview/frontend/core/bus.js'
  'src/webview/frontend/elements.js'                = 'src/webview/frontend/core/elements.js'
  'src/webview/frontend/utils.js'                   = 'src/webview/frontend/core/utils.js'
  'src/webview/frontend/router.js'                  = 'src/webview/frontend/core/router.js'
  # frontend / features
  'src/webview/frontend/permissions.js'             = 'src/webview/frontend/features/permissions/permissions.js'
  'src/webview/frontend/services.js'                = 'src/webview/frontend/features/services/services.js'
  'src/webview/frontend/packages.js'                = 'src/webview/frontend/features/packages/packages.js'
  'src/webview/frontend/assets.js'                  = 'src/webview/frontend/features/assets/assets.js'
  'src/webview/frontend/localization.js'            = 'src/webview/frontend/features/localization/localization.js'
  'src/webview/frontend/build-details.js'           = 'src/webview/frontend/features/build/build-details.js'
}

function Join-All([string]$a, [string]$b) {
  return [System.IO.Path]::GetFullPath((Join-Path $a $b))
}

function To-Forward([string]$p) {
  return ($p -replace '\\', '/')
}

function Get-RelativeSpec([string]$fromDir, [string]$toFile) {
  $base = $fromDir.TrimEnd('\', '/') + '\'
  $fromUri = [System.Uri]::new($base)
  $toUri = [System.Uri]::new($toFile)
  $rel = [System.Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString())
  # Node16 ESM: TypeScript source files are imported via their .js sibling specifier
  if ($rel.EndsWith('.ts')) { $rel = $rel.Substring(0, $rel.Length - 3) + '.js' }
  if (-not ($rel.StartsWith('./') -or $rel.StartsWith('../'))) { $rel = './' + $rel }
  return $rel
}

# Build absolute lookup maps
$absToRel = @{}
$relToNewAbs = @{}
$oldAbsSet = @{}
foreach ($rel in $moves.Keys) {
  $oldAbs = [System.IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/', '\')))
  $absToRel[$oldAbs] = $rel
  $relToNewAbs[$rel] = [System.IO.Path]::GetFullPath((Join-Path $root (($moves[$rel]) -replace '/', '\')))
  $oldAbsSet[$oldAbs] = $true
}

# Resolve an old absolute path -> new absolute path (unchanged if not moved)
function Resolve-NewAbs([string]$oldAbs) {
  $candidates = @($oldAbs)
  if ($oldAbs.EndsWith('.js')) {
    $candidates += ($oldAbs.Substring(0, $oldAbs.Length - 3) + '.ts')
  }
  foreach ($c in $candidates) {
    if ($oldAbsSet.ContainsKey($c)) {
      $rel = $absToRel[$c]
      return $relToNewAbs[$rel]
    }
  }
  return $oldAbs
}

# Collect all files to process (ts + js under src, excluding fixtures/media/test-fixtures)
$files = Get-ChildItem -Path (Join-Path $root 'src') -Recurse -File |
  Where-Object { $_.Extension -in '.ts', '.js' } |
  Where-Object { $_.FullName -notmatch '\\(fixtures|media)\\' }

$importPattern = [regex]"from\s+(['""])([^'""]+)\1"

$movedCount = 0
$rewrittenCount = 0
$reports = @()

foreach ($f in $files) {
  $oldAbs = $f.FullName
  $newAbs = Resolve-NewAbs $oldAbs
  $oldDir = Split-Path $oldAbs -Parent
  $newDir = Split-Path $newAbs -Parent
  $text = [System.IO.File]::ReadAllText($oldAbs)

  $evaluator = {
    param($m)
    $quote = $m.Groups[1].Value
    $spec = $m.Groups[2].Value
    if (-not ($spec.StartsWith('./') -or $spec.StartsWith('../'))) {
      return $m.Value  # package import, leave as-is
    }
    # Resolve the import relative to the OLD dir, map to new target, then relativize from NEW dir
    $oldTarget = Join-All $oldDir $spec
    $newTarget = Resolve-NewAbs $oldTarget
    $newSpec = Get-RelativeSpec $newDir $newTarget
    return "from " + $quote + $newSpec + $quote
  }

  $newText = [string]$importPattern.Replace($text, $evaluator)
  if ($null -eq $newText) { $newText = $text }

  if ($oldAbs -ne $newAbs) {
    New-Item -ItemType Directory -Force -Path $newDir | Out-Null
    [System.IO.File]::WriteAllText($newAbs, $newText)
    Remove-Item -Force $oldAbs
    $movedCount++
    $relOld = To-Forward ($oldAbs.Substring($root.Length + 1))
    $relNew = To-Forward ($newAbs.Substring($root.Length + 1))
    $reports += "$relOld  ->  $relNew"
  } elseif ($newText -ne $text) {
    [System.IO.File]::WriteAllText($newAbs, $newText)
    $rewrittenCount++
    $relFile = To-Forward ($oldAbs.Substring($root.Length + 1))
    $reports += "rewrote imports in  $relFile"
  }
}

Write-Output "Moved: $movedCount files"
Write-Output "Import-rewritten in place: $rewrittenCount files"
Write-Output "--- Moves ---"
$reports | ForEach-Object { Write-Output $_ }
