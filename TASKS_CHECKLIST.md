# ROADMAP TASKS CHECKLIST

## Phase 1 — Foundation Hardening (Weeks 1–2)
- [x] Task 1.1 — Replace regex-based XML parsing with `fast-xml-parser`
- [x] Task 1.2 — Replace regex-based plist parsing with a `PlistDocument` class
- [x] Task 1.3 — Fix the `savePermissions()` 14-parameter explosion
- [x] Task 1.4 — Eliminate all `as any` casts in `initializer.ts`
- [x] Task 1.5 — Replace hardcoded version strings in migration service
- [x] Task 1.6 — Normalize error handling across all `catch` blocks
- [x] Task 1.7 — Fix indentation inconsistency in `workspace.ts` line 26

## Phase 2 — Architecture Refactor (Weeks 3–4)
- [ ] Task 2.1 — Split `webview.js` into ES modules
- [ ] Task 2.2 — Introduce a typed `MessageBus` for extension ↔ webview communication
- [ ] Task 2.3 — Extract `services-extractor.service.ts` sub-concerns
- [ ] Task 2.4 — Add file watcher for auto-refresh on external edits
- [ ] Task 2.5 — Add input validation before file write in service handlers

## Phase 3 — Test Coverage & DX (Week 4, overlap)
- [ ] Task 3.1 — Create fixture files for regression testing
- [ ] Task 3.2 — Unit tests for `manifest.service.ts`
- [ ] Task 3.3 — Unit tests for `plist.service.ts`
- [ ] Task 3.4 — Unit tests for `podfile.service.ts`
- [ ] Task 3.5 — Extract and unit-test `document.service.ts` build file helpers
- [ ] Task 3.6 — Configure code coverage thresholds

## Phase 4 — New Features: pubspec Editor + Diagnostics (Week 5)
- [ ] Task 4.1 — pubspec.yaml Visual Editor (new "pubspec" tab)
- [ ] Task 4.2 — Android Build Diagnostics Dashboard (new "Diagnostics" tab)
- [ ] Task 4.3 — Flutter Feature Flags Viewer

## Phase 5 — New Features: Flavors + CI/CD (Week 6)
- [ ] Task 5.1 — Build Flavor / Environment Manager (new "Flavors" tab)
- [ ] Task 5.2 — CI/CD Workflow Generator (new "CI/CD" tab)

## Technical Debt
- [ ] TD-01: `services-extractor.service.ts` console.log() replacement
- [ ] TD-02: `manifest.service.ts` mainActivityRegex ReDoS risk
- [ ] TD-03: `plist.service.ts` buildApplinksPlistBlock() template literal fix
- [ ] TD-04: `migration.service.ts` plugin versions hardcoded (covered in Task 1.5)
- [ ] TD-05: `document.service.ts` unused domain variable in AASA map() body
- [ ] TD-06: `pub.service.ts` any type in map callback
- [ ] TD-07: `initializer.ts` Android localizations silent override
- [ ] TD-08: `workspace.ts` concurrent findFiles() batching
- [ ] TD-09: `plist.service.ts` baseIndent duplication
- [ ] TD-10: `manifest.service.ts` remove /i flag
