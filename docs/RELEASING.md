# Releasing

How a new version gets to <https://wwpcr.web.app> and to the Releases panel.

## 1. Bump the version (three places must agree - `npm test` checks them)

- `public/version.js` (`VERSION`)
- `package.json` (`version`)
- `CHANGELOG.md` (a new `## [x.y.z] - YYYY-MM-DD` section on top)

```bash
npm test
```

## 2. Build and deploy

```bash
npm run deploy      # sync-docs -> build the Windows exe (Go) -> zip + releases.json -> firebase deploy
```

`npm run release` alone builds `dist/WasteWaterPCRValidator-win-x64.exe` and writes
`public/downloads/WasteWaterPCRValidator-win-x64_vX.Y.Z.zip` and `public/releases.json`
(both are git-ignored; the Releases side panel reads `releases.json`).

Needs Node 18+, the Firebase CLI (logged in) and Go 1.22+ (downloaded into `build/toolchain` automatically if missing).

### Why the exe is shipped inside a zip

Firebase Hosting on the free **Spark** plan rejects executable files (`Executable files are forbidden on the Spark billing plan`), but a zip containing one is accepted.
To offer the bare `.exe`, attach it to a **GitHub Release** instead (Releases -> *Draft a new release* -> choose/create tag `vX.Y.Z` -> attach `dist/WasteWaterPCRValidator-win-x64.exe` and the zip).

## 3. Windows exe notes

- Built with Go (`desktop/go`), cross-compiled, about 2.8 MB, GUI subsystem (no console window).
- Not code-signed: Windows SmartScreen warns once. The SHA-256 is in the zip's `사용방법.txt` and in the Releases panel.
- `node tools/build-exe.mjs --arm64` builds a Windows-on-ARM variant, `--linux` a Linux binary for testing.

## 4. Making the repository public (checklist)

1. Run a last scan for personal data: names, e-mail addresses, institution names, real result files (`*.hwpx` / `*.xlsx` are git-ignored on purpose).
2. Review the commit history, not only the current files (`git log --all -p -S"<text>"`).
3. GitHub -> *Settings* -> *General* -> *Danger Zone* -> *Change repository visibility* -> *Make public*.
4. *About* (gear icon): Website `https://wwpcr.web.app`, a short description and topics (`bcov`, `rt-qpcr`, `wastewater`, `hwpx`, `standard-curve`).
