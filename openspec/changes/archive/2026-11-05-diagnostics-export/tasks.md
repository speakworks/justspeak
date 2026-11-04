## 1. Pure diagnostics model

- [x] 1.1 Redaction: home/userData placeholders, `Bearer` token masking
- [x] 1.2 Summary builder: app/runtime/preferences/permissions with no secrets
- [x] 1.3 Bundle entry list and README text are explicit (no userData copy)

## 2. Logging and crash dumps

- [x] 2.1 `DiagnosticsLog`: append, size rotation, serialized writes, flush
- [x] 2.2 Console tee keeps terminal output and never throws into callers
- [x] 2.3 `crashReporter.start({ uploadToServer: false })` before app ready

## 3. Export

- [x] 3.1 Collect summary, logs, and capped recent crash dumps
- [x] 3.2 Staging directory + `zip` archive + cleanup on failure
- [x] 3.3 Save dialog; cancel returns without writing; dev-only path override
- [x] 3.4 IPC `diagnostics:export` with trusted-sender check and single-flight

## 4. UI

- [x] 4.1 Settings action "导出诊断" with busy/success/failure feedback
- [x] 4.2 Preload API and shared result type

## 5. Verification

- [x] 5.1 Unit tests: redaction, summary, rotation, dump cap, symlink rejection, endpoint-leak, cancel, atomic overwrite, zip contents
- [x] 5.2 E2E: dev export writes a zip containing summary/logs/README and no history/audio/key
- [x] 5.3 `pnpm typecheck`, `pnpm test`, `pnpm build`, E2E, `openspec validate --strict`
- [x] 5.4 Documentation: PRODUCT-FEEDBACK item 6, PRIVACY-SECURITY, settings copy

## 6. Not included

- [ ] 6.1 Upload endpoint or automatic crash upload
- [ ] 6.2 Renderer console forwarding
