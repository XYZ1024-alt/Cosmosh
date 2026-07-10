<#
.SYNOPSIS
Audits the Authenticode signatures of Windows release executables.

.DESCRIPTION
Checks both the distributable installer and the packaged Cosmosh executable. Audit mode records missing or invalid signatures without blocking an unsigned draft. Enforce mode fails unless every target has a valid trusted signature, a timestamp certificate, and the configured publisher identity.

.PARAMETER Policy
Controls whether invalid signatures produce warnings (`audit`) or terminate the release (`enforce`).

.PARAMETER ReleaseDirectory
The electron-builder output directory containing the installer and unpacked application.

.PARAMETER ExpectedPublisher
The exact Authenticode signer certificate subject required by enforce mode.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('audit', 'enforce')]
    [string]$Policy,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory,

    [string]$ExpectedPublisher = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Policy -eq 'enforce' -and [string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
    throw 'ExpectedPublisher is required when the Windows signing policy is enforce.'
}

$resolvedReleaseDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$installerFiles = @(Get-ChildItem -LiteralPath $resolvedReleaseDirectory -File -Filter '*.exe')
$applicationFiles = @(
    Get-ChildItem -LiteralPath $resolvedReleaseDirectory -Recurse -File -Filter 'Cosmosh.exe' |
        Where-Object { $_.Directory.Name -match '^win(?:-.+)?-unpacked$' }
)
$targetFiles = @(($installerFiles + $applicationFiles) | Sort-Object -Property FullName -Unique)

if ($targetFiles.Count -eq 0) {
    throw "No Windows installer or packaged Cosmosh executable was found under $resolvedReleaseDirectory."
}

$failedFiles = [System.Collections.Generic.List[string]]::new()
$summaryRows = [System.Collections.Generic.List[string]]::new()

foreach ($targetFile in $targetFiles) {
    $signature = Get-AuthenticodeSignature -LiteralPath $targetFile.FullName
    $hasValidSignature = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
    $hasTimestamp = $null -ne $signature.TimeStamperCertificate
    $signer = if ($null -ne $signature.SignerCertificate) {
        $signature.SignerCertificate.Subject
    } else {
        'none'
    }
    $publisherMatches = if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) {
        'not-configured'
    } else {
        ($signer -ceq $ExpectedPublisher).ToString().ToLowerInvariant()
    }
    $relativePath = [System.IO.Path]::GetRelativePath($resolvedReleaseDirectory, $targetFile.FullName)
    $summaryRows.Add("| $relativePath | $($signature.Status) | $hasTimestamp | $publisherMatches | $($signer.Replace('|', '\|')) |")

    if (
        -not $hasValidSignature -or
        -not $hasTimestamp -or
        (-not [string]::IsNullOrWhiteSpace($ExpectedPublisher) -and $signer -cne $ExpectedPublisher)
    ) {
        $failedFiles.Add($relativePath)
    }
}

if ($env:GITHUB_STEP_SUMMARY) {
    $summary = @(
        '### Windows code-signing audit'
        ''
        "Policy: ``$Policy``"
        ''
        '| File | Signature | Timestamp | Publisher match | Signer |'
        '| --- | --- | --- | --- | --- |'
    ) + $summaryRows
    [System.IO.File]::AppendAllLines($env:GITHUB_STEP_SUMMARY, $summary)
}

if ($failedFiles.Count -eq 0) {
    Write-Host "Validated Authenticode signatures, timestamps, and publisher identity for $($targetFiles.Count) Windows release executables."
    exit 0
}

$failureMessage = "Windows signature validation failed for: $($failedFiles -join ', ')."
if ($Policy -eq 'enforce') {
    throw $failureMessage
}

Write-Warning "$failureMessage The audit policy allows this unsigned draft to continue."
