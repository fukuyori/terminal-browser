#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="${PIXEL_DIR:-$ROOT/../pixel}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 ;;
  Darwin-x86_64) TARGET=darwin-x64 ;;
  Linux-x86_64|Linux-amd64) TARGET=linux-x64 ;;
  Linux-aarch64|Linux-arm64) TARGET=linux-arm64 ;;
  *) echo "unsupported host: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

# ./scripts/link-pixel.sh --unlink [version]   (version defaults to PIXEL_VERSION or the latest tag)
if [ "${1:-}" = "--unlink" ]; then
  VERSION="${2:-${PIXEL_VERSION:-latest}}"
  node -e '
    const fs = require("fs");
    const version = process.argv[1];
    for (const file of ["browser/package.json", "cli/package.json"]) {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      pkg.dependencies["@zenbu-labs/pixel"] = version;
      fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    }
    const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
    if (root.pnpm) { delete root.pnpm.overrides; if (!Object.keys(root.pnpm).length) delete root.pnpm; }
    fs.writeFileSync("package.json", JSON.stringify(root, null, 2) + "\n");
  ' "$VERSION"
  cd "$ROOT" && pnpm install
  echo "back on the npm release of pixel ($VERSION)"
  exit 0
fi

LIB="$(cd "$LIB" && pwd)"
[ -f "$LIB/packages/pixel/package.json" ] || { echo "no pixel checkout at $LIB (set PIXEL_DIR)" >&2; exit 1; }

(cd "$LIB" && pnpm --filter @zenbu-labs/pixel build && pnpm --filter @zenbu-labs/pixel build:native -- --release)

# file: copies the package into node_modules, so its imports of react and electron
# resolve here rather than in the library repo (a symlink would give two Reacts).
node -e '
  const fs = require("fs"), path = require("path");
  const lib = process.argv[1], target = process.argv[2];
  const rel = (from, to) => "file:" + path.relative(path.resolve(from), to);
  for (const file of ["browser/package.json", "cli/package.json"]) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.dependencies["@zenbu-labs/pixel"] = rel(path.dirname(file), `${lib}/packages/pixel`);
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  }
  const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
  root.pnpm = root.pnpm ?? {};
  root.pnpm.overrides = { ...(root.pnpm.overrides ?? {}), [`@zenbu-labs/pixel-native-${target}`]: rel(".", `${lib}/packages/native/${target}`) };
  fs.writeFileSync("package.json", JSON.stringify(root, null, 2) + "\n");
' "$LIB" "$TARGET"
cd "$ROOT" && pnpm install
echo "linked to $LIB (package.json now points at it; ./scripts/link-pixel.sh --unlink to go back)"
