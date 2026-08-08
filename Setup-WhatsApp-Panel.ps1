$ErrorActionPreference = "Stop"

# ============================================================
# Whats App Panel - One Click Project Foundation
# ============================================================

$ProjectRoot = "C:\DP\Whats App Panel"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Whats App Panel - Project Setup" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- Helpers ----------
function Ensure-Directory($Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Host "Created: $Path" -ForegroundColor Green
    } else {
        Write-Host "Exists : $Path" -ForegroundColor DarkGray
    }
}

function Ensure-File($Path, $Content = "") {
    if (-not (Test-Path -LiteralPath $Path)) {
        Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
        Write-Host "Created: $Path" -ForegroundColor Green
    } else {
        Write-Host "Exists : $Path" -ForegroundColor DarkGray
    }
}

# ---------- Validate root ----------
Ensure-Directory $ProjectRoot
Set-Location -LiteralPath $ProjectRoot

# ---------- Directories ----------
$directories = @(
    "src",
    "frontend",
    "config",
    "data",
    "data\schemas",
    "memory",
    "docs",
    "tests"
)

foreach ($dir in $directories) {
    Ensure-Directory (Join-Path $ProjectRoot $dir)
}

# ---------- Project memory ----------
$memoryFiles = @{
    "memory\PROJECT_MEMORY.md" = @"
# Whats App Panel — Project Memory

## Project
Multi-number WhatsApp CRM / panel.

## Local Root
C:\DP\Whats App Panel

## Current Phase
Phase 0 — Engineering foundation.

## Agreed Direction
- Multi-number WhatsApp Business / WABA architecture.
- Meta Business Portfolio already exists.
- WABA exists for each WhatsApp number.
- Google environment will be used as the initial platform.
- Access model can be based on the Google access available to the project.
- Conversations should remain unread until the assigned user has responded.
- Round-robin assignment and other CRM behaviors will be documented before implementation.

## Source of Truth
The files under memory\ and docs\ are the engineering context for future coding agents.

## Important Rule
Do not silently change architecture or business rules. Record material decisions in DECISIONS.md.
"@

    "memory\ARCHITECTURE.md" = @"
# Architecture

## Status
Initial foundation. Detailed architecture is maintained in docs\REQUIREMENTS.md and related specification files.

## Planned Logical Areas
1. WhatsApp / Meta integration
2. Webhook ingestion
3. Conversation and message storage
4. Agent assignment / round robin
5. Frontend CRM panel
6. Templates
7. Authentication / authorization
8. Audit and operational logging
9. Future Zoho integration

## Principle
Keep external integrations isolated from core business logic so providers can be changed without rewriting the CRM domain.
"@

    "memory\DECISIONS.md" = @"
# Architecture & Product Decisions

| Date | Decision | Status |
|------|----------|--------|
| 2026-08-08 | Use Google environment as the initial platform direction | Accepted |
| 2026-08-08 | Support multiple WhatsApp numbers / WABAs | Accepted |
| 2026-08-08 | Existing Meta Business Portfolio and WABAs will be used | Accepted |
| 2026-08-08 | Keep conversations unread until the assigned user responds | Accepted |
"@

    "memory\CHANGELOG.md" = @"
# Changelog

## 2026-08-08
- Created initial project foundation.
- Created memory and documentation structure.
- Added baseline Git / CLASP project files.
"@

    "memory\CODEX_CONTEXT.md" = @"
# Codex / Claude Code Context

## Project Root
C:\DP\Whats App Panel

## Read First
1. memory\PROJECT_MEMORY.md
2. memory\ARCHITECTURE.md
3. memory\DECISIONS.md
4. docs\REQUIREMENTS.md
5. docs\DATABASE.md
6. docs\API.md
7. docs\WEBHOOK.md
8. docs\SECURITY.md
9. docs\ROUND_ROBIN.md
10. docs\TEMPLATES.md
11. docs\UI_SPECIFICATION.md
12. docs\ZOHO_PHASE_2.md

## Coding Rule
Before implementing a feature:
- inspect existing files;
- preserve established architecture;
- update relevant documentation when behavior changes;
- record material architectural decisions in memory\DECISIONS.md;
- update memory\CHANGELOG.md for meaningful milestones.

## Do Not Assume
Credentials, Meta tokens, WABA IDs, phone numbers, Google project IDs, database IDs, or production URLs must not be invented.
"@
}

foreach ($item in $memoryFiles.GetEnumerator()) {
    Ensure-File (Join-Path $ProjectRoot $item.Key) $item.Value
}

# ---------- Documentation ----------
$docFiles = @(
    "docs\REQUIREMENTS.md",
    "docs\DATABASE.md",
    "docs\API.md",
    "docs\WEBHOOK.md",
    "docs\SECURITY.md",
    "docs\ROUND_ROBIN.md",
    "docs\TEMPLATES.md",
    "docs\UI_SPECIFICATION.md",
    "docs\ZOHO_PHASE_2.md"
)

foreach ($file in $docFiles) {
    $title = [System.IO.Path]::GetFileNameWithoutExtension($file)
    $content = "# $title`r`n`r`nStatus: Initial specification placeholder.`r`n`r`nThis document will be expanded from the agreed project architecture before implementation.`r`n"
    Ensure-File (Join-Path $ProjectRoot $file) $content
}

# ---------- Schemas / config placeholders ----------
Ensure-File (Join-Path $ProjectRoot "data\schemas\.gitkeep")
Ensure-File (Join-Path $ProjectRoot "src\.gitkeep")
Ensure-File (Join-Path $ProjectRoot "frontend\.gitkeep")
Ensure-File (Join-Path $ProjectRoot "config\.gitkeep")
Ensure-File (Join-Path $ProjectRoot "tests\.gitkeep")

# ---------- Git files ----------
$gitignore = @"
# Secrets
.env
.env.*
!.env.example
*.secret
secrets/
credentials/
token*.json

# Node
node_modules/
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Build
dist/
build/
coverage/

# Local / OS
.DS_Store
Thumbs.db
.vscode/
.idea/

# CLASP
.clasp.json
.claspignore

# Temporary
tmp/
temp/
"@

Ensure-File (Join-Path $ProjectRoot ".gitignore") $gitignore

$envExample = @"
# Copy to .env only when environment variables are required.
# Never commit real credentials.

META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=
META_ACCESS_TOKEN=
GOOGLE_PROJECT_ID=
"@
Ensure-File (Join-Path $ProjectRoot ".env.example") $envExample

$claspignore = @"
node_modules/**
.git/**
.gitignore
.env
.env.*
tests/**
docs/**
memory/**
frontend/**
"@
Ensure-File (Join-Path $ProjectRoot ".claspignore") $claspignore

$readme = @"
# Whats App Panel

Multi-number WhatsApp CRM / panel project.

## Project Structure

- src — application / Apps Script source
- frontend — frontend assets
- config — environment/configuration
- data — data definitions and schemas
- memory — persistent engineering context
- docs — specifications
- tests — automated tests

## Setup

Run `Setup-WhatsApp-Panel.bat` from this project directory to initialize the foundation.

## Engineering Context

Read `memory\CODEX_CONTEXT.md` before making implementation changes.
"@
Ensure-File (Join-Path $ProjectRoot "README.md") $readme

# ---------- Git initialization ----------
Write-Host ""
Write-Host "Checking Git..." -ForegroundColor Cyan
$git = Get-Command git -ErrorAction SilentlyContinue

if ($git) {
    if (-not (Test-Path (Join-Path $ProjectRoot ".git"))) {
        git init
        Write-Host "Git repository initialized." -ForegroundColor Green
    } else {
        Write-Host "Git repository already exists." -ForegroundColor DarkGray
    }

    git branch -M main 2>$null
} else {
    Write-Host "WARNING: Git is not installed or not in PATH." -ForegroundColor Yellow
}

# ---------- CLASP detection ----------
Write-Host ""
Write-Host "Checking CLASP..." -ForegroundColor Cyan
$clasp = Get-Command clasp -ErrorAction SilentlyContinue

if ($clasp) {
    Write-Host "CLASP detected: $(& clasp --version)" -ForegroundColor Green
    Write-Host ""
    $createClasp = Read-Host "Create/link the Google Apps Script project now? (Y/N)"

    if ($createClasp -match '^[Yy]$') {
        Write-Host ""
        Write-Host "If CLASP authentication is required, follow the browser login." -ForegroundColor Yellow

        if (-not (Test-Path (Join-Path $ProjectRoot ".clasp.json"))) {
            Write-Host "Creating a standalone Apps Script project..." -ForegroundColor Cyan
            clasp create --type standalone --title "Whats App Panel" --rootDir $ProjectRoot
        } else {
            Write-Host ".clasp.json already exists; skipping clasp create." -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "CLASP not found. This is OK for Step 0.1." -ForegroundColor Yellow
    Write-Host "Install later with: npm install -g @google/clasp" -ForegroundColor Yellow
}

# ---------- Git status ----------
if ($git) {
    Write-Host ""
    Write-Host "Git status:" -ForegroundColor Cyan
    git status --short

    Write-Host ""
    $doCommit = Read-Host "Create initial Git commit now? (Y/N)"
    if ($doCommit -match '^[Yy]$') {
        git add .
        git commit -m "chore: initialize Whats App Panel project"
        Write-Host "Initial commit created." -ForegroundColor Green
    }
}

# ---------- Optional GitHub remote ----------
if ($git) {
    Write-Host ""
    $remote = git remote get-url origin 2>$null
    if (-not $remote) {
        Write-Host "GitHub remote is not configured yet." -ForegroundColor Yellow
        $repoUrl = Read-Host "Paste GitHub repository URL (or press Enter to skip)"

        if ($repoUrl.Trim() -ne "") {
            git remote add origin $repoUrl.Trim()
            Write-Host "GitHub origin added." -ForegroundColor Green

            $doPush = Read-Host "Push main branch to GitHub now? (Y/N)"
            if ($doPush -match '^[Yy]$') {
                git push -u origin main
            }
        }
    } else {
        Write-Host "GitHub origin: $remote" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " SETUP COMPLETE" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Project: $ProjectRoot"
Write-Host ""
Write-Host "Next recommended step:"
Write-Host "1. Review memory\CODEX_CONTEXT.md"
Write-Host "2. Fill the docs\ specifications"
Write-Host "3. Connect/configure CLASP if not done"
Write-Host "4. Create/configure the GitHub repository"
Write-Host ""
Read-Host "Press Enter to close"
