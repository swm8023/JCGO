# Nginx Certificate Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the nightly import of the QNAP certificate into the local Nginx deployment and provide an administrator-run installer for a daily 02:30 elevated scheduled task.

**Architecture:** Extend the existing local certificate-sync script so it authenticates to the NAS non-interactively, validates and atomically deploys the certificate material, and records secret-free logs. Add a separate installer script that registers a `SYSTEM`-run Task Scheduler job at 02:30; the installer itself requires elevation and is run manually once by the operator.

**Tech Stack:** PowerShell 7, PuTTY `plink.exe`/`pscp.exe`, Windows Task Scheduler, Windows Service Control Manager, Nginx for Windows, QNAP SSH.

---

### Task 1: Make the certificate sync script non-interactive and safe to schedule

**Files:**
- Modify: `D:\Nginx\sync-wheelmaker-cert.ps1`
- Create: `D:\Nginx\logs\certificate-sync.log` (at runtime)

- [ ] **Step 1: Add a syntax-and-behaviour test entry point**

Add `[CmdletBinding()]` and a `[switch]$ValidateOnly` parameter. `-ValidateOnly` must connect to the NAS, download the certificate into a unique temporary directory, validate the leaf subject, expiry, and private-key match, then exit without touching `D:\Nginx\cert` or Nginx.

- [ ] **Step 2: Verify the validation-only command fails before the change**

Run:

```powershell
pwsh -NoProfile -File D:\Nginx\sync-wheelmaker-cert.ps1 -ValidateOnly
```

Expected: the current script prompts for a password instead of supporting unattended validation.

- [ ] **Step 3: Replace the interactive password path with the approved local secret**

Remove `Read-PasswordPlainText`. Define the NAS password as a local literal in the script (the value supplied by the operator in this conversation), and pass it only as the `-pw` argument to `plink.exe` and `pscp.exe`. Do not write the password, command lines, or raw PEM content to host output or the log.

Change the remote certificate directory to `/etc/stunnel`, matching the active QNAP configuration discovered during diagnosis. Resolve `plink.exe` and `pscp.exe` from explicit existing Scoop shim paths, and fail with a clear log message if either executable is absent.

- [ ] **Step 4: Add log, staging, rollback, and deployment guards**

Implement `Write-Log` to append timestamped, secret-free lines to `D:\Nginx\logs\certificate-sync.log`. Keep downloads in a GUID-named temporary directory. Before replacing `fullchain.pem`, `privkey.pem`, and `uca.pem`, back up those three files beneath `D:\Nginx\cert\backup-<timestamp>`. If Nginx configuration validation fails, restore all three files from that backup and record the rollback.

The successful deployment flow is:

```text
download stunnel.pem + uca.pem
  -> verify expected subject, future expiry, and matching RSA key
  -> generate fullchain.pem and privkey.pem
  -> back up current Nginx certificate files
  -> deploy new files
  -> nginx.exe -t
  -> reload; if reload is denied, Restart-Service nginx
  -> inspect the served certificate on 127.0.0.1:28802
```

- [ ] **Step 5: Verify script parsing and validation-only behaviour**

Run:

```powershell
pwsh -NoProfile -Command "[scriptblock]::Create([IO.File]::ReadAllText('D:\Nginx\sync-wheelmaker-cert.ps1')) | Out-Null; 'parse ok'"
pwsh -NoProfile -File D:\Nginx\sync-wheelmaker-cert.ps1 -ValidateOnly
```

Expected: `parse ok`; the validation run logs the inspected certificate subject and future expiry, leaves the live certificate files unchanged, and does not reveal the NAS password.

### Task 2: Add the elevated scheduled-task installer

**Files:**
- Create: `D:\Nginx\install-wheelmaker-cert-sync-task.ps1`
- Modify: `D:\Nginx\sync-wheelmaker-cert.ps1`

- [ ] **Step 1: Add a failing installer preflight**

Define the expected task contract before registration:

```powershell
$taskName = 'JCGO-NginxCertificateSync'
$taskPath = '\JCGO\'
$runAt = [datetime]::Today.AddHours(2).AddMinutes(30)
```

The installer must refuse a non-elevated session, refuse a missing sync script, and report the exact administrator command needed to retry.

- [ ] **Step 2: Implement task registration**

Use `New-ScheduledTaskAction` to call `powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\Nginx\sync-wheelmaker-cert.ps1`. Ensure the `\JCGO\` Task Scheduler folder exists first (using the Task Scheduler COM service when it is absent). Use `New-ScheduledTaskTrigger -Daily -At 02:30`, a `SYSTEM` principal with `RunLevel Highest`, and settings that start the task when the schedule was missed and retry after failure. Register under `\JCGO\JCGO-NginxCertificateSync`, replacing only that exact existing task if present.

- [ ] **Step 3: Protect the scripts containing the local secret**

At installation time, remove inherited ACLs from both scripts and grant read/execute only to `SYSTEM` and the local Administrators group. Verify the resulting access rules before registering the task. Keep the certificate log readable to Administrators but do not grant normal users access to the sync script.

- [ ] **Step 4: Verify installer syntax and task definition**

Run in an elevated PowerShell session:

```powershell
pwsh -NoProfile -File D:\Nginx\install-wheelmaker-cert-sync-task.ps1
Get-ScheduledTask -TaskPath '\JCGO\' -TaskName 'JCGO-NginxCertificateSync' | Select-Object TaskName,TaskPath,State
Get-ScheduledTaskInfo -TaskPath '\JCGO\' -TaskName 'JCGO-NginxCertificateSync'
```

Expected: the task exists, has a daily 02:30 trigger, runs as `SYSTEM` with highest privileges, and reports no previous failure before its first scheduled run.

### Task 3: Exercise the deployed task and preserve recovery evidence

**Files:**
- Verify: `D:\Nginx\sync-wheelmaker-cert.ps1`
- Verify: `D:\Nginx\install-wheelmaker-cert-sync-task.ps1`
- Verify: `D:\Nginx\logs\certificate-sync.log`

- [ ] **Step 1: Run one controlled task invocation**

Run in an elevated PowerShell session:

```powershell
Start-ScheduledTask -TaskPath '\JCGO\' -TaskName 'JCGO-NginxCertificateSync'
Start-Sleep -Seconds 15
Get-ScheduledTaskInfo -TaskPath '\JCGO\' -TaskName 'JCGO-NginxCertificateSync'
Get-Content D:\Nginx\logs\certificate-sync.log -Tail 50
```

Expected: `LastTaskResult` is `0`; the log contains download, validation, backup, Nginx validation, reload/restart, and served-certificate verification messages without any password or PEM body.

- [ ] **Step 2: Verify the certificate presented by the JCGO HTTPS entry point**

Run:

```powershell
curl.exe -k -sS -D - -o NUL https://127.0.0.1:28802/
```

Use the sync log's served-certificate subject and expiry as the assertion. Expected: the endpoint remains reachable and the logged served certificate matches the NAS certificate downloaded in this task run.

- [ ] **Step 3: Retain only intentional recovery data**

Confirm that the temporary download directory was removed, the timestamped certificate backup remains in `D:\Nginx\cert`, and the task installer did not modify any unrelated scheduled task.
