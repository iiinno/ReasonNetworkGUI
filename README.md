# Reason Network GUI

Reason Network に参加しているエージェントの状態、Codex の会話、常駐 `serve` のログ、受信メッセージを 1 か所で確認する Windows 向けデスクトップアプリです。Tauri v2、Vite、TypeScript で構成し、画面は追加の UI フレームワークを使わない vanilla TS です。

## 起動方法

前提:

- Node.js と npm
- Rust の stable toolchain
- Microsoft Edge WebView2 Runtime
- `%LOCALAPPDATA%\Reason\bin\reason.exe`

```powershell
npm install
npm run tauri dev
```

本番ビルド:

```powershell
npm run tauri build
```

`npm run build` は TypeScript の型検査と Vite のフロントエンドビルドだけを実行します。

## 画面

- 左端のレールから Agents、Codex sessions、Serve log、Inbox を切り替えます。
- Agents は `who --json` のセッションを person ごとにまとめ、busy / idle / offline、repo@branch、現在の作業を表示します。
- Codex sessions は `%USERPROFILE%\.codex\sessions` 配下の新しい `rollout-*.jsonl` を選び、user と assistant の本文を会話として表示します。
- Serve log は `%USERPROFILE%\muse-reason\serve.log` の末尾を ANSI エスケープ除去後に表示します。
- Inbox は `reason.exe network inbox` の出力を表示します。
- Agent を選ぶと送信欄が出ます。送信ボタンまたは `Ctrl + Enter` で確認ダイアログを開き、承認した場合だけ `reason.exe network send <address> "<message>"` を実行します。
- 表示は 5 秒ごとに更新します。取得元ごとにエラーを保持するため、1 つの取得失敗でアプリ全体は停止しません。

## データソース

| 画面 | 取得方法 | 備考 |
| --- | --- | --- |
| Agents | `reason.exe network who --json` | `{ team, person, machine, machines, sessions }` と各 session の `address/name/person/machine/agent/repo/branch/status/since/doing/worker/tier` に対応 |
| Codex | `%USERPROFILE%\.codex\sessions\**\rollout-*.jsonl` | 最大 60 ファイルを新しい順に一覧化。選択時に直近 200 件の user / assistant 本文を読む |
| Serve | `%USERPROFILE%\muse-reason\serve.log` | UTF-8 と UTF-16 の混在を行ごとに判定して復号し、ANSI 制御文字を除去 |
| Inbox | `reason.exe network inbox` | CLI の標準出力を表示 |
| Send | `reason.exe network send <address> "<message>"` | 確認ダイアログ後のみ実行。引数はシェル経由ではなくプロセス引数として渡す |

## 構成

- `src/main.ts` は画面状態、5 秒ポーリング、一覧と詳細の描画、送信確認を担当します。
- `src/dom.ts` はキーを持つ DOM を再利用し、変更箇所だけを更新します。同一内容の描画はスキップします。
- `src/agent-colors.ts` はアドレスのハッシュから色相を決め、一覧・詳細・ログに共通の色を使います。セッションのエージェント表示は作業フォルダーの一致から関連付けるため、所有者の確定情報ではありません。
- `src/style.css` と `src/style-variables.css` は Obsidian 公式 CSS 変数名を使ったレイアウトとダーク / ライトテーマを担当します。
- `src/tauri.ts` は Tauri v2 の IPC だけを包む小さな境界です。
- `src-tauri/src/domain.rs` は IPC のデータ形状を定義します。
- `src-tauri/src/services.rs` は許可したローカルファイルと Reason CLI へのアクセス、JSONL 解析、文字コード処理を担当します。

`SourceState<T>` は取得元ごとに `ok` または `error` を持つ判別可能な共用体です。Agent の一覧、Inbox、Serve log、Codex sessions は互いに独立して成功・失敗できます。

## アクセス範囲

読み書き先は次に限定しています。

- `%LOCALAPPDATA%\Reason\bin\reason.exe` の実行
- `%USERPROFILE%\muse-reason\serve.log` の読み取り
- `%USERPROFILE%\.codex\sessions` 配下の `rollout-*.jsonl` の読み取り
- ユーザーが確認した Reason Network 宛メッセージの送信

Codex セッションを開くときは、指定パスを正規化したうえで sessions フォルダ内の `rollout-*.jsonl` であることを確認します。Reason の設定、ネットワーク DB、スケジュールタスクなどは変更しません。テレメトリや外部 API への送信もありません。

## 検証状況

2026-10-28 時点:

- `npm run build` は成功。TypeScript の `--noEmit` 型検査と Vite の本番ビルドを実行しました。Windows PowerShell の実行ポリシーにより、この環境では `npm.cmd` を使用しています。
- `src-tauri` での `cargo test --offline` は 11 件すべて成功。UTF-8 と UTF-16LE の混在、BOM の有無、空行、日本語中心の長い行、改行バイトを含む漢字、UTF-16BE、書き込み途中の末尾を確認しました。ANSI 除去、`who` JSON、会話抽出の既存テストも含みます。
- Chrome 上で `scripts/verify-ui.html` の 16 項目が成功。同一データのポーリングで本文と一覧の DOM 変更がないこと、更新時の送信欄・日本語の下書き・フォーカス・選択位置・スクロールの保持、エージェント切り替え時の下書き復元、ログ追記と会話更新時の既存 DOM の再利用を確認しました。
- 同じ確認ページで、一覧・詳細ヘッダー・Serve ログ・関連セッションの色の一致と、色計算のモジュールを再ロードしても同じアドレスの色相が変わらないことを確認しました。色は CSS 変数による HSL で生成し、名前も併記します。
- `npm run tauri build` は Rust の release ビルドと新しい `src-tauri\target\release\reason-network-gui.exe` の生成まで成功しました。ただし MSI 作成時に Windows Installer サービスへアクセスできず、WiX の `LGHT0217` でコマンド全体は失敗しています。
- `npm run tauri build -- --no-bundle` は成功。インストーラーを作らずに exe を生成する経路も確認しました。通常の `npm run tauri build` の成功を意味するものではありません。
- 18:52 に `--no-bundle` で生成した新 exe を 18:54 に起動し、プロセスの継続稼働、`Reason Network` ウィンドウの存在、応答状態を確認しました。通常起動では WebView2 が `0x800700AA`（リソース使用中）で終了したため、起動プロセスに限って `WEBVIEW2_USER_DATA_FOLDER` を `src-tauri\target\release\webview-profile` に指定しています。実ウィンドウでの IPC と点滅解消の目視確認は未実施です。

UI の回帰確認を再実行するには、`npm run dev -- --configLoader runner` を実行して `http://127.0.0.1:1420/scripts/verify-ui.html` を Chrome で開きます。右上に `PASS: 16 checks` が表示されます。このページは IPC をローカルの固定データに置き換え、Reason CLI や実ネットワークへ接続しません。ポーリングのコールバックを手動で進めるため、実時間での 5 秒間隔や WebView2 の描画を検証するものではありません。

Reason の設定変更やテスト送信は行っていません。フロントエンドビルド、インストーラーなしの exe 生成と起動は確認済みです。MSI 作成はこの環境の Windows Installer アクセス制限により未完了です。

## 判断メモ

- この実行環境では `reason.exe network who --json` が OS のアクセス拒否 `os error 5` で失敗しました。実装は Reason CLI 内の `who --json` 出力契約に合わせ、実行失敗時は Agents とステータスバーにエラーを表示する経路にしています。実ネットワーク応答での表示確認は未実施です。
- `serve.log` の復号はファイル全体のゼロバイト比率から行単位の判定へ変更しました。有効な UTF-8 行を優先し、UTF-16 はコード単位で改行を探すため、漢字のバイト列を改行と取り違えません。BOM のないデータには文字コードが一意に定まらない場合があるため、判定には内容と直前の文字コードを使います。
- Codex の JSONL には developer 指示、ツール呼び出し、reasoning、暗号化 content が混在します。会話画面には `response_item` の user / assistant 本文だけを出し、環境コンテキストや skill 注入ブロックは読みやすさのため除去します。
- テスト送信は仕様どおり行っていません。送信確認 UI とプロセス引数の組み立てだけを実装しています。

## License

MIT License. See [LICENSE](LICENSE).
