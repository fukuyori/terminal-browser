# Version update checklist

- Set the default `Version` in `scripts/build-windows.ps1` to `X.Y.Z-win.N`.
- Update the current version and four-part installer example in the README.
- Confirm `scripts/package-windows-inno.ps1` maps `X.Y.Z-win.N` to `X.Y.Z.N`.
- Confirm `.github/workflows/release.yml` accepts the `X.Y.Z-win.N` release tag.
- Build the portable ZIP and Inno Setup installer without committing `dist-release`.
- Confirm `VERSION`, both manifests, artifact names, sizes, and SHA-256 hashes.
- Create and push the release tag only when explicitly requested.
