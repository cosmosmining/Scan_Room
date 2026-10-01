---
name: Field test bug
about: Something wrong on the iPad or the web during a test session
title: "[field] "
labels: field-test
---

<!-- One problem per issue. Chinese or English is fine. 中文或英文都可以。 -->

**Severity / 嚴重度** (see docs/TESTING-PLAN.md §6): P0 / P1 / P2 / P3

**Area / 項目**: walls & floor plan · columns · glass / openings · sockets · furniture · handoff code · web editor · 3D / render · performance · other

**What happened / 發生了什麼**


**What should have happened / 應該是什麼**


**Steps / 步驟**
1.
2.

**Build & device / 版本與裝置**
- App build (git commit, Settings → About, or the TestFlight build number):
- iPad model / iOS version:
- Web browser (if web):
- Room ID from the field log (e.g. TPE-03):

**Evidence / 證據** — attach all that apply
- [ ] Screenshot or screen recording
- [ ] The scan file (Floorplan screen → Share scan → .json)
- [ ] The room's truth.json (tape/laser measurements)
- [ ] `node scripts/scan-accuracy.mjs <scan> <truth>` output
- [ ] Detection ms/frame shown during the scan:
- [ ] Handoff code (if the problem is on the web):
