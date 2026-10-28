# タスク：Reason Network 用デスクトップ GUI「ReasonNetworkGUI」の新規開発

作業フォルダ： `C:\Users\inoue\Project\ReasonNetworkGUI`（空の状態から構築する）
スタック： Tauri v2 + Vite + TypeScript（フロントは React か vanilla TS のうち軽い方を選ぶ）。Windows 向け。

## 背景

Reason Network はコーディングエージェント同士が通信する P2P ネットワーク。この PC には Reason CLI が入っており、Codex が `reason network serve codex` で常駐している。しかしやり取りは各エージェントの中にしか表示されず、ユーザーが「誰が何をしているか」「どんな依頼と返答があったか」を確認する窓がない。その確認用 GUI を作ることが目的。

## データソース（すべてこの PC のローカルで取得する）

1. 参加者・状態： `%LOCALAPPDATA%\Reason\bin\reason.exe network who --json` を定期実行（5 秒間隔程度）して表示する。セッションごとに person、address、machine、agent、repo@branch、busy/idle、doing（現在の作業内容）が出る想定。実際の JSON 構造は実行して確認し、それに合わせる。
2. 常駐 Codex（serve）のログ： `C:\Users\inoue\muse-reason\serve.log`。ANSI エスケープ混じりのテキストなので、表示時に除去する。末尾を読んで依頼と返答の流れを表示する。
3. Codex のセッション記録： `%USERPROFILE%\.codex\sessions\` 配下の `rollout-*.jsonl`（新しい順）。JSONL をパースして直近の会話を読みやすく表示する。
4. ユーザー宛メッセージ： `reason.exe network inbox` の出力を表示する。
5. 送信： 入力欄から、選択したセッション宛に `reason.exe network send <address> "<message>"` で送信できるようにする。送信前に確認ダイアログを出す。

取得に失敗した場合はエラーをステータスバーに表示し、アプリは落とさない。

## デザイン（最重要）：Obsidian の公式デザインシステムに寄せる

- Obsidian 公式の CSS variables 仕様（https://docs.obsidian.md/Reference/CSS+variables/CSS+variables ）に倣い、**公式と同じ変数名**でテーマを定義する： `--background-primary`、`--background-primary-alt`、`--background-secondary`、`--background-secondary-alt`、`--background-modifier-border`、`--background-modifier-border-focus`、`--text-normal`、`--text-muted`、`--text-faint`、`--text-accent`、`--interactive-normal`、`--interactive-hover`、`--interactive-accent`、`--interactive-accent-hover`、`--radius-s`、`--radius-m`、`--radius-l`、`--font-ui-smaller`、`--font-ui-small`、`--font-ui-medium`、`--font-monospace` など。
- 値は Obsidian のダークテーマの実値を使う（背景は #1e1e1e 系のグレースケール、アクセントは Obsidian パープル hsl(258, 88%, 66%)）。
- レイアウトは Obsidian のワークスペース構成： 左端に細いリボン（アイコン列）、左サイドバー（セッション一覧）、メイン領域（選択したセッションのログ／会話）、下端にステータスバー。
- 余白は 4px グリッド（`--size-4-1`=4px、`--size-4-2`=8px、`--size-4-4`=16px、`--size-4-6`=24px）。
- 色のハードコードは避け、必ず変数経由にする（将来 Obsidian の theme.css を流し込めるように）。

## 実装手順

1. このフォルダに Tauri v2 プロジェクトをスキャフォールドする（対話プロンプトなしで実行できる方法を使う）。
2. Rust 側（src-tauri）にコマンドを実装する： who 取得（reason.exe 実行）、serve.log 読み取り、sessions の jsonl 読み取りとパース、inbox 取得、send 実行。アクセスするパスは上記のファイル／実行ファイルに限定する。
3. フロントエンドで上記レイアウトと各ビューを実装する。自動更新はポーリングでよい。
4. 検証： `npm install` → フロントの build → `cargo check`（src-tauri）まで通す。可能なら `npm run tauri build` まで行い、失敗した場合は原因と残作業を README に正直に書く。
5. README.md に、概要・起動方法（`npm run tauri dev`）・データソース・既知の制限を書く。

## 制約

- 変更はこのプロジェクトフォルダの中だけ。Reason の既存セットアップ（`C:\Users\inoue\.reason`、`C:\Users\inoue\muse-reason` 配下、スケジュールタスク等）は読み取りのみで変更しない。
- ネットワークへの書き込みは、上記「送信」機能の実装に限る。テスト送信はしない。
- 依存は必要最小限に。重い UI フレームワークは使わない。
- 途中で判断に迷う点があれば、勝手に広げず、最小の解釈で進めて README の「判断メモ」に残す。
