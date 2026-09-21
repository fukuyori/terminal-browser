# upstream v0.11.1 移行計画

Windows 対応フォーク (`windows-native`) を upstream `zenbu-labs/terminal-browser` v0.11.1 に追従させるための計画。

## 調査時点のリビジョン

| 対象 | リビジョン |
|---|---|
| フォーク `windows-native` | `efe5aa8`（2026-09-04） |
| upstream v0.11.1 | `6d68234`（2026-09-17） |
| 分岐点 | `8bf4675`（upstream v0.8.0、フォークは `018793a` でマージ済み） |
| `zenbu-labs/pixel` v0.0.15 | `920d517`（2026-09-16） |

分岐点から v0.11.1 までの upstream の変更は 35 コミット、233 ファイル、+3,616 / −43,507 行。

## 判明している前提

### エンジンが別リポジトリに移った

v0.11.1 の `179d87e Terminal electron port (#104)` で、次の 2 つが terminal-browser から削除された。

- `engine/`（Rust の pixel-core / pixel-node / pixel-react）
- `terminals/`（端末検出パッケージ）

移動先は `zenbu-labs/pixel` で、terminal-browser からは npm パッケージ `@zenbu-labs/pixel@0.0.15` として参照される。ネイティブバイナリはプラットフォーム別パッケージ `@zenbu-labs/pixel-native-<target>` で配布される。

| フォークでの場所 | 移動先 |
|---|---|
| `engine/crates/pixel-core/**`、`engine/crates/pixel-node/**` | pixel の `engine/crates/**`（パスは同じ） |
| `engine/packages/pixel-react/scripts/build-native.mjs` | pixel の `packages/pixel/scripts/build-native.mjs` |
| `terminals/src/shared.ts`、`run.ts`、`index.ts` | pixel の `packages/pixel/src/terminal/` |
| `terminals/src/terminals/wezterm.ts` | pixel の `packages/pixel/src/terminal/terminals/wezterm.ts` |
| `browser/src/page/input.ts` | pixel の `packages/pixel/src/web/input.ts` |
| `cli/src/ssh.ts` | pixel の `packages/pixel/src/ssh/index.ts` |
| `terminals/test/shell-safety.test.js`、`terminals/test/terminals.test.js`、`cli/test/ssh.test.js` | pixel の `packages/pixel/test/`（同名のファイルが既にある） |

import の対応はほぼ 1 対 1。

| フォーク | v0.11.1 |
|---|---|
| `pixel-react`（35 箇所） | `@zenbu-labs/pixel`（34 箇所） |
| `pixel-terminals`（14 箇所） | `@zenbu-labs/pixel/terminal`（16 箇所） |
| `./ssh` | `@zenbu-labs/pixel/ssh` |

### pixel は Windows に対応していない

- `packages/native/` にあるのは `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64` のみ
- `electron/config.json` と `.github/workflows/release.yml` の対象も macOS と Linux のみ
- `packages/pixel/scripts/postinstall.mjs` はプラットフォーム表にない環境で `exit 1` する。この判定は `PIXEL_SKIP_DOWNLOAD` の確認より前にあるため、**v0.11.1 は Windows では `pnpm install` の時点で失敗する**
- `postinstall.mjs` は展開に `unzip` を使うが、Windows には標準で存在しない
- `packages/pixel/scripts/build-native.mjs` はライブラリ名を `libpixel_node.dylib` / `libpixel_node.so` のみ扱う

### pixel の起動処理が Unix 前提

アプリの起動は `packages/pixel/src/bin.ts` が行う。

- `ownTty()` は `tty` コマンドを実行し、結果が `/dev/` で始まらなければ失敗する。`PIXEL_TTY` が設定されていればそちらを使う
- `electronBinary()` は `electron/dist/.zenbu-electron-sha256` が無ければ失敗し、実行ファイルを `electron/dist/pixel`（macOS は `Electron.app/Contents/MacOS/pixel`）として探す。標準の Windows 版 Electron の実行ファイルは `electron.exe`
- 端末の tty を `findOwner(tty)`・`waitForOwners(tty)` に渡し、既に同じ端末で動いているインスタンスを探す
- 所有者がいなければ `checkTerminal(detect())` で端末のグラフィックス対応を調べる
- Electron は `stdio: ["inherit", "inherit", <ログファイル>]` で起動され、stderr は `~/.local/state/pixel/logs/<アプリ名>.stderr.log`（`XDG_STATE_HOME` があればその下）に追記される

### インスタンス登録が Unix ソケット前提

- `packages/pixel/src/root.tsx` はソケットを `~/.local/state/pixel/instances/<tty を記号置換したもの>.sock` というファイルパスで作る
- `packages/pixel/src/host/server.ts` はそのパスに対して `fs.rmSync` → `fs.mkdirSync(path.dirname(...))` → `listen` を行い、終了時にも `fs.rmSync` する。Windows の `net` はファイルパスで待ち受けできず、名前付きパイプ（`\\.\pipe\...`）が要る。フォークでは `store/src/paths.ts` の `ipcEndpoint` と、`registry.ts`・`daemon.ts` の `process.platform !== "win32"` ガードで同じ問題を解決している
- `packages/pixel/src/instances.ts` の 79 行目は `!alive(record.pid) || !fs.existsSync(record.socket)` のとき登録を削除する
- Rust 側の `engine/crates/pixel-core/src/hosted.rs` も `std::os::unix::net::UnixStream` でホストへ接続する。`lib.rs` はこのモジュールを無条件で読み込み、`terminal.rs` の `Terminal::join_host`・`join_embedded` が使うため、JavaScript 側のパスを名前付きパイプに変えるだけでは Windows 対応にならない
- `hosted.rs` の関連テストも `UnixListener` を使う。現フォークの `lib.rs` のガードは `herdr` の切り替えを扱うもので、この新しい Unix 依存への対応は別途必要

`fs.existsSync` を名前付きパイプに使ったときの挙動は実測した。Node 24.14.1 で待ち受け中のパイプに対して `fs.existsSync` は `true`、`fs.statSync` は `EBUSY` を返した。この環境では稼働中のインスタンスを誤って削除しない。ただし実際に使われる Node（CLI 側）と Electron 44.2.0 内蔵の Node では未確認。

### Claude Code ブリッジにも Windows 対応が必要

v0.11.1 の `cli/src/claude-bridge.ts` には、Windows ではそのまま使えない次の処理がある。

- `launch`（53 行目〜）が一時ディレクトリ内の `cc-browser-*.sock` というファイルパスを作る（59 行目）。`Bridge` クラスの `listenForPixel()`（177 行目〜）がそのパスに `fs.rmSync`（178 行目）を行ってから `listen`（203 行目）する。終了時の `close()`（351 行目〜）でも `fs.rmSync`（359 行目）を行う
- コピー要求を `pbcopy` で処理する

ブリッジのソケットを Windows では名前付きパイプにし、パイプに対するファイル削除を行わないようにする。コピー要求は Windows 向けのクリップボード書き込み処理へ置き換える（段階 3）。Pixel 側の `join_embedded` の対応と合わせ、実際のプラグインからの起動・描画・操作・コピー・終了を確認する（段階 6）。

### ルートの postinstall が bash 依存

v0.11.1 のルート `package.json` に `"postinstall": "scripts/plugin-types.sh --if-missing"` と `"types": "scripts/plugin-types.sh"` がある。`plugin-types.sh` は bash スクリプトで、`claude-code-plugin/.claude/types/claude-code.d.ts` を Claude Code に生成させる。`claude` が PATH に無ければ何もせず終わるが、スクリプト自体の実行に bash が要る。

### バンドルに pixel が含まれる

v0.11.1 の `scripts/bundle.sh` は esbuild で `electron` と `*.node` だけを外部指定し、別名は `pixel-store` のみ。`@zenbu-labs/pixel` の JavaScript はバンドルに含まれ、ネイティブの `pixel.node` は実行時に解決される。v0.11.1 の `scripts/release.sh` は `@zenbu-labs/pixel-native-<target>` を `browser/node_modules/@zenbu-labs/` 配下にコピーし、Electron を `@zenbu-labs/pixel` の `electron/dist` から取る。

### upstream で削除された CLI 機能

v0.11.1 の `cli/src/main.ts` は次のフラグを明示的に拒否し、pixel への移行を案内する。

- アプリモード（`APP_MODE_FLAGS`、483〜495 行目）: `--app-mode`、`--preload`、`--main-script`、`--app-name`、`--app-id`、`--open-tabs-in-popup-stack`、`--no-toolbar`、`--no-shortcuts`、`--no-context-menu`、`--no-overlays`、`--no-frame`
- SSH バンドル（514〜518 行目）: `--ssh-bundle`、`--ssh-bundle-dir`。`--ssh` 自体は残っている

フォーク（`efe5aa8`）にはこれらの記述が残っている。数えたのは上の 13 個のフラグ名のいずれかを含む行で、決定事項「upstream で削除された CLI 機能」の表と同じ数え方。

| ファイル | 該当行数 |
|---|---|
| `README.md` | 17 |
| `README.ja.md` | 17 |
| `cli/src/main.ts` | 30 |
| `cli/src/help.ts` | 15 |
| `browser/src/session/session.tsx` | 11 |
| `cli/src/ssh.ts` | 4 |
| `CHANGELOG.md`、`CHANGELOG.ja.md` | 各 1 |

### テストの置き場所が変わった

- pixel には `packages/pixel/test/ssh.test.js`、`shell-safety.test.js`、`terminals.test.js` があり、`../dist/ssh`、`../dist/terminal/shared.js` などを読む。実行は `packages/pixel` の `test` スクリプト（`npm run build && node --test "test/*.test.js"`）
- フォークの `cli/test/ssh.test.js` は `../dist/ssh.js`、つまり v0.11.1 で削除された `cli/src/ssh.ts` のビルド結果を読むため、terminal-browser に残しても通らない
- フォークの `cli/test/setup.test.js`（`../dist/editors.js`、`../dist/setup.js`）と `browser/test/windows-agent-target.test.js`（`../dist/grab/target.js`）の参照先ソースは v0.11.1 にも存在する
- v0.11.1 の `cli/package.json` には `test` スクリプトが無い。フォークはこれを追加している（`tsc -p tsconfig.json && node --test "test/*.test.js"`）

### 現行の Windows CI の前提

フォークの `.github/workflows/release.yml` の `windows` ジョブ（128 行目〜）は次の順で動く。

1. `actions/checkout@v4` で terminal-browser のみを取得（135 行目）
2. `corepack pnpm install --frozen-lockfile`（148 行目）
3. `corepack pnpm -r typecheck`（165 行目）、`corepack pnpm -r test`（167 行目）、`cargo test --manifest-path engine/Cargo.toml --workspace`（169 行目）
4. シークレット `WINDOWS_CODESIGN_PFX`・`WINDOWS_CODESIGN_PASSWORD` があれば証明書を取り込み、`build-windows.ps1`・`package-windows-inno.ps1` に `-Sign` を渡す（179〜221 行目）

pixel のチェックアウト、pixel のビルド、`engine/` が無くなった後のテストは扱っていない。

### Windows ではパッチ済み Electron が不要な見込み

pixel は独自パッチ（`electron/patches/osr-shm-frame.patch` など）を当てた Electron 44.2.0 を使う。フレームの受け取り方は `packages/pixel/src/web/offscreen.ts` で決まる。

| プラットフォーム | 方式 |
|---|---|
| macOS | 共有テクスチャ（IOSurface） |
| Linux | 共有メモリ（パッチ由来の `softwareFrame`） |
| それ以外 | ビットマップ（`image.toBitmap()` → `updateSurface`） |

Windows は 3 つ目に該当し、フォークが現在使っている方式と同じ。

※推測: 標準の Electron 44.2.0 でもビットマップ経路で描画できると考えられる。段階 1 で実機確認する。

### 環境変数名は変えなくてよい

pixel のエンジン内でも `TERMINAL_BROWSER_FRAMES`、`TERMINAL_BROWSER_FRAME_BUDGET_MBPS`、`TERMINAL_BROWSER_AUTOPROFILE_MS` が使われている。フォークの `TERMINAL_BROWSER_CONSOLE_PID` などは改名不要。

## 変更がどれだけ当たるか

分岐点 `8bf4675`・移植先・フォーク `efe5aa8` の 3 方向で `git merge-file` を試した結果。テキスト上クリーンでも、import の書き換えは別途必要。

### pixel 側に移すもの（移植先: pixel v0.0.15）

| ファイル | 結果 | 参考: 分岐点からの変更量 |
|---|---|---|
| `engine/crates/pixel-core/src/terminal.rs` | **衝突 12** | upstream +569/−29、フォーク +525/−52 |
| `cli/src/ssh.ts` → `packages/pixel/src/ssh/index.ts` | **衝突 8** | 分岐点の有意な 266 行のうち 236 行が pixel 側に残存 |
| `engine/Cargo.toml` | 衝突 1 | |
| `engine/crates/pixel-core/Cargo.toml` | 衝突 1 | |
| `terminals/src/shared.ts` | 衝突 1 | |
| `terminals/src/terminals/wezterm.ts` | 衝突 1 | |
| `engine/packages/pixel-react/scripts/build-native.mjs` | 衝突 1 | |
| `engine/crates/pixel-core/src/engine/mod.rs` | クリーン | |
| `engine/crates/pixel-core/src/clipboard_image.rs` | クリーン | |
| `engine/crates/pixel-core/src/lib.rs` | クリーン | |
| `engine/crates/pixel-core/src/ghostty.rs` | クリーン | |
| `engine/crates/pixel-core/src/throttle.rs` | クリーン | |
| `engine/crates/pixel-core/src/tree/layout.rs` | クリーン | |
| `engine/crates/pixel-node/src/capture.rs` | クリーン | |
| `engine/crates/pixel-node/src/surface.rs` | クリーン | |
| `terminals/src/run.ts` | クリーン | |
| `terminals/src/index.ts` | クリーン | |
| `browser/src/page/input.ts` | クリーン | |
| `engine/crates/pixel-core/src/iterm.rs` | フォークの新規ファイル | |
| `engine/crates/pixel-core/src/herdr_windows.rs` | フォークの新規ファイル | |
| pixel の `engine/crates/pixel-core/src/hosted.rs` と関連テスト | upstream の新規モジュール。Windows 対応は新規作業で、3 方向マージの試算対象外 | |

テスト（`terminals/test/*.test.js`、`cli/test/ssh.test.js`）は未試算。

### terminal-browser 本体に残るもの（移植先: v0.11.1）

| ファイル | 結果 |
|---|---|
| `cli/src/main.ts` | **衝突 6** |
| `README.md` | 衝突 4 |
| `cli/src/help.ts` | 衝突 1 |
| `browser/package.json` | 衝突 1 |
| `.github/workflows/release.yml`、`.gitignore`、`browser/src/daemon.ts`、`browser/src/grab/target.ts`、`browser/src/registry.ts`、`browser/src/session/session.tsx`、`cli/package.json`、`cli/src/action.ts`、`cli/src/editors.ts`、`cli/src/setup.ts`、`cli/src/upgrade.ts`、`package.json`、`scripts/release.sh`、`store/src/index.ts`、`store/src/instances.ts`、`store/src/interop.ts`、`store/src/paths.ts` | クリーン |

v0.11.1 に存在しないフォークの追加ファイル: `CHANGELOG.md`、`CHANGELOG.ja.md`、`README.ja.md`、`docs/`、`installer/`、`scripts/build-windows.ps1`、`scripts/package-windows-inno.ps1`、`scripts/sign-windows.ps1`、`scripts/bundle.mjs`、`scripts/fetch-electron.mjs`、`scripts/agent-browser.mjs`、`scripts/copy-react-grab.mjs`、`scripts/generate-skill.mjs`、`cli/test/setup.test.js`、`cli/test/ssh.test.js`、`browser/test/windows-agent-target.test.js`。このうち `cli/test/ssh.test.js` は pixel に移す（段階 2）。`README.ja.md` からは upstream で削除された CLI 機能の記述を外す（段階 3）。

## 決定事項

### pixel の配布方式: フォークしてローカル参照

`zenbu-labs/pixel` を `fukuyori/pixel` にフォークして Windows 対応を入れ、terminal-browser からは隣に置いたチェックアウトを `file:` で参照する。upstream の `scripts/link-pixel.sh` と同じ仕組みで、npm には公開しない。

- 利点: インストーラがすべて同梱するので、利用者に影響しない
- 負担: ビルドに pixel のチェックアウトが要る。2 リポジトリを保守する

検討して採らなかった案:

- npm に自分のスコープ（例 `@fukuyori/pixel`）で公開する — import の書き換えか別名設定と、npm の運用が増える
- upstream の `zenbu-labs/pixel` に PR を出す — 取り込まれるか、いつ取り込まれるかが読めない。ただしフレームファイルの遅延解放のように Windows 固有でない修正は、あとから個別に PR として切り出せる

### terminal-browser のブランチ: v0.11.1 から新しく切る

upstream v0.11.1 から新しいブランチを作り、フォークの変更を載せ直す。`windows-native` には v0.11.1 をマージしない。

- `windows-native` は v0.8.0 ベースの Windows 版として残る
- `engine/`・`terminals/` の削除と衝突する 21 ファイルを 1 つずつ解く必要がない

検討して採らなかった案:

- `windows-native` に v0.11.1 をマージする（v0.8.0 のとき `018793a` と同じ方法）— 21 ファイルの「こちらは変更・向こうは削除」の衝突を解く必要がある

### Windows 版 Electron の実行ファイル名: `pixel.exe`

標準の Electron を展開したあと `electron.exe` を `pixel.exe` に改名し、pixel と terminal-browser の両方でこの名前を使う。v0.11.1 の CLI（`ELECTRON_DIST_BIN`・`ELECTRON_DEV_BIN` がともに `pixel`）と、Linux 版の `electron/dist/pixel` にそろう。

この名前にそろえる箇所:

| リポジトリ | 箇所 | フォークでの現状 | 段階 |
|---|---|---|---|
| pixel | `packages/pixel/scripts/postinstall.mjs`（展開後に改名） | — | 1 |
| pixel | `packages/pixel/src/bin.ts` の `electronBinary()` | — | 1 |
| terminal-browser | `cli/src/main.ts` の `ELECTRON_DIST_BIN`・`ELECTRON_DEV_BIN` | `electron.exe`（81・85 行目。v0.11.1 は `pixel`） | 4 |
| terminal-browser | `scripts/build-windows.ps1` の存在確認 | `electron.exe`（100 行目） | 4 |
| terminal-browser | `scripts/package-windows-inno.ps1` の必須ファイル一覧 | `electron\electron.exe`（28 行目） | 4 |
| terminal-browser | `installer/terminal-browser.iss` の `MyAppExeName`（アンインストール時のアイコン） | `electron\electron.exe`（7 行目） | 4 |

フォークの `scripts/fetch-electron.mjs` も `electron.exe` を参照していたが、Electron を pixel から取るようになったため段階 4 で削除した。`scripts/sign-windows.ps1` は `electron` ディレクトリの `*.exe` を列挙するので変更は要らない。

改名後は、Electron の解決経路ごとに `pixel.exe` から起動できることを確認する（段階 6）。

| 環境 | 解決する場所 |
|---|---|
| 開発環境 | `cli/src/main.ts` の `ELECTRON_DEV_BIN` で、pixel の `electron/dist/pixel.exe` |
| 配布パッケージ | `ELECTRON_DIST_BIN` で、`dist-release/terminal-browser/electron/pixel.exe` |
| インストール後 | `%LOCALAPPDATA%\Programs\terminal-browser\electron\pixel.exe` |

検討して採らなかった案:

- `electron.exe` のままにする — 標準の Electron の展開結果をそのまま使えるが、v0.11.1 の CLI と Linux 版の名前から外れる

### ブランチ名: `windows-v0.11.1`

pixel と terminal-browser の両方で `windows-v0.11.1` を使う。pixel は v0.0.15 から、terminal-browser は upstream v0.11.1 から作る。

### 移行後のバージョン: `0.11.1-win.1`

`docs/version-update-checklist.md` の規則どおり。インストーラのバージョンは `0.11.1.1` になる。

### upstream で削除された CLI 機能: upstream に従って外す

- アプリモードのフラグ 11 個（`--app-mode`、`--preload`、`--main-script`、`--app-name`、`--app-id`、`--open-tabs-in-popup-stack`、`--no-toolbar`、`--no-shortcuts`、`--no-context-menu`、`--no-overlays`、`--no-frame`）と、`--ssh-bundle`・`--ssh-bundle-dir` を Windows 版からも外す。拒否処理は v0.11.1 の `cli/src/main.ts`（483〜518 行目）をそのまま使う
- 通常の `--ssh` は維持する

フォーク（`efe5aa8`）でこれらのフラグを含む行と、その扱い:

| ファイル | 該当行数 | 扱い |
|---|---|---|
| `README.md` | 17 | 記述を外す（段階 3） |
| `README.ja.md` | 17 | 記述を外す（段階 3） |
| `cli/src/main.ts` | 30 | v0.11.1 の拒否処理にそろえる（段階 3） |
| `cli/src/help.ts` | 15 | 記述を外す（段階 3） |
| `browser/src/session/session.tsx` | 11 | 外したフラグに依存する処理を v0.11.1 にそろえる（段階 3） |
| `cli/src/ssh.ts` | 4 | pixel の `packages/pixel/src/ssh/index.ts` へ移植するとき、upstream pixel の扱いに合わせる（段階 2） |
| `CHANGELOG.md`、`CHANGELOG.ja.md` | 各 1 | 過去のリリースの記録なので書き換えない。`0.11.1-win.1` の項目に削除を記載する |

該当行数は `efe5aa8` でフラグ名を検索した結果で、同じ行に別の内容を含む場合がある。テストには該当が無かった。

### プラグイン型生成: `scripts/plugin-types.mjs` にする

`scripts/plugin-types.sh` を Node スクリプト `scripts/plugin-types.mjs` に置き換え、`.sh` は削除する。フォークが `agent-browser`・`copy-react-grab`・`generate-skill` で行ったのと同じ方法。

- ルート `package.json`: `"postinstall": "node scripts/plugin-types.mjs --if-missing"`、`"types": "node scripts/plugin-types.mjs"`
- 現行の `plugin-types.sh` の動作を維持する
  1. `--if-missing` が付いていて `claude-code-plugin/.claude/types/claude-code.d.ts` があれば、何もせず終了する
  2. `claude` が PATH に無ければ、`plugin-types: claude is not on PATH, skipping (run 'pnpm types' once it is installed)` を標準エラーに出して正常終了する
  3. `claude-code-plugin/.claude/types` を作り、環境変数 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` を付けて `claude -p "/plugin-types <ディレクトリ>"` を実行する
  4. 失敗したら `plugin-types: claude could not generate the types, skipping` を標準エラーに出して正常終了する

実装上の注意: このマシンでは `claude` が `~\.local\bin\claude.exe` のほか、npm の `claude.cmd`・`claude.ps1` としても PATH にある。Node は `.cmd` をシェルを介さずに起動できないため、Windows では起動する実行ファイルを解決する処理が要る。

### pixel のコミットの記録: `pixel.commit`

- terminal-browser 直下の `pixel.commit` に、Windows 対応を入れた `fukuyori/pixel` の完全なコミット SHA（40 桁）を 1 行で書き、末尾に改行を付ける。説明やコメントは入れない
- CI とローカルで同じファイルを使う
  - CI: terminal-browser を取得したあと `pixel.commit` を読み、pixel を取得する `actions/checkout` の `ref:` に渡す（段階 5）
  - ローカル: `scripts/build-windows.ps1` が `../pixel` を検査してからビルドする（次項）
- pixel を更新したら、`pixel.commit` と terminal-browser の `pnpm-lock.yaml` を一緒に更新する

### pixel の検査: `-RequireCleanPixel`

`scripts/build-windows.ps1` に、署名とは独立したスイッチ `-RequireCleanPixel` を追加する。

| 検査 | 実施条件 | 失敗時 |
|---|---|---|
| `../pixel` の HEAD が `pixel.commit` と一致する | 常に | 停止 |
| `../pixel` に未コミット変更が無い（`git status --porcelain` が空） | `-RequireCleanPixel` 指定時 | 停止 |

- **検査は pixel のビルドより前に行う**
- CI とリリース用のビルドでは必ず指定する。開発中の動作確認では省略できる
- `-Sign` は署名だけを制御し、この検査とは連動させない

リリース時の呼び出し:

```powershell
.\scripts\build-windows.ps1 -Zip -Sign -RequireCleanPixel
```

HEAD が一致しても未コミットの変更は残り得るため、未コミット変更の検査を別に設ける。`git status --porcelain` は追跡済みファイルの変更、ステージ済みの変更、無視されていない未追跡ファイルを検出する。

- pixel の `.gitignore` はビルド生成物（`dist/`、`packages/native/*/pixel.node`、`packages/pixel/electron/`、`engine/target/`、`node_modules/`）を無視するので、ビルドしただけでは検査に引っかからない（`git check-ignore` で確認済み）
- 新設する `packages/native/win32-x64/package.json` は無視されないため、コミットしてから検査を通す

検査を pixel のビルドより前に行うため、pixel のビルドは `build-windows.ps1` の中で検査のあとに実行する（段階 4）。検査より前にビルドした pixel を使うと、未コミット変更から作られた生成物が、検査を通ったあとの成果物に入り得るため。

#### 生成物の鮮度

Git がクリーンでも、`.gitignore` で無視された生成物は残る。再ビルドしても不要になった古いファイルまで消える保証は無いため、`-RequireCleanPixel` 指定時は、検査のあと pixel をビルドする前に次の出力だけを削除して作り直す。

| 削除する | 理由 |
|---|---|
| `../pixel/packages/pixel/dist/` | `tsc` は、削除・改名されたソースの古い出力を消さない。`packages/pixel/tsconfig.json` は `outDir: dist` で、pixel には `incremental`・`composite`・`tsBuildInfoFile` の設定が無いため、消せば全体が出力し直される |
| `../pixel/packages/native/win32-x64/pixel.node` | `build-native.mjs` はコピーの直前にしか消さないので、ネイティブのビルドが失敗すると古いファイルが残る |

削除しないもの:

| 削除しない | 理由 |
|---|---|
| `../pixel/engine/target/` | cargo がソースの変更から再ビルドの要否を判断する。消すとエンジン全体の再ビルドになる |
| `../pixel/packages/pixel/electron/` | ソースから作るものではない。取得時は zip を SHA-256 で照合し、展開済みのものを再利用するときの検証は段階 1 の手順 3 で確認する |
| `../pixel/node_modules/` | 依存関係を lockfile に従って導入する。`--frozen-lockfile` は lockfile の変更を禁止するもので、既存の実ファイルが不変であることを保証するものではない |

本体の `dist-release/` は、`build-windows.ps1` が冒頭で削除して作り直す（現行どおり）。

## 作業手順

### 段階 0: 準備

1. `zenbu-labs/pixel` をフォークし、`D:\home\source\rust\pixel` に clone する（`scripts/link-pixel.sh` は terminal-browser の隣の `../pixel` を既定の場所とする）
2. 作業ブランチ `windows-v0.11.1` を、pixel では v0.0.15 から、terminal-browser では upstream v0.11.1 から作る

### 段階 1: pixel を Windows で起動・描画できるようにする

この段階が移行全体の可否を決める。描画の確認より先に、起動と端末の特定を通す。

1. エンジンの移植
   - `engine/crates/pixel-core/src/terminal.rs` の衝突 12 箇所を解消する
   - `engine/Cargo.toml`、`engine/crates/pixel-core/Cargo.toml` に `windows-sys`、`memmap2` を追加する
   - `iterm.rs`、`herdr_windows.rs` を追加し、`lib.rs` の `cfg` を移す
   - クリーンに当たるファイル（`engine/mod.rs`、`clipboard_image.rs`、`ghostty.rs`、`throttle.rs`、`layout.rs`、`capture.rs`、`surface.rs`）を適用する
2. ネイティブパッケージ
   - `packages/pixel/scripts/build-native.mjs` に `win32` → `pixel_node.dll` を追加する（衝突 1）
   - `packages/native/win32-x64/package.json` を新設する（`os: ["win32"]`、`cpu: ["x64"]`、`files: ["pixel.node"]`）
   - `packages/pixel/package.json` の `optionalDependencies` に `@zenbu-labs/pixel-native-win32-x64` を追加する
3. Electron の入手
   - `packages/pixel/scripts/postinstall.mjs` に Windows 分岐を追加し、標準の Electron 44.2.0 を取得する
   - 展開に `unzip` を使わない（Windows 10 以降の `tar` か PowerShell の `Expand-Archive`）
   - 取得した zip を Electron の `SHASUMS256.txt` と照合する（既存の macOS・Linux の経路と同じく、一致しなければ止める）
   - **確認事項: 展開済み Electron を再利用するときの検証** — zip の SHA-256 照合が保証するのは取得時の整合性だけ。既存の `postinstall.mjs` は、マーカー `.zenbu-electron-sha256` の値が期待する zip の SHA-256 と一致すれば（macOS はフレームワークのシンボリックリンクも確認して）再利用し、展開済みファイルの中身は照合しない。Windows の分岐で展開済みのものを再利用する場合に、その中身（改名後の `pixel.exe` を含む）をどう検証するかを決め、確認する
   - 展開した `electron.exe` を `pixel.exe` に改名する
   - `bin.ts` が要求する `electron/dist/.zenbu-electron-sha256` を書き込む
   - 型定義 `electron.d.ts` は既存どおり pixel のリリースから取得できる
4. 起動処理（`packages/pixel/src/bin.ts`）
   - `electronBinary()` が Windows では `electron/dist/pixel.exe` を返すようにする
   - `ownTty()` に Windows 分岐を足す。フォークの `windowsConsoleId`（`WEZTERM_PANE` などから作るコンソール識別子）を使う
   - Electron を起動する環境変数に、エンジンがコンソールに接続するためのプロセス ID（フォークの `TERMINAL_BROWSER_CONSOLE_PID`）を渡す
5. 端末対応のうち起動に要る部分（段階 2 から前倒し）
   - `packages/pixel/src/terminal/shared.ts` — `windowsConsoleId` と `callerTty` の Windows 分岐（衝突 1）
   - `packages/pixel/src/terminal/terminals/wezterm.ts` — `bin.ts` の `checkTerminal(detect())` が WezTerm を認識するため（衝突 1）
   - `packages/pixel/src/terminal/index.ts` — `windowsConsoleId` を `@zenbu-labs/pixel/terminal` から公開する
6. インスタンス登録
   - `packages/pixel/src/root.tsx` のソケットパスを、Windows では名前付きパイプにする（フォークの `ipcEndpoint` と同じ方法）
   - `packages/pixel/src/host/server.ts` の `fs.rmSync`・`fs.mkdirSync` を Windows では行わない
   - `engine/crates/pixel-core/src/hosted.rs` のホスト接続を Windows では名前付きパイプで行い、既存の join・初期応答・制御メッセージのプロトコルを維持する。`lib.rs` のモジュール読み込みと、`terminal.rs` の `Terminal::join_host`・`join_embedded` の接続・読み書き・切断処理も対応させる
   - `hosted.rs` の `UnixListener` を使うテストは Windows 向けの名前付きパイプの待ち受けに対応させる。ホストへの参加、初期応答、フレーム転送、入力・リサイズ、切断を Windows でも検証し、Unix 専用の待ち受けをそのまま使わない
   - `packages/pixel/src/instances.ts` の `fs.existsSync(record.socket)` による生存判定が、実際に使う Node と Electron 44.2.0 内蔵の Node で名前付きパイプに対して正しく働くか確認する。働かなければ、パイプへの接続で判定する
7. 確認（起動の失敗と描画方式の失敗を混同しないよう、順に確かめる）
   1. `cargo test` を PowerShell から実行する（Git Bash 経由では ConPTY テストがハングする）
   2. **起動**: pixel の `examples/` を `bin.ts` 経由で起動し、`could not work out which tty` や `could not start electron` で止まらないこと
   3. **Electron の立ち上がり**: `~/.local/state/pixel/logs/<アプリ名>.stderr.log` に起動エラーが無いこと
   4. **端末の取得**: エンジンがコンソールを開き、端末が代替画面に切り替わること
   5. **方式の選択**: `initOffscreenMode` がオフスクリーンモードを `bitmap` と記録すること。これは選ばれた方式を示すだけで、フレームが届いていることは示さない（`appLog` の出力先はこの段階で確認する）
   6. **描画**: アプリの画面が WezTerm に表示されること
   7. **ホスト接続**: 同じ端末で 2 つ目の Pixel アプリを起動し、Rust 側が名前付きパイプを介して既存のホストへ参加できること。ゲストの描画・入力・リサイズ・終了と、ホストの終了時の切断処理を確認する

2〜5 のどこかで止まる場合は、起動処理・端末の特定・インスタンス登録の問題として段階 1 の中で直す。

**6 だけが失敗した場合の切り分け**: 描画が出ないことだけでは、パッチ済み Electron が必要とは判断できない。フレームの流れを上流から順に確かめ、止まっている場所を特定する。

| 確認箇所 | 見るもの | 止まっていた場合に疑うもの |
|---|---|---|
| `packages/pixel/src/web/host.ts` の `webContents.on("paint", ...)` | `paint` イベントが発生するか | 標準 Electron のオフスクリーン描画そのもの、`offscreen.ts` の設定 |
| 同ハンドラの `image.getSize()` | 幅・高さが 0 より大きいか（`BitmapPresenter.push` は 0 以下で何もしない） | 画面サイズ・拡大率の受け渡し |
| `packages/pixel/src/react/surface.ts` の `engine.updateSurface` | ビットマップがネイティブに渡るか | JavaScript 側の Surface 管理 |
| エンジンの端末への書き込み（`engine/crates/pixel-core/src/terminal.rs` の `Terminal::draw`） | kitty / iTerm2 のエスケープシーケンスが端末に出るか | フレーム転送方式の選択、端末との通信 |

**判断点**: パッチ済み Electron が必要になるのは、1 行目（`paint` イベント）か 2 行目（画像サイズ）で止まり、その原因が標準 Electron のオフスクリーン描画にあると特定できた場合に限る。Windows 用のパッチ済み Electron は Chromium のビルドになり作業量が桁違いに増えるため、そう特定できた時点で、段階 2 に進む前に続行するかを判断する。3・4 行目で止まる場合は pixel 側の問題として段階 1 の中で直す。

### 段階 2: pixel の残りを移植する

1. `packages/pixel/src/terminal/run.ts`（クリーン）
2. `packages/pixel/src/ssh/index.ts` — フォークの `cli/src/ssh.ts` の Windows SSH 対応（衝突 8）
3. `packages/pixel/src/web/input.ts`（クリーン）
4. テストを pixel に移す
   - フォークの `cli/test/ssh.test.js` の変更を `packages/pixel/test/ssh.test.js` に移す。読み込み先は `../dist/ssh.js` から `../dist/ssh`（`packages/pixel/dist/ssh/index.js`）に変える
   - フォークの `terminals/test/shell-safety.test.js`、`terminals/test/terminals.test.js` の変更を、`packages/pixel/test/` の同名ファイルに移す
   - `shell-safety.test.js` が起動する `packages/pixel/test/pty-shell.py` は `os.forkpty()` を使うため、ネイティブ Windows では実行できない。フォークの同テストにある Windows でのスキップ（`const posixOnly = { skip: process.platform === "win32" }`）を移植後も維持する
   - 実行: `pnpm --filter @zenbu-labs/pixel test`（`npm run build && node --test "test/*.test.js"`）と、`engine/` での `cargo test`（PowerShell から）
5. pixel のテストを Windows で通す

### 段階 3: terminal-browser を v0.11.1 に載せる

1. フォークの本体側の変更を `windows-v0.11.1` に持ってくる
   - `8bf4675..windows-native` の差分から、pixel に移したもの（`engine/`、`terminals/`、`browser/src/page/input.ts`、`cli/src/ssh.ts`、`cli/test/ssh.test.js`）を除いて `git apply --3way` で当てる。分岐点と v0.11.1 が同じリポジトリにあるので 3 方向で当たる
   - v0.11.1 に存在しないフォークの追加ファイル（`installer/`、`scripts/*.ps1`、`scripts/*.mjs`、`CHANGELOG*`、`README.ja.md`、`docs/`、`cli/test/setup.test.js`、`browser/test/windows-agent-target.test.js`）もこの差分に含まれる
2. 衝突を解消する: `cli/src/main.ts` 6、`README.md` 4、`cli/src/help.ts` 1、`browser/package.json` 1
   - `browser/package.json` の `postinstall` は v0.11.1 で `bash ../scripts/copy-react-grab.sh`。フォークの `copy-react-grab.mjs` を維持する
3. import を書き換える
   - `pixel-react` → `@zenbu-labs/pixel`
   - `pixel-terminals` → `@zenbu-labs/pixel/terminal`
   - `cli/src/main.ts` の `windowsConsoleId` を `@zenbu-labs/pixel/terminal` から取る
4. upstream で削除された CLI 機能を外す（決定事項の表のとおり）
   - `README.md`、`README.ja.md`、`cli/src/help.ts` からアプリモードのフラグと `--ssh-bundle`・`--ssh-bundle-dir` の記述を外す。`--ssh` の記述は残す
   - `cli/src/main.ts`、`browser/src/session/session.tsx` は v0.11.1 の拒否処理と実装にそろえる
   - `CHANGELOG.md`、`CHANGELOG.ja.md` の過去の項目は変えず、`0.11.1-win.1` の項目に削除を記載する
5. `scripts/plugin-types.mjs` を作り、ルート `package.json` の `postinstall` を `node scripts/plugin-types.mjs --if-missing`、`types` を `node scripts/plugin-types.mjs` にする。`scripts/plugin-types.sh` は削除する
6. pixel をローカル参照する。`scripts/link-pixel.sh` は bash と `uname` 前提で Windows では動かず、また実行時に `package.json` を書き換える方式のため、フォークでは参照先を書き換えた状態でコミットする
   - `browser/package.json`、`cli/package.json` の `@zenbu-labs/pixel` を `file:../../pixel/packages/pixel` にする
   - ルート `package.json` の `pnpm.overrides` で `@zenbu-labs/pixel-native-win32-x64` を `file:../pixel/packages/native/win32-x64` にする
   - terminal-browser 直下に `pixel.commit` を作り、使う `fukuyori/pixel` のコミット SHA（40 桁）を 1 行で書く（末尾に改行、説明やコメントは入れない）
   - `../pixel` の検査（HEAD と `pixel.commit` の一致、`-RequireCleanPixel` 指定時の未コミット変更）は段階 4 で `build-windows.ps1` に実装する
   - 最初の `pnpm-lock.yaml` を作るときは、pixel 側で `pnpm --filter @zenbu-labs/pixel build` と `build:native -- --release` を実行してから `pnpm install` し、更新された `pnpm-lock.yaml` を `pixel.commit` と一緒にコミットする（CI の `--frozen-lockfile` と一致させるため）
7. テストの置き場所と実行
   - `cli/test/setup.test.js` は terminal-browser に残す。`cli/package.json` の `test` スクリプトはフォークの変更として段階 3 の 1 で入る
   - `browser/test/windows-agent-target.test.js` は terminal-browser に残す（v0.11.1 の `browser` に `test` スクリプトがある）
   - 実行: `corepack pnpm -r typecheck` と `corepack pnpm -r test`。`store` には `test` スクリプトが無いため、型チェックをテストで代用しない
8. `browser/src/registry.ts`、`browser/src/daemon.ts`、`store/src/paths.ts` の `ipcEndpoint` まわりが v0.11.1 の変更後も成り立つか確認する
9. `cli/src/claude-bridge.ts` を Windows 対応する
   - `serve` は `detached: true` で起動して `launch` の終了後も存続させる。Windows の Node/libuv は非 detached の子プロセスを親終了時に終了させるため、通常のデーモン起動の設定をそのまま使わない
   - `launch` が自身の PID を内部引数 `--console-pid` で渡し、生存中に `serve` が Pixel の `attachWindowsConsole(pid)` で元のコンソールへ接続する。接続成功後にのみポートを通知する。失敗時は起動エラーを返し、ポートを通知しない
   - `serve` が保持するコンソールを描画先にするため、ブラウザ起動時の `TERMINAL_BROWSER_CONSOLE_PID` は `serve` 自身の PID とする。CLI は既に渡された PID を上書きしない
   - `cli/test/claude-bridge-launch.test.js` で、起動元終了後のブリッジ生存・元のコンソールへの所属・`/state`・`/close`・コンソール接続失敗を検証する。描画と実プラグインの操作はこの制御テストには含めない
   - `launch`（53 行目〜）で作るソケットのパスと、`Bridge.listenForPixel()`（177 行目〜）の待ち受け（203 行目の `listen`）を同じ名前付きパイプのパスにそろえ、`PIXEL_EMBED`（260 行目）にそのパスを渡す
   - 待ち受け前の `fs.rmSync`（`listenForPixel()` の 178 行目）と、終了時の `fs.rmSync`（`Bridge.close()` の 359 行目）は、Windows の名前付きパイプに対して実行しない
   - コピー要求の `pbcopy` を Windows 向けのクリップボード書き込み処理へ置き換える。日本語と複数行の文字列が保持されることを確認する
   - 段階 1 の `Terminal::join_embedded` と組み合わせ、ブリッジ起動・Pixel の接続・終了処理を Windows で確認する。実際の Claude Code プラグインとの一連の動作は段階 6 で確認する

### 段階 4: ビルド・パッケージ・署名スクリプトを更新する

v0.11.1 の `scripts/release.sh` に合わせる。

| 項目 | 現在の `build-windows.ps1` | v0.11.1 の方式 |
|---|---|---|
| ネイティブ | `engine/` で `cargo build -p pixel-node` し、`browser/native/pixel.node` に置く | `@zenbu-labs/pixel-native-<target>` を `browser/node_modules/@zenbu-labs/` 配下にコピーする（pixel が実行時にそこを探す） |
| Electron | `browser/node_modules/electron/dist` | `@zenbu-labs/pixel` の `electron/dist` |
| バンドル | `scripts/bundle.mjs` が `pixel-react`・`pixel-terminals` を in-repo のソースに別名解決 | `electron` と `*.node` だけを外部指定し、`@zenbu-labs/pixel` はバンドルに含める |

1. `scripts/build-windows.ps1` の処理順を次のようにし、スイッチ `-RequireCleanPixel` を追加する（決定事項「pixel の検査」）
   1. `../pixel` の HEAD が `pixel.commit` と一致するか検査する（常に）。一致しなければ停止する
   2. `-RequireCleanPixel` 指定時は `../pixel` で `git status --porcelain` が空か検査する。空でなければ停止する
   3. `-RequireCleanPixel` 指定時は、決定事項「生成物の鮮度」の表にある出力（`packages/pixel/dist/`、`packages/native/win32-x64/pixel.node`）だけを削除する
   4. pixel をビルドする: `../pixel` で `corepack pnpm install --frozen-lockfile`、`pnpm --filter @zenbu-labs/pixel build`、`pnpm --filter @zenbu-labs/pixel build:native -- --release`
   5. terminal-browser で `corepack pnpm install --frozen-lockfile` を実行し、ビルドした pixel を `node_modules` に取り込む（`file:` 参照はインストール時にパッケージをコピーするため。`scripts/link-pixel.sh` のコメントに記載がある）。通常のインストールで取り込まれないと分かった場合は、取り込みを確実にする処理をここに入れる（下の完了条件 2）
   6. ペイロードを作る（下の項目 2 以降）。`-Sign`・`-Zip` の扱いは現行どおり
2. ペイロードの作り方を上表に合わせる。Electron は pixel から取るため、`scripts/fetch-electron.mjs` と `browser/package.json` からの呼び出しを削除した。pixel の中のネイティブパッケージと Electron の場所は `scripts/pixel-paths.mjs` が解決する（`node -e` に PowerShell のヒアストリングを渡すと引用符が失われるため、スクリプトに切り出した）
3. `scripts/bundle.mjs` から `pixel-react`・`pixel-terminals` の別名を外し、`bundle.sh` と同じ外部指定にする
4. `scripts/sign-windows.ps1` の署名対象 `browser\native\pixel.node` を新しい場所に変える
5. `scripts/package-windows-inno.ps1` の必須ファイル一覧の `browser\native\pixel.node` を新しい場所に変える
6. Electron の実行ファイル名を `pixel.exe` にそろえる: `cli/src/main.ts` の `ELECTRON_DIST_BIN`・`ELECTRON_DEV_BIN`、`scripts/build-windows.ps1` の存在確認、`scripts/package-windows-inno.ps1` の必須ファイル（`electron\pixel.exe`）、`installer/terminal-browser.iss` の `MyAppExeName`（`electron\pixel.exe`）
7. `docs/version-update-checklist.md` に従いバージョンを `0.11.1-win.1` に更新する（`scripts/build-windows.ps1` の `Version` の既定値、README 両言語、CHANGELOG 両言語）

**誰がビルドするか**

配布物（`dist-release/` 配下のペイロード、ZIP、インストーラー）は Claude は作らない。
`dist-release/terminal-browser/` は署名の対象そのものなので、`-Zip` の有無にかかわらず
これを作る実行は配布物の作成に当たる。

| 実施者 | 目的 | 実行するもの |
|---|---|---|
| CI（`release.yml`） | GitHub Release に登録する成果物 | タグを打つと署名付きで全部 |
| 利用者 | 手元での確認 | `build-windows.ps1 -Zip -Sign -RequireCleanPixel` と `package-windows-inno.ps1 -Sign` |
| Claude | スクリプトの変更 | ソースの編集のみ。ビルドは行わない |

したがって下の完了条件は、**スクリプト自身が検査して満たす**形にする。人が毎回手で
比べる前提にはしない。CI でも同じ検査が働く。

**完了条件**（生成物の鮮度）

1. **古い生成物を残さない** — `-RequireCleanPixel` 指定時に、`packages/pixel/dist/` と `packages/native/win32-x64/pixel.node` を削除してから作り直していること。削除対象がこの 2 つに限られていること
2. **新しい pixel が本体に入る** — `build-windows.ps1` が署名を呼ぶ前に、次の 3 つの `pixel.node` の SHA-256 を比較し、一致しなければ停止すること。署名はペイロード内の `pixel.node` を書き換えるので、比較は必ずその前に行う
   - `../pixel/packages/native/win32-x64/pixel.node`
   - `browser/` から辿れる `@zenbu-labs/pixel-native-win32-x64` の `pixel.node`（`scripts/pixel-paths.mjs native`）
   - `dist-release/terminal-browser/browser/node_modules/@zenbu-labs/pixel-native-win32-x64/pixel.node`
3. **署名が付く** — `-Sign` 付きで実行したとき、ペイロード内の `pixel.node` と Electron のバイナリ（`pixel.exe` を含む）の署名が有効である（`Get-AuthenticodeSignature` が `Valid` を返す。`scripts/sign-windows.ps1` は署名後にこれを検査する）

JavaScript 側の取り込みは、`file:` 参照が `pnpm install` でコピーされることに依存する。
2 の検査はネイティブについてこれを確かめるもので、JavaScript が古いままなら
ネイティブも古いままになるため、同じ検査で気づける。

### 段階 5: CI を 2 リポジトリ構成にする

`.github/workflows/release.yml` の `windows` ジョブを変える。

1. **配置** — `actions/checkout` はワークスペースの外に書き出せないため、terminal-browser を `terminal-browser/` に、`fukuyori/pixel` を `pixel/` に、ワークスペース直下へ並べて取得する。これで `file:../../pixel/...` の相対パスがローカルと同じく解決する
2. **配置変更に伴う参照先の調整** — 現行のジョブはリポジトリがワークスペース直下にある前提で書かれている

   | 箇所 | 現行 | 変更後 |
   |---|---|---|
   | `pnpm/action-setup@v4`（139 行目） | `with` なし（ルートの `package.json` の `packageManager` を読む） | `package_json_file: terminal-browser/package.json` |
   | `actions/setup-node@v4`（141〜144 行目） | `cache: pnpm` のみ（ルートの lockfile を探す） | `cache-dependency-path` に `terminal-browser/pnpm-lock.yaml` と `pixel/pnpm-lock.yaml` |
   | `run` の各手順 | ワークスペース直下で実行 | `working-directory` を `terminal-browser` または `pixel` にする |
   | `actions/upload-artifact@v4` の `path`（226〜230 行目） | `dist-release/...` | `terminal-browser/dist-release/...`（ビルドスクリプトの出力先がリポジトリ内のため） |

3. **pixel のコミット固定** — terminal-browser を先に取得し、`terminal-browser/pixel.commit` の 1 行目を読んで、`fukuyori/pixel` を取得する `actions/checkout` の `ref:` に渡す
4. **順序** — pixel のビルドは `build-windows.ps1` が検査のあとに行うので、CI では `build-windows.ps1` より前に pixel をビルドしない
   1. terminal-browser を取得し、`pixel.commit` を読む
   2. `fukuyori/pixel` を `pixel.commit` のコミットで取得する
   3. Rust・Node・pnpm を用意する
   4. 署名用の証明書を準備する（既存の 179〜203 行目。`build-windows.ps1` より前に置く）
   5. `terminal-browser/` で `build-windows.ps1` を `-Zip -RequireCleanPixel` 付きで実行する。`-Sign` は既存の手順どおり署名用のシークレットがあるときだけ付ける（213〜214 行目の `$options`）。この中で検査 → 対象出力の削除 → pixel のビルド（ここで pixel の `postinstall.mjs` が Electron を取得する）→ 本体の `pnpm install` → ペイロード作成が行われる
   6. テスト（次項）
   7. `terminal-browser/` で `package-windows-inno.ps1`（既存の署名手順と `-Sign` の受け渡しは維持する）
   8. 成果物をアップロードする（既存の 223〜230 行目）。すべてのテストが成功したあとに限る
5. **テスト**
   - 現行の `corepack pnpm -r typecheck` を `terminal-browser/` で引き続き実行する。`store` を含む全パッケージの型チェックを維持する
   - 169 行目の `cargo test --manifest-path engine/Cargo.toml --workspace` を、`pixel/engine/Cargo.toml` を対象にする形へ置き換える
   - `pixel/` で `pnpm --filter @zenbu-labs/pixel typecheck` と `pnpm --filter @zenbu-labs/pixel test`、`terminal-browser/` で `corepack pnpm -r test`
   - 型チェック・各テストの失敗時は停止し、インストーラー作成と成果物のアップロードへ進まない
6. **lockfile** — 段階 3 の 6 でコミットした `pnpm-lock.yaml` が `file:` 参照と一致していないと `--frozen-lockfile` が失敗する。pixel を更新したときは、terminal-browser 側の `pnpm-lock.yaml` と `pixel.commit` を一緒に更新する
7. **成果物** — アップロードの `path` は手順 2 のとおり変える。成果物名（`windows-release-windows-x64`）と、それを受け取る後続ジョブの `pattern: windows-release-*` は変えなくてよい

実施後の `windows` ジョブの流れ:

| # | ステップ | 作業ディレクトリ |
|---|---|---|
| 1 | terminal-browser を `terminal-browser/` へ取得 | — |
| 2 | `pixel.commit` を読む（40 桁の書式を検査する） | `terminal-browser` |
| 3 | `fukuyori/pixel` を その コミットで `pixel/` へ取得 | — |
| 4 | pnpm・Node・Rust を用意 | — |
| 5 | agent-browser のキャッシュ鍵を解決 | `terminal-browser` |
| 6 | Inno Setup を導入 | — |
| 7 | 署名証明書を準備 | — |
| 8 | `build-windows.ps1 -Zip -RequireCleanPixel`（署名鍵があれば `-Sign`） | `terminal-browser` |
| 9 | テスト（pixel の typecheck・test・`cargo test`、terminal-browser の typecheck・test） | ワークスペース直下 |
| 10 | `package-windows-inno.ps1` | `terminal-browser` |
| 11 | 成果物をアップロード | — |

テストを 8 のあとに置いたのは、`build-windows.ps1` が両方のチェックアウトに
`pnpm install --frozen-lockfile` を行い pixel をビルドするため。先にテストを走らせると
インストール前の状態を見ることになる。9 が失敗すれば 10・11 には進まない。

`CARGO_TARGET_DIR` はジョブ全体に設定されているので、pixel の `build:native` と
9 の `cargo test` は同じターゲットディレクトリを使う。

#### 状態: 実装済み、CI 実行での検証待ち

実行手順と見るべき点は `docs/ci-verification.md` にまとめた。以下はその要点。

ワークフローは書き換えたが、**まだ一度も動かしていない**。正しさは実行しないと分からない。

**検証の前提: 取得対象のコミットが push されていること**

手順 3 は `pixel.commit` の SHA で `fukuyori/pixel` を checkout する。この SHA が
リモートに無ければ、`actions/checkout` は `No commit found` で失敗する。
2026-09-20 時点で `fukuyori/pixel` に `windows-v0.11.1` ブランチは無く、
`f9b8746`・`2ad2ead`・`7002209` はローカルにしか無い。

したがって検証の順序は次になる。

1. pixel の `windows-v0.11.1` を push（`pixel.commit` の指す SHA がリモートに載る）
2. terminal-browser の `windows-v0.11.1` を push
3. ワークフローを動かす

`fukuyori/pixel` は公開リポジトリなので、`actions/checkout` に追加の PAT は要らない。

2026-09-21 に、本体 `05fef3e` と Pixel の pin
`5bb53b956ec2b9d1373e56f8c0c8869a720668bd` が GitHub に存在することを確認した。
上記の未 push という前提は解消済み。後続の `verify_windows=true` オプションでは
Windows のビルド・テスト・Actions 成果物保存だけを行い、署名・タグ作成・R2 公開・
Worker 配備を省く。この workflow 変更を push してから実行する。
ローカルでの workflow 検証と、GitHub 上での実行検証は区別する。

**どう動かすか**

`release.yml` のトリガーと、GitHub Release への登録可否。

| 起動方法 | `channel` | GitHub Release 登録 |
|---|---|---|
| `workflow_dispatch` + `verify_windows=true` | `dev`（Windows 検証のみ） | されない |
| タグ push（`v*` / `*-win.*`） | `stable` | される |
| `workflow_dispatch` + `bump` が `patch`/`minor`/`major` | `stable`（タグを自動作成して push する） | される |
| `workflow_dispatch` + `bump=none`（既定） | `dev` | されない |
| `main` への push | `dev` | されない |
| その他のブランチへの push | — | トリガーされない |

検証では `verify_windows=true` を明示する。`bump=none`・`deploy_worker=false`・
ブランチ指定が必須で、それ以外の組み合わせはタグ作成前に停止する。
このモードでは macOS/Linux・Worker・Release のジョブと署名処理を省く。

`verify_windows` を指定しない従来の手動実行では、`bump=none` でも R2 に公開する。
GitHub Release が作られないことと、外部公開されないことは区別する。

**確認できていないこと**

- `actions/checkout` が作る detached HEAD に対して、`build-windows.ps1` の
  `git rev-parse HEAD` が `pixel.commit` と一致するか
- `CARGO_TARGET_DIR` をワークスペース外に置いた状態で pixel の `build:native` が通るか
- windows ランナーでの所要時間（pixel のビルドが加わる）

### 段階 6: 実機確認

- 描画（ビットマップ経路）、入力、マウス座標（upstream `#105` の変更を含む）
- リサイズ、フレームファイルの遅延解放と起動時の掃除
- kitty ファイル転送、iTerm2 フォールバック
- 同じ端末での 2 つ目のアプリ起動（インスタンス登録と名前付きパイプ、Rust のホスト接続）。ゲストの描画・入力・リサイズ・終了、ホスト終了時の切断とホストへの再接続
- SSH、エージェント連携、クリップボード画像
- Claude Code プラグインからのブリッジ起動、名前付きパイプを介した Pixel の接続と埋め込み描画、操作、日本語・複数行のコピー、終了後の後片付け。通常のエージェント連携とは別の確認項目として扱う
- `-Sign` 付きのビルドとパッケージ作成、アンインストーラの署名
- インストール後にネイティブパッケージと Electron が正しい場所から解決されること
- `pixel.exe` からの起動を、開発環境・配布パッケージ（`dist-release/terminal-browser`）・インストール後の 3 か所で確認すること
- スタートメニューのショートカットからの起動

## 未確認事項とリスク

- 標準 Electron 44.2.0 での描画（段階 1 で確認する）
- 名前付きパイプに対する `fs.existsSync` の挙動（Node 24.14.1 でのみ確認済み。段階 1 で実際のランタイムで確認する）
- `appLog` の出力先
- pixel を再ビルドしたあと、terminal-browser の `pnpm install --frozen-lockfile` が lockfile に変化が無くても `file:` 参照のコピーを新しいビルドで更新するか。2026-09-20 に手動で確認した範囲では更新された（pixel を変更してコミットし、`pixel.commit` を更新して再ビルドしたところ、`node_modules` と両方のバンドルに識別文字列が入り、ネイティブ 3 か所のハッシュが揃って変わった）。以後は段階 4 の完了条件 2 の検査が `build-windows.ps1` の中で毎回これを確かめる
- 展開済み Electron を再利用するときの検証方法（段階 1 の手順 3 で確認する）
- 配布後のネイティブパッケージ解決と Electron の配置（段階 4 で `release.sh` に合わせ、段階 6 で確認する）
- テストファイルの移植量（3 方向マージは未試算）
- pixel の `packages/pixel/src/react/surface.ts` に、生ピクセルを渡す経路をなくしたいという趣旨のコメントがある。upstream がビットマップ経路を削除すると Windows の描画が壊れる
- pixel は初回コミット（2026-09-04）から 2 週間で 29 コミットと変化が速く、フォークの追従負担が大きい
- pixel の `packages/pixel/src/terminal/terminals/herdr.ts` にある `win32` の記述の内容
- upstream `#113` の Claude Code プラグイン（`claude-code-plugin/`）と、段階 1・3 で Windows 対応する Rust のホスト接続・ブリッジを組み合わせた実機動作（段階 6 で確認する）。ソケットのファイルパスと `pbcopy` の Windows 非対応は確認済みで、段階 3 の対応対象とする
