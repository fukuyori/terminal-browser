# Version update checklist

- Set the default `Version` in `scripts/build-windows.ps1` to `X.Y.Z-win.N`.
- Update the current version and four-part installer example in `README.md` and `README.ja.md`.
- Add matching release entries to `CHANGELOG.md` and `CHANGELOG.ja.md`.
- Confirm `scripts/package-windows-inno.ps1` maps `X.Y.Z-win.N` to `X.Y.Z.N`.
- Keep `X.Y.Z-win.N` in both ZIP and EXE filenames and both manifests' `version`.
  The installer manifest's `installerVersion` holds the numeric `X.Y.Z.N`.
- Confirm `.github/workflows/release.yml` accepts the `X.Y.Z-win.N` release tag.
- Build the portable ZIP and Inno Setup installer with `-Sign`, without committing
  `dist-release`. Everything under `dist-release` is what gets signed and released, so
  building it is the maintainer's step, not one to automate away or hand to an assistant.
- Confirm `VERSION`, both manifests, artifact names, sizes, and SHA-256 hashes.
- Create and push the release tag only when explicitly requested. The release itself is
  built and attached by `.github/workflows/release.yml`.
