# terminal-browser for Windows

[English](README.md) · [変更履歴](CHANGELOG.ja.md)

Windowsターミナル内で動作する本物のブラウザです。

<video src="https://github.com/user-attachments/assets/abe2f43e-fc50-4866-b753-33388967945d" controls></video>

## オリジナル版との関係

このリポジトリは、[zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser)
をWindows向けに移植したフォークです。現在のリリースは上流v0.8.0を基にしています。このREADMEは
Windowsフォークだけを対象としています。

| 項目 | 上流v0.8.0 | このWindowsフォーク |
| --- | --- | --- |
| 実行環境 | オリジナルのターミナル・プロセス連携 | Win32 Console、ConPTY、名前付きパイプ、Windowsパスを使用するWindows x64移植 |
| 描画 | kitty graphicsによる描画 | WezTermのファイルフレーム転送とWindows固有のiTerm2 PNGフォールバック |
| 配布 | オリジナルのリリース処理 | Inno Setupインストーラー、バージョン付きポータブルZIP、Authenticode署名、Windowsリリース自動化 |
| SSH・セットアップ | オリジナルのSSH・skill処理 | Windows OpenSSHと`tar.exe`への対応、Windows互換のskill setup |
| バージョン | `v0.8.0` | 上流の基準版とWindows改訂番号を表す`0.8.0-win.1` |

上流から取り込んだ機能と各Windowsリリース固有の変更は、
[変更履歴](CHANGELOG.ja.md)を参照してください。

## Windows対応（実験的）

このフォークはWindows x64ネイティブビルドを提供します。PowerShell 7とWezTerm nightlyで動作確認
しています。

Windows版には次が含まれます。

- Electron、Node.js、`pixel.node`、`agent-browser`、`.cmd`ランチャーを含むユーザー単位の
  インストーラーと任意作成のポータブルZIP
- 入力、サイズ変更、マウス座標、ウェイクアップ、ターミナル復元のWin32 Console／ConPTY対応
- デーモンおよびセッションIPC用のWindows名前付きパイプ
- Windowsネイティブのパス、実行ファイル、クリップボード画像、`file://`の処理
- WezTerm nightlyを使用した高速なkittyファイルフレーム転送
- kitty graphicsの応答がConPTYを通過しない場合のiTerm2 PNGフォールバック。この経路は約15 FPSに
  制限されるため、WezTerm nightlyを推奨します
- 終了時の画像と画面の消去
- SSHプロキシとリモートバンドル

### 必要な環境

WezTerm nightlyをインストールしてください。最速の描画経路を使用するには、`wezterm.lua`でkitty
keyboardとkitty graphicsを有効にしてから、WezTermを再起動します。

```lua
config.enable_kitty_keyboard = true
config.enable_kitty_graphics = true
```

terminal-browserのインストーラーは、WezTermのインストールや設定変更を行いません。

### Windowsへのインストール

このフォークの[リリースページ](https://github.com/fukuyori/terminal-browser/releases)から
`terminal-browser-<version>-windows-x64.exe`をダウンロードして実行します。

1. WindowsでSmartScreenの警告が表示された場合は、**詳細情報 > 実行**を選択します。
2. 英語または日本語を選択し、ライセンスに同意します。
3. インストール先を選択します。既定値は`%LOCALAPPDATA%\Programs\terminal-browser`で、管理者権限は
   不要です。
4. 追加タスクを選択します。
   - **terminal-browserをユーザーPATHに追加**すると、インストール後に開いたターミナルからコマンドを
     実行できます。
   - **WezTermのスタートメニューショートカットを作成**は、WezTermがインストール済みの場合に選択
     できます。

インストール完了時にterminal-browserは自動起動しません。

### Windowsでの起動

更新された`PATH`を反映するため、新しいWezTermウィンドウを開いて実行します。

```powershell
terminal-browser
terminal-browser https://example.com
```

スタートメニューの**terminal-browser (WezTerm)**からも、新しいWezTermウィンドウで起動できます。

コマンドが見つからない場合はターミナルを開き直すか、ランチャーを直接実行します。

```powershell
& "$env:LOCALAPPDATA\Programs\terminal-browser\bin\terminal-browser.cmd" https://example.com
```

### Windowsでの終了

terminal-browserを表示しているペインで`Ctrl+Q`を押します。`Ctrl+Q`をWezTermのリーダーキーに割り当てて
いる場合は、`Ctrl+Shift+Q`を使用します。terminal-browserを起動したPowerShellセッションでは
`Ctrl+C`でも終了できます。

### Windowsからのアンインストール

**設定 > アプリ > インストールされているアプリ**を開き、**terminal-browser**の**アンインストール**を
選択します。スタートメニューのアンインストール用ショートカットからも同じ操作ができます。
アンインストール時には、インストーラーが追加したユーザー`PATH`の項目も削除されます。

### Windows版のソースビルド

```powershell
corepack pnpm install --frozen-lockfile
.\scripts\build-windows.ps1
.\scripts\package-windows-inno.ps1
```

ビルド結果の展開済みペイロードは`dist-release\terminal-browser`に出力されます。`-Zip`を追加すると、
`dist-release\terminal-browser-<version>-windows-x64.zip`も作成します。

```powershell
.\scripts\build-windows.ps1 -Zip
```

ZIPは任意作成で、サイズは約190 MBです。インストーラー作成には必要ありません。固定バージョンの
`agent-browser`は自動的にビルドされ、同梱されます。別の実行ファイルを使用する場合だけ
`-AgentBrowserPath C:\path\to\agent-browser.exe`を指定します。

`package-windows-inno.ps1`の実行にはInno Setup 6が必要です。出力は
`dist-release\terminal-browser-<version>-windows-x64.exe`です。インストーラーは英語と日本語、
ユーザー単位のインストール、ユーザー`PATH`の変更、WezTermショートカットに対応しています。

### Windows版のバージョン

Windowsフォークのバージョンは、上流バージョンとフォークの改訂番号を組み合わせます。たとえば
`0.8.0-win.1`は、上流v0.8.0を基にした最初のWindowsリリースです。

既定値は`scripts\build-windows.ps1`の`Version`で設定します。一時的に変更する場合は`-Version`を
指定します。この値は`VERSION`へ書き込まれ、`terminal-browser --version`で表示されます。

Inno Setupでは4要素の数値バージョンが必要なため、`0.8.0-win.1`はインストーラー内で`0.8.0.1`に
なります。この形式以外のバージョンでは、インストーラーのバージョンとして`0.0.0.0`を使用します。

`terminal-browser upgrade`はWindowsフォークを自動更新しません。Windowsで実行すると処理を中止し、
このフォークのリリースページを案内します。

## 使い方

```text
terminal-browser
terminal-browser open <url>
terminal-browser --split right
terminal-browser open --ssh <user@host> <url>
terminal-browser ls
terminal-browser action
```

- `terminal-browser`：ブラウザを起動します。
- `open <url>`：URLを開きます。
- `--split right`：右側のペインにブラウザを開きます。
- `open --ssh`：ブラウザのネットワーク通信をリモートサーバー経由にします。
- `ls`：開いているブラウザを一覧表示します。
- `action`：開いているブラウザを操作するagent-browser互換CLIを提供します。

## 使用例

- コーディングエージェントとWebサイトを同じターミナルタブに表示する
- エージェントから開いているterminal-browserを操作する
- HTMLで作成した計画をエージェントの隣に自動表示する
- SSH経由でリモートマシン上のサービスをプレビューする

## エージェント連携

### エージェントskillの導入

terminal-browserのインストール後にsetupを実行します。

```powershell
terminal-browser setup
```

setupは、存在する対応エージェントの設定ディレクトリへ、同梱された`terminal-browser` skillのリンクを
作成します。生成済みマニフェストはClaude Code、Codex、Cursor、Geminiに対応し、共有skillも
`.agents\skills`へ導入します。また、対応するターミナルとエディターの設定も適用します。

このskillは、会話の隣にページを開き、既存ブラウザを操作する方法をエージェントへ伝えます。右側の
分割ペインへ開く例は次のとおりです。

```powershell
terminal-browser open https://example.com --split right
```

### 開いているブラウザの操作

エージェントはagent-browser互換の`action`コマンドを使用できます。対象を指定しなければ、現在の
ターミナルタブにあるブラウザと、そのブラウザで選択中のタブを操作します。

```powershell
terminal-browser ls
terminal-browser action -- snapshot
terminal-browser action -- click @e14
terminal-browser action -- fill @e3 "hello"
terminal-browser action -- eval "document.title"
terminal-browser action done
```

`terminal-browser ls`はブラウザキーとタブIDを表示します。複数のブラウザまたはタブがある場合は、その値で
操作対象を指定します。

```powershell
terminal-browser action --browser 90107-1 --tab 2 --follow -- fill @e3 "hello"
```

- `--browser <key>`：実行中のブラウザを選択します。
- `--tab <id>`：ブラウザ内のタブを選択します。
- `--target <id>`：CDPターゲットを直接選択します。
- `--follow`：コマンド実行前に選択したタブを前面へ表示します。
- `terminal-browser action done`：エージェント操作中のインジケーターをすぐに消します。`done`を実行
  しなくても、エージェント操作が一定時間なければ自動的に消えます。

### ページ要素をエージェントへ送る

`Ctrl+G`を押すか、ページメニューの**send to agent**を選択してから、ページ上の要素を選びます。
選択内容はクリップボードへコピーされ、同じターミナルタブ内で検出されたコーディングエージェントの
ペインへ送信されます。エージェントのペインを検出できない場合はクリップボードに残るため、手動で貼り
付けられます。

## Windowsショートカット

| 操作 | ショートカット |
| --- | --- |
| 終了 | `Ctrl+Q`。`Ctrl+Q`がWezTermのリーダーキーの場合は`Ctrl+Shift+Q` |
| 新しいタブ | `Ctrl+T` |
| コマンドパレット | `Ctrl+K`または`Alt+K` |
| ページ内検索 | `Ctrl+Shift+F` |
| 次／前の一致項目 | `Enter`／`Shift+Enter` |
| 戻る／進む | `Ctrl+[`／`Ctrl+]` |
| DevTools | `Ctrl+Shift+I`または`F12` |
| DevToolsコンソール | `Ctrl+Alt+J` |
| 記録の開始／停止 | `Ctrl+Shift+R` |
| 記録レビューの完了 | `Ctrl+Enter` |
| エージェントへ送る要素を選択 | `Ctrl+G` |
| ポップアップまたはオーバーレイを閉じる | `Escape` |

## 動作の仕組み

WezTermはkitty graphics protocolを使用してターミナル内へピクセルを表示できます。terminal-browserは
この機能を使用して、Chromiumが生成したフレームを表示します。

ElectronのオフスクリーンレンダリングAPIを使用し、ChromiumのピクセルをGPUから直接読み取ります。
ターミナルから得たマウス、ポインター、キーボード入力は、Chromiumの合成イベントへ変換します。
WindowsではRustエンジンがWin32 ConsoleとConPTYを通じてこれらの入力を取得します。

ブラウザ外枠のUIはRust製グラフィックスエンジン上で動作します。UIはReactとカスタムレンダラーを使用して
TypeScriptで定義されています。ブラウザの内容と外枠を同じキャンバスへ描画するため、ページ上にUI要素を
重ねて表示できます。

## SSH

```text
terminal-browser open --ssh <user@host> <url>
```

Chromiumと描画処理はローカルコンピューター上で動作し、ブラウザのネットワーク通信だけをSSHサーバー経由
にします。これにより、リモートサーバーの`localhost`だけで待ち受けているサービスもローカルブラウザから
利用できます。

SSHセッション内でterminal-browserを直接実行することもできますが、すべてのフレームと入力をネットワーク
経由で送る必要があります。また、kitty graphics protocolの
[ローカルクライアント最適化](https://sw.kovidgoyal.net/kitty/graphics-protocol/#local-client)は使用できません。

WindowsではOpenSSH Clientと`tar.exe`が`PATH`に必要です。SSH設定のホストエイリアスも使用できます。
`--ssh-bundle`の接続先はUnixリモートです。Windowsでは複数のSSH接続を開く場合があるため、鍵認証または
`ssh-agent`を推奨します。

## アプリモード

terminal-browserを使用し、ブラウザ技術でターミナルアプリを構築できます。実際の使用例は
[terminal-code](https://github.com/zenbu-labs/terminal-code)を参照してください。

terminal-browserを開くときに`--app-mode`を指定します。任意指定の`--preload`と`--main-script`では、
Electronの[preload script](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)とメインプロセスを
使用します。

`terminal-browser open`で使用できるアプリ関連オプションは次のとおりです。

```text
  --preload=<path>      ページ読み込み前に、分離されたworldでElectronのpreload scriptを実行します。
                        terminal-browser固有APIをglobalThis.terminalBrowserで公開します。
                        {
                          theme: () => { background: [r,g,b], foreground: [r,g,b], ansi: ([r,g,b] | null)[] } | null,
                          onTheme: (cb: (theme: Theme) => void) => () => void,
                          quit: () => void
                        }
                        --terminal-browser-session=<key>はレンダラープロセスのprocess.argvへ渡されます。
  --main-script=<path>  Electronメインプロセス内でNode.jsスクリプトを実行します。
  --open-tabs-in-popup-stack
                        新しいタブで開くリンクを、ページ上のポップアップとして開きます。
  --allow-clipboard-read
                        Webサイトによるクリップボードの読み取りを許可します。
  --no-toolbar          ツールバーとタブバーを表示しません。
  --no-shortcuts        ブラウザショートカットを無効にし、キー入力をページへ渡します。
  --no-context-menu     右クリックメニューを表示しません。
  --no-overlays         トーストやHUDをページ上に表示しません。
  --no-frame            枠と余白をなくし、ページをペイン全体に表示します。
  --app-mode            --no-toolbar --no-shortcuts
                        --no-context-menu --no-overlays --no-frame
                        --allow-clipboard-read --open-tabs-in-popup-stackの短縮指定です。
  --ssh-bundle <dir>    リモートサーバーへバンドルをインストールして実行します。
                        --app-modeおよび--sshと組み合わせて、リモートでアプリケーション
                        サーバーを実行し、その出力をSSH経由で表示できます。
  --ssh-bundle-dir <dir>
                        --ssh-bundleのリモートインストール先です。既定値は
                        ${XDG_DATA_HOME:-~/.local/share}/terminal-browser/bundlesです。
```

## コントリビューション

- PRの説明は人間が作成し、内容を説明してください。
- 変更の目的を明確にしてください。
- レビュー可能な小さなPRにしてください。

ローカル開発環境のセットアップには、コーディングエージェントの利用を推奨します。

### ターミナル対応の追加

terminal-browser CLIの一部のサブコマンドは、ターミナルまたはマルチプレクサーのスクリプト機能を使用
します。別のターミナルに対応する場合は、
[既存の実装](https://github.com/zenbu-labs/terminal-browser/tree/main/terminals/src/terminals)を参照してください。

## コミュニティ

[Discord](https://discord.gg/t3jzHHfc6z)

## 謝辞

- kitty graphics protocolを開発した[kitty](https://github.com/kovidgoyal/kitty)
- Chromiumをターミナルへ組み込む最初の試みである[awrit](https://github.com/chase/awrit)
