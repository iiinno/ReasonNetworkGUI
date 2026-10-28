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
| Serve | `%USERPROFILE%\muse-reason\serve.log` | BOM なし UTF-16LE を含む出力をゼロバイト比率で判定し、ANSI 制御文字を除去 |
| Inbox | `reason.exe network inbox` | CLI の標準出力を表示 |
| Send | `reason.exe network send <address> "<message>"` | 確認ダイアログ後のみ実行。引数はシェル経由ではなくプロセス引数として渡す |

## 構成

- `src/main.ts` は画面状態、5 秒ポーリング、一覧と詳細の描画、送信確認を担当します。
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

## 検証結果

2026-10-28 時点:

- TypeScript の `--noEmit` 型検査は成功。
- Vite の本番フロントエンドビルドは成功。
- `cargo check --offline` は成功。
- `cargo test --offline` は 5 件すべて成功。UTF-16LE ログ、ANSI 除去、`who` JSON、会話抽出、ハーネス文脈の除去を確認。
- `cargo build --release --offline` は成功し、生成した `dist` を埋め込んだ `src-tauri\target\release\reason-network-gui.exe` を作成。
- Chrome 上の Vite preview とモック IPC で、Agents、会話、Serve log、Inbox、送信確認、取得失敗表示、ライトテーマ、幅 760px の狭いレイアウトを確認。
- `reason.exe` のバージョンは `0.2.623`。

`npm install` はこの実行環境のネットワーク制限で npm registry に接続できず完了していません。そのため `npm run tauri build` は未実行です。上記のフロントエンドビルドは、ローカルに既存だった Vite 実行物を使って `dist` の生成まで確認しています。通常のネットワーク環境では README の起動手順から依存関係を取得してください。

生成した Tauri 実行ファイル自体は完成していますが、このエージェント実行環境ではネイティブウィンドウのセットアップが OS のアクセス拒否 `os error 5` で止まりました。同じ制限は `reason.exe network who --json` でも発生しています。そのため、実ウィンドウ上での IPC 接続確認は未実施です。

## 判断メモ

- この実行環境では `reason.exe network who --json` が OS のアクセス拒否 `os error 5` で失敗しました。実装は Reason CLI 内の `who --json` 出力契約に合わせ、実行失敗時は Agents とステータスバーにエラーを表示する経路にしています。実ネットワーク応答での表示確認は未実施です。
- `serve.log` は BOM のない UTF-16LE 風のバイト列と ANSI エスケープを含みます。UTF-8 固定にせず、内容から文字コードを判定する方式にしました。
- Codex の JSONL には developer 指示、ツール呼び出し、reasoning、暗号化 content が混在します。会話画面には `response_item` の user / assistant 本文だけを出し、環境コンテキストや skill 注入ブロックは読みやすさのため除去します。
- テスト送信は仕様どおり行っていません。送信確認 UI とプロセス引数の組み立てだけを実装しています。

## License

MIT License. See [LICENSE](LICENSE).
