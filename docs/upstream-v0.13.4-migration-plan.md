# upstream v0.13.4 移行計画

Windows 対応フォーク (`windows-v0.11.1`) を upstream `zenbu-labs/terminal-browser` v0.13.4 に
追従させるための計画。作成 2026-10-03。前回の計画は
[upstream v0.11.1 移行計画](upstream-v0.11.1-migration-plan.md)。

この文書の数値とコード上の事実は、2026-10-03 に両リポジトリで `upstream` を取得したうえで
実測したもの。実測していない事項は「未確認」と明記する。「決定が必要な事項」は、決定済みと記したもの以外は未決定で、
推奨案を添えている。

## 現在の状態（2026-10-03）

- フォークの作業ブランチは `windows-v0.11.1`（`c31271c`）。`0.11.1-win.1` を
  [GitHub Release](https://github.com/fukuyori/terminal-browser/releases/tag/0.11.1-win.1) として公開済み。
- Pixel は別リポジトリ `fukuyori/pixel` の `windows-v0.11.1`（`5bb53b9`）を `pixel.commit` で pin している。
- 未解決の issue は [#1 原因不明のブラウザ終了](https://github.com/fukuyori/terminal-browser/issues/1) と
  [#2 WezTerm での Image 非対応](https://github.com/fukuyori/terminal-browser/issues/2)。
- 両リポジトリのローカル `main` は upstream の `main` に fast-forward 済み。`origin/main` へは未 push。
- フォークの GitHub 既定ブランチは `windows-native` のまま。

## 調査時点のリビジョン

| 対象 | リビジョン |
|---|---|
| フォーク本体 `windows-v0.11.1` | `c31271c`（2026-09-21） |
| フォーク Pixel `windows-v0.11.1` | `5bb53b9` |
| upstream v0.11.1（フォークの分岐点） | `6d68234`（2026-09-17） |
| upstream v0.13.4（移行先） | `fd5f179`（2026-10-01） |
| upstream `main` | `2bdf227`（2026-10-02）。v0.13.4 の 1 コミット先 |
| `zenbu-labs/pixel` v0.0.15（フォーク Pixel の分岐点） | `920d517`（2026-09-16） |
| `zenbu-labs/pixel` v0.0.20 | `94a2f86`（2026-09-29） |

規模:

| 範囲 | コミット | ファイル | 行 |
|---|---|---|---|
| upstream v0.11.1 → v0.13.4 全体 | 19 | 357 | +58,064 / −860 |
| うち `pixel/` を除く | — | 126 | +7,378 / −858 |
| フォーク本体（v0.11.1 → `windows-v0.11.1`、docs 含む） | 19 | 74 | +7,509 / −846 |
| フォーク Pixel（v0.0.15 → `windows-v0.11.1`） | 7 | 43 | +2,325 / −324 |

## 判明した前提

### Pixel が本体リポジトリに戻った

upstream は `1285528`（move pixel to terminal-browser repo）で Pixel を本体の `pixel/` に取り込んだ。

- `pnpm-workspace.yaml` に `pixel/packages/*`、`pixel/packages/native/*`、`pixel/examples/*` が入り、
  `browser` と `cli` の依存は `"@zenbu-labs/pixel": "workspace:*"` になった。
- `scripts/link-pixel.sh` は削除された。ルートに `pixel:build`、`pixel:build:native`、
  `pixel:typecheck`、`pixel:test` のスクリプトが追加された。
- 取り込み時点の `pixel/engine` と `pixel/examples` は `zenbu-labs/pixel` v0.0.20 と同一のツリー。
  差があるのは `packages`、`scripts`、`README.md`、および取り込まれなかった Pixel 側の
  `.github`、ルートの `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- 取り込み後、v0.13.4 までに `pixel/` へ 5 コミットが入っている
  （テレメトリ、README、透過 webview の修正、Claude Code プラグイン修正、カーソル）。
- v0.13.4 時点の `pixel/packages/pixel/package.json` の version は `0.0.20`。
  本体リポジトリに `pixel-v0.0.21`〜`pixel-v0.0.23` のタグがあり、`pixel-v0.0.23` は v0.13.4 と同じコミット。

この結果、前回の移行で作った 2 リポジトリ構成（`fukuyori/pixel`、`pixel.commit`、
`-RequireCleanPixel`、`file:../pixel` の override、CI の 2 回 checkout）は upstream の構成と合わなくなった。

### `store` が `shared` に改名された

- ディレクトリ `store/` は `shared/` へ、パッケージ名 `pixel-store` は `shared` へ変わった。
  `scripts/bundle.sh` の alias も `shared` になった。
- `shared/src/config/`（設定・ショートカット・検索・テレメトリ）、`shared/src/terminal-socket.ts`、
  `shared/src/release.ts`、`shared/src/app-state.ts` が追加された。
- フォークで `pixel-store` を参照しているファイルは 20 個
  （`browser/src` 5、`cli/src` 5、`cli/test` 3、`scripts` 3、両 `package.json`、`store/package.json`、workflow）。
- フォークが `store/` に足した `lifecycle.ts`、`paths.ts` の Windows 対応、テスト 3 件の移設が要る。
  試験マージでは git の改名追跡で `src` は `shared/src` に運ばれたが、`store/test/` の 3 件は `store/` に残った。

### upstream は引き続き Windows 非対応

v0.13.4 のソースで `win32` の出現を数えた結果、`browser/src`、`cli/src`、`shared/src`、`monitor/src`、
`scripts`、`claude-code-plugin` は 0、`pixel/packages/pixel/src` は 1。エンジンの `cfg(windows)` 類は 1。
ネイティブパッケージは `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64` の 4 つで、`win32-x64` は無い。
フォークの Windows 対応はすべて持ち越す必要がある。

### エンジンの描画経路が作り直された

`a12cb91`（Improve CPU usage by 5x、Pixel 側 `c2a5d01`）で `pixel-core` が大きく変わった。

- `terminal.rs` から `terminal/payload.rs` と `terminal/present/`（`animation`、`flash`、`full`、
  `merge`、`overlay`、`patched`、`screen`、`tiles`、`transmit_strategy`）が切り出された。
- `ghostty.rs`、`scroll/profiles/tui.rs`、`scroll/profiles/wheel.rs` が削除された。
- `engine/frame.rs`、`paint/opaque.rs` が追加された。
- v0.0.15 から v0.13.4 までで `pixel-core` は 48 ファイル、+4,319 / −1,720。

フォークは `terminal.rs` に +647 / −69 の Windows コンソール対応を入れているので、ここが最大の衝突点になる。
フォークが `ghostty.rs` に足した 8 行は、ファイル自体が消えたため移し先を決める必要がある。

### Claude Code プラグインが upstream でも Image 方式になった

upstream の `28de006`（Fix claude code plugin #137）は、フォークと同じく
`Image` + `$.ui.blit` + 入力用 `Client` の構成に移り、`placeholders.ts` を削除した。違いは次のとおり。

| | upstream v0.13.4 | フォーク |
|---|---|---|
| フレームの渡し方 | POSIX 共有メモリ。`source: { shm, format, width, height, generation }` | ファイルフレームを bridge が受け、認証付き `/frame` から inline 画像で渡す |
| エンジン側 | `hosted.rs` が `rustix::shm` と `std::os::unix` を使う | `PIXEL_EMBED_FRAMES=1` で既存のファイルフレーム経路を使う |
| capability 名 | `image-frames` | `image-embedding` |

POSIX 共有メモリは Windows に無い。Windows の Claude Code が `shm` 形式の `source` を受け付けるかは未確認。
この差が `cli/src/claude-bridge.ts`（16 箇所）と `register.tsx`（7 箇所）の衝突になっている。

### テレメトリが追加された

`06df2ab`（Add telemetry and error reporting #131）。`browser/src/telemetry.ts` を読んだ結果:

- 送信先は PostHog（既定 `https://eu.i.posthog.com`、`TERMINAL_BROWSER_TELEMETRY_ORIGIN` で変更可）。
  プロジェクトキーはソースに埋め込まれている。
- イベントは `app_launched`、`app_upgraded`、`daily_active`、`$exception` の 4 種。
  付随する情報は匿名 ID、バージョン、チャンネル、OS、アーキテクチャ、端末名。例外は型名のみ。
  `$geoip_disable: true` が付く。送信内容は `LOGS_DIR/telemetry.jsonl` にも記録される。
- 設定 `telemetry.usage` と `telemetry.crashReports` の既定はどちらも `on`。
- 環境変数 `DO_NOT_TRACK` または `TERMINAL_BROWSER_NO_TELEMETRY` で無効化できる。
- バージョンが `dev` のときは送信しない（送信先を明示した場合を除く）。

フォークのリリース版は `0.13.4-win.1` のような版名で `dev` ではないため、何もしなければ
フォークの利用者の端末から upstream の PostHog プロジェクトへ送信される。

### 設定ファイルと設定画面が追加された

`ff8f170`（Add settings + shortcuts config files, ui for settings #117）。

- 設定は `settings.json`、ショートカットは `shortcuts.json`。置き場所は
  `TERMINAL_BROWSER_CONFIG_DIR`（絶対パス）または `XDG_CONFIG_HOME`、既定は `~/.config/terminal-browser`。
- `browser/src/session/keybindings.ts` は削除され、`settings.ts` と `browser/src/ui/settings/` が追加された。
- `browser/src/session/session.tsx` は upstream で +391 / −213。フォークの変更は終了理由の記録と
  Windows の親ペイン判定で、試験マージの衝突は 2 箇所。

### 端末アクション用のソケットが追加された

`bcf5400`（expose socket for responding to terminal browser actions #115）。
環境変数 `TERMINAL_BROWSER_TERMINAL_SOCKET` で渡されたパスへ `net.connect` する
（`shared/src/terminal-socket.ts`）。Windows の名前付きパイプで動くかは未確認。

### その他の変更

- `monitor/` パッケージが追加された。`ps`、`pgrep`、`top` を呼ぶ開発用ツールで Unix 前提。
  `scripts/bundle.sh` の差分に `monitor` は現れない。
- `scripts/release.sh` が `assets/search/` と `assets/chromium/` をステージへコピーするようになった。
  フォークの `build-windows.ps1` にも同じコピーが要る。
- `scripts/agent-browser.sh` の参照が `v0.33.0` から `v0.38.1` に上がった。
  フォークは `scripts/agent-browser.mjs` に置き換えているので、同じ版へ上げる必要がある。
- `pnpm browser` は `node scripts/dev.mjs`（開発時の再読み込み）になった。
  `spawn("pnpm", ...)` とシグナルによる停止を使う。Windows では `.cmd` をシェル無しで起動できないので、
  そのままでは動かないと推測される（※推測。未実行）。
- WebMCP 対応（`d6b53d0`）、ツールバーの React Grab ボタン（`65c0fcc`）、Ghostty のカーソル対応（`fd5f179`）。
- Electron は `pixel/packages/pixel/package.json` で `44.2.0`。現在のフォークと同じ版。
  upstream には `electron-v44.4.2` のタグもあるが、v0.13.4 がそれを使うかは未確認。
- CI: `release.yml` に `pixel-native-linux` ジョブと Pixel のビルド手順が追加された。新規 workflow は
  `pixel-release.yml`（`main` への push と `pixel-v*` タグで起動、npm へ公開）、
  `pixel-electron-build.yml`（手動）、`pixel-electron-sync.yml`（6 時間ごとの定期実行と手動）。

## 変更がどれだけ当たるか

作業ツリーを使わない試験マージ（`git merge-tree --write-tree`）で衝突を数えた。
テキスト上の衝突だけの数で、衝突せずに通った箇所の意味的な不整合（改名された API の呼び出しなど）は含まない。

### 本体: `windows-v0.11.1` に v0.13.4 をマージ

衝突 20 ファイル。

| ファイル | 衝突箇所 | 内容 |
|---|---|---|
| `cli/src/claude-bridge.ts` | 16 | フレーム経路の違い、終了診断ログ |
| `claude-code-plugin/hooks/register.tsx` | 7 | Image の `source` の違い |
| `pnpm-lock.yaml` | 4 | 再生成する |
| `README.md` | 3 | フォークは Windows 用に書き換えている |
| `cli/src/main.ts` | 3 | capability 名、終了診断ログ |
| `.github/workflows/release.yml` | 2 | フォークは Windows CI に置き換えている |
| `browser/src/main.tsx` | 2 | テレメトリ初期化と Windows のログ設定 |
| `browser/src/session/session.tsx` | 2 | 設定機能と終了理由の記録 |
| `claude-code-plugin/README.md` | 2 | |
| `claude-code-plugin/hooks/bridge-protocol.ts` | 2 | |
| `claude-code-plugin/hooks/surface.tsx` | 2 | |
| `browser/package.json` | 1 | Pixel の参照方法 |
| `browser/src/daemon.ts` | 1 | |
| `cli/package.json` | 1 | Pixel の参照方法 |
| `cli/src/setup.ts` | 1 | |
| `package.json` | 1 | スクリプトと override |
| `shared/src/index.ts` | 1 | `lifecycle` の export |
| `shared/src/paths.ts` | 1 | 名前付きパイプと設定ディレクトリ |
| `scripts/agent-browser.sh` | 変更/削除 | フォークは `.mjs` に置き換え済み |
| `shared/src/lifecycle.ts` | 改名先の扱い | フォークの新規ファイル |

### Pixel: フォークの Windows 変更に upstream の `pixel/`（v0.13.4）をマージ

衝突 12 ファイル。v0.0.15 を共通の祖先として計算した。

| ファイル | 衝突箇所 | 内容 |
|---|---|---|
| `engine/crates/pixel-core/src/terminal.rs` | 14 | Windows コンソール出力と `present/` への切り出し |
| `engine/crates/pixel-core/src/hosted.rs` | 3 | ホスト接続と upstream の shm |
| `packages/pixel/src/ssh/index.ts` | 3 | Windows の SSH |
| `engine/crates/pixel-core/src/herdr.rs` | 2 | |
| `engine/crates/pixel-core/src/engine/mod.rs` | 1 | |
| `engine/crates/pixel-node/src/record.rs` | 1 | |
| `packages/pixel/package.json` | 1 | |
| `packages/pixel/scripts/postinstall.mjs` | 1 | 標準 Electron の取得 |
| `packages/pixel/test/shell-safety.test.js` | 1 | |
| `packages/pixel/test/ssh.test.js` | 1 | |
| `engine/crates/pixel-core/src/ghostty.rs` | 変更/削除 | upstream で削除 |
| `pnpm-lock.yaml` | 変更/削除 | Pixel 単独の lock は不要になる |

フォークだけが変更していて衝突しないファイルは 21 個（`windows-console.ts`、`terminal/run.ts`、
`host/frame.ts`、`host/guest.tsx`、`web/input.ts`、`bootstrap.ts`、`native/win32-x64/package.json` など）。

## 決定が必要な事項

### 1. Pixel の持ち方

決定（2026-10-03）: upstream に合わせ、フォーク本体の `pixel/` に Windows 変更を載せる。
移行が終わったら `fukuyori/pixel` は削除する。

- `pixel.commit`、`-RequireCleanPixel`、`scripts/pixel-paths.mjs`、`file:../pixel` の override、
  CI の 2 回 checkout を廃止する。
- Windows 対応の 7 コミットは段階 2 で本体の `pixel/` に載せるので、変更内容は本体の履歴に残る。

削除すると次のものが使えなくなる。削除の前に段階 7 の条件を満たす。

- `0.11.1-win.1`（タグ `eb594b2`）と `windows-v0.11.1` ブランチは、`pixel.commit` の `5bb53b9` を
  GitHub から取得できなくなり、ソースからの再ビルドと CI 実行ができなくなる。
  公開済みの ZIP とインストーラーには影響しない。
- `README.md` と `README.ja.md` にある `fukuyori/pixel` へのリンク 2 箇所ずつが切れる。
- `docs/ci-verification.md` と前回の計画書にある `fukuyori/pixel` の記述は履歴として残るが、
  参照先は無くなる。
- GitHub 上のリポジトリ削除は取り消せない。ローカルの `D:\home\source\rust\pixel` は別に残る。

### 2. 取り込み方法

推奨: `windows-v0.11.1` から新ブランチを切り、v0.13.4 を `git merge` する。

前回は upstream の構成変更が大きく、v0.11.1 から切り直して移植した。今回はフォークの分岐点が
v0.11.1 そのものなので、通常のマージで履歴を保てる。Pixel 側は別リポジトリの 7 コミットを
`pixel/` 配下へ適用する（`git am -3 --directory=pixel` を想定。3-way に必要な元のオブジェクトは
`fukuyori/pixel` から本体リポジトリへ取得する）。この手順は未検証で、段階 0 で試す。

### 3. ブランチ名とバージョン

推奨: ブランチ `windows-v0.13.4`、バージョン `0.13.4-win.1`、インストーラーの数値版 `0.13.4.1`。
前回の規則と同じ。

### 4. 移行先

推奨: タグ v0.13.4（`fd5f179`）。`main` の 1 コミット先（#145 エージェント送信時の画像添付）は含めない。

### 5. Claude Code プラグインのフレーム経路

推奨: プラグインと bridge の構造は upstream を採り、Windows だけフォークの
ファイルフレーム + inline 画像の経路を残す。段階 0 で次を確認してから確定する。

- Windows の Claude Code が `shm` 形式の `source` を受け付けるか。
- 受け付けない場合、capability 名を upstream の `image-frames` に合わせたうえで
  プラグイン側が OS によって `source` を切り替える形にできるか。

issue #2（WezTerm）は upstream も Image 方式になったため、upstream 側の端末対応状況を見て再評価する。

### 6. テレメトリ

決定（2026-10-03）: フォークではテレメトリを止める。利用状況もクラッシュ報告も、
フォークのビルドからは upstream の PostHog プロジェクトへ送信しない。

- 止め方は段階 3 で upstream のコードに沿って決める。設定や環境変数に頼らず、
  フォークのビルドでは送信が起きない形にする。
- 設定画面の `telemetry.usage` と `telemetry.crashReports` の項目は、効果が無くなるので
  表示から外すか、送信しない旨を示す。どちらにするかも段階 3 で決める。
- upstream の未捕捉例外ハンドラーは、報告を最大 2 秒待ってから終了する。送信しない場合の
  終了の流れと、終了診断ログへの記録が保たれることを確認する。
- README（日英）に、フォークは送信しないことを書く。

### 7. upstream の新しい workflow

推奨: フォークのブランチでは `pixel-release.yml`、`pixel-electron-build.yml`、
`pixel-electron-sync.yml` を削除し、`release.yml` は現在の Windows CI を維持する。
npm 公開とパッチ済み Electron のビルドはフォークでは行わないため。

### 8. `monitor` パッケージ

推奨: Windows 対応はしない。ワークスペースには残し、型チェックだけ通す。配布物には含めない。

### 9. 設定ファイルの場所

推奨: upstream に従い `~/.config/terminal-browser`。フォークは既に `~/.local/state` などの
XDG 形式を Windows でも使っているので揃う。

### 10. `origin/main` への push

保留中。push すると upstream の `release` と `pixel-release` がフォーク上で起動する設定になっている。
移行作業そのものには不要。

## 作業手順

### 段階 0: 準備と試行

- `windows-v0.11.1` から `windows-v0.13.4` を切る。
- 現状の基準を取る: 本体テスト（store 21、browser 32、cli 36）、Pixel の JS テストと `cargo test`。
- 決定事項 2 の `git am -3 --directory=pixel` を捨てブランチで試す。
- 決定事項 5 の確認: Windows の Claude Code で `shm` 形式の `source` が通るか。
- v0.13.4 が使う Electron の版と、Windows で標準 Electron のまま描画できるかを確認する。

### 段階 1: 本体をマージする

- v0.13.4 をマージし、Pixel とプラグイン以外の衝突を解く
  （`README.md`、`package.json` 類、`browser/src/daemon.ts`、`main.tsx`、`session.tsx`、`cli/src/setup.ts`）。
- `pixel-store` の参照 20 ファイルを `shared` に置き換える。
- `lifecycle.ts`、`paths.ts` の Windows 対応、`store/test/` の 3 件を `shared/` へ移す。
- `scripts/agent-browser.mjs` を `v0.38.1` へ上げる。
- 完了条件: `pixel/` を除く本体の型チェックが通る。

### 段階 2: Pixel の Windows 変更を `pixel/` に載せる

- フォーク Pixel の 7 コミットを `pixel/` に適用する。
- `terminal.rs` の Windows コンソール出力を、`terminal/present/` に分かれた新しい描画経路へ載せ直す。
- `hosted.rs`、`herdr.rs`、`engine/mod.rs`、`pixel-node` の衝突を解く。
  `ghostty.rs` に足していた 8 行の移し先を決める。
- `packages/native/win32-x64` をワークスペースのパッケージとして追加する。
- `postinstall.mjs` の Windows 用 Electron 取得、`ssh/index.ts`、`bin.ts`、`root.tsx` を載せ直す。
- 完了条件: Pixel の型チェック、JS テスト、`cargo test`（PowerShell から）が通り、
  Windows でネイティブアドオンがビルドできる。

### 段階 3: 新機能を Windows で動かす

- Claude Code プラグインのフレーム経路（決定事項 5）。`claude-bridge.ts` と `register.tsx` の衝突を解く。
- 設定・ショートカットの設定ファイルと設定画面。
- 端末アクション用ソケットの名前付きパイプ対応。
- テレメトリを止める（決定事項 6）。
- `scripts/dev.mjs` を Windows で動くようにするか、フォークでは対象外にするかを決める。
- 終了診断ログ（`lifecycle`）が新しい終了経路をすべて覆っているか確認する。

### 段階 4: ビルド・パッケージ・署名スクリプト

- `build-windows.ps1` から `../pixel` 前提と `-RequireCleanPixel` を外し、リポジトリ内の `pixel/` をビルドする。
- `assets/search/`、`assets/chromium/` をステージへコピーする。
- `scripts/bundle.mjs` の alias を `shared` にする。
- 既定バージョンを `0.13.4-win.1` にし、`docs/version-update-checklist.md` を更新する。
- 署名スクリプトとインストーラー定義に新しい同梱物を反映する。配布物の作成はレモンが `-Sign` 付きで行う。

### 段階 5: CI

- Windows CI を 1 回の checkout に戻し、`pixel/` のビルド・型チェック・テストを同じジョブで行う。
- upstream の新しい workflow の扱いを決定事項 7 に従って反映する。
- push で検証 run を通す。

### 段階 6: 実機確認

`docs/windows-device-checks.md` の A〜G 群を新しいビルドでやり直す。追加の確認:

- 設定画面、ショートカットの変更と設定ファイルへの反映。
- WebMCP、ツールバーの React Grab ボタン。
- 描画経路の作り直し後の表示、アニメーション、サイズ変更、CPU 使用量。
- テレメトリが送信されないこと。`telemetry.jsonl` に記録が増えないことと、外向きの通信が無いことで確認する。
- issue #1 の終了診断ログが引き続き記録されること。

### 段階 7: リリース

README（日英）、CHANGELOG（日英）、プラグイン README を更新する。レモンが署名済みの ZIP と
インストーラーを作成し、F 群を確認してから `0.13.4-win.1` を公開する。

公開後に `fukuyori/pixel` を削除する。削除の前に次を確認する。

- `0.13.4-win.1` が公開済みで、本体だけの checkout から CI のビルドとテストが通っている。
- フォーク Pixel の 7 コミットの内容がすべて本体の `pixel/` に入っている。
- `README.md` と `README.ja.md` の `fukuyori/pixel` へのリンクを、本体の `pixel/` 配下に書き換えてある。
- `windows-v0.11.1` ブランチと `0.11.1-win.1` を今後ソースから再ビルドしないことを確認した。
  再ビルドの可能性を残す場合は、ローカルの Pixel リポジトリを保管しておく。

削除は取り消せない操作なので、レモンが行うか、その時点の明示的な指示で行う。

## リスクと未確認事項

- `terminal.rs` の 14 箇所。Windows のコンソール出力は前回の移行で最も手間のかかった部分で、
  upstream の描画経路の作り直しと正面から重なる。段階 2 の所要は見積もれていない。
- 描画経路の変更がファイルフレーム経路（Claude Code プラグインと 2 つ目のアプリが使う）に
  影響するかは未確認。
- Windows の Claude Code が `shm` 形式の `source` を受け付けるかは未確認。
- 端末アクション用ソケットが名前付きパイプで動くかは未確認。
- `git am -3 --directory=pixel` による適用は未検証。
- 衝突数はテキスト上のもの。衝突なく通った箇所の不整合は、段階 1 と 2 の型チェックとテストで洗い出す。
- `fukuyori/pixel` の削除後は、`0.11.1-win.1` をソースから再現できなくなる。
- upstream は v0.13.4 の後も進んでいる（`main` は 1 コミット先）。移行中に新しいタグが出た場合に
  移行先を動かすかどうかは、その時点で判断する。
