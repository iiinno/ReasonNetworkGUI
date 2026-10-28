use crate::domain::{
    AgentDirectory, ConversationMessage, Dashboard, SessionDetail, SessionSummary, SourceState,
};
use serde_json::Value;
use std::{
    collections::VecDeque,
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_SESSION_FILES: usize = 60;
const MAX_DETAIL_MESSAGES: usize = 200;
const MAX_MESSAGE_CHARS: usize = 80_000;
const MAX_SERVE_LOG_CHARS: usize = 200_000;

pub fn collect_dashboard() -> Dashboard {
    Dashboard {
        generated_at: now_ms(),
        agents: SourceState::from_result(load_agents()),
        inbox: SourceState::from_result(load_inbox()),
        serve_log: SourceState::from_result(load_serve_log()),
        sessions: SourceState::from_result(list_sessions()),
    }
}

pub fn load_session(path: &str) -> Result<SessionDetail, String> {
    let requested = PathBuf::from(path);
    let root = sessions_root()?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Codex sessions フォルダを解決できません: {error}"))?;
    let canonical = requested
        .canonicalize()
        .map_err(|error| format!("セッションファイルを開けません: {error}"))?;

    if !canonical.starts_with(&root) {
        return Err("セッションファイルが Codex sessions フォルダの外にあります。".to_string());
    }
    if !is_rollout_file(&canonical) {
        return Err("rollout-*.jsonl 以外は開けません。".to_string());
    }

    let updated_at = metadata_ms(&canonical)?;
    read_session_detail(&canonical, updated_at)
}

pub fn send_network_message(address: &str, message: &str) -> Result<String, String> {
    let address = address.trim();
    let message = message.trim();
    if address.is_empty() {
        return Err("送信先アドレスが空です。".to_string());
    }
    if message.is_empty() {
        return Err("メッセージが空です。".to_string());
    }
    if message.chars().count() > 50_000 {
        return Err("メッセージが長すぎます（上限 50,000 文字）。".to_string());
    }
    if address.starts_with('-')
        || address
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("送信先アドレスの形式が不正です。".to_string());
    }

    run_reason(&["network", "send", address, message])
}

fn load_agents() -> Result<AgentDirectory, String> {
    let output = run_reason(&["network", "who", "--json"])?;
    let json_slice = json_slice(&output)
        .ok_or_else(|| "Reason Network の who 出力に JSON がありません。".to_string())?;
    serde_json::from_str::<AgentDirectory>(json_slice)
        .map_err(|error| format!("who --json を解釈できません: {error}"))
}

fn load_inbox() -> Result<String, String> {
    let output = run_reason(&["network", "inbox"])?;
    let cleaned = clean_terminal_text(&output);
    if cleaned.trim().is_empty() {
        Ok("新しいメッセージはありません。".to_string())
    } else {
        Ok(cleaned)
    }
}

fn load_serve_log() -> Result<String, String> {
    let path = serve_log_path()?;
    let bytes = fs::read(&path)
        .map_err(|error| format!("serve.log を読めません ({}): {error}", path.display()))?;
    let decoded = decode_text_file(&bytes);
    let cleaned = clean_terminal_text(&decoded);
    Ok(tail_chars(&cleaned, MAX_SERVE_LOG_CHARS))
}

fn run_reason(arguments: &[&str]) -> Result<String, String> {
    let executable = reason_executable()?;
    let mut command = Command::new(&executable);
    command.args(arguments);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|error| {
        format!(
            "Reason CLI を起動できません ({}): {error}",
            executable.display()
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = clean_terminal_text(&String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        return Ok(stdout);
    }

    let detail = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    Err(format!(
        "reason.exe {} が失敗しました: {}",
        arguments.join(" "),
        detail.trim()
    ))
}

fn reason_executable() -> Result<PathBuf, String> {
    let local_app_data =
        env::var_os("LOCALAPPDATA").ok_or_else(|| "LOCALAPPDATA が未設定です。".to_string())?;
    let path = PathBuf::from(local_app_data)
        .join("Reason")
        .join("bin")
        .join("reason.exe");
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("Reason CLI が見つかりません: {}", path.display()))
    }
}

fn serve_log_path() -> Result<PathBuf, String> {
    let profile =
        env::var_os("USERPROFILE").ok_or_else(|| "USERPROFILE が未設定です。".to_string())?;
    Ok(PathBuf::from(profile).join("muse-reason").join("serve.log"))
}

fn sessions_root() -> Result<PathBuf, String> {
    let profile =
        env::var_os("USERPROFILE").ok_or_else(|| "USERPROFILE が未設定です。".to_string())?;
    let root = PathBuf::from(profile).join(".codex").join("sessions");
    if root.is_dir() {
        Ok(root)
    } else {
        Err(format!(
            "Codex sessions フォルダが見つかりません: {}",
            root.display()
        ))
    }
}

fn list_sessions() -> Result<Vec<SessionSummary>, String> {
    let root = sessions_root()?;
    let mut files = Vec::new();
    collect_rollout_files(&root, &mut files)?;
    files.sort_by_key(|path| metadata_ms(path).unwrap_or(0));
    files.reverse();
    files.truncate(MAX_SESSION_FILES);

    files
        .into_iter()
        .map(|path| summarize_session(&path))
        .collect()
}

fn collect_rollout_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "sessions を列挙できません ({}): {error}",
            directory.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("sessions の項目を読めません: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("sessions の種類を読めません: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_rollout_files(&path, files)?;
        } else if is_rollout_file(&path) {
            files.push(path);
        }
    }
    Ok(())
}

fn is_rollout_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    name.starts_with("rollout-")
        && path.extension().and_then(|value| value.to_str()) == Some("jsonl")
}

fn summarize_session(path: &Path) -> Result<SessionSummary, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("セッションを開けません ({}): {error}", path.display()))?;
    let reader = BufReader::new(file);
    let mut session_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("session")
        .to_string();
    let mut cwd = String::new();
    let mut title = String::new();

    for line in reader.lines().take(120) {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            if let Some(payload) = value.get("payload") {
                session_id = string_at(payload, "session_id")
                    .or_else(|| string_at(payload, "id"))
                    .unwrap_or(session_id);
                cwd = string_at(payload, "cwd").unwrap_or(cwd);
            }
        }
        if title.is_empty() {
            if let Some(message) = conversation_message(&value) {
                if message.role == "user" {
                    if let Some(candidate) = title_from_user_text(&message.text) {
                        title = candidate;
                    }
                }
            }
        }
        if !cwd.is_empty() && !title.is_empty() {
            break;
        }
    }

    if title.is_empty() {
        title = path
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .map(|value| format!("Codex session {value}"))
            .unwrap_or_else(|| "Codex session".to_string());
    }

    Ok(SessionSummary {
        id: session_id,
        path: path.to_string_lossy().to_string(),
        title,
        cwd,
        updated_at: metadata_ms(path)?,
    })
}

fn read_session_detail(path: &Path, updated_at: u64) -> Result<SessionDetail, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("セッションを開けません ({}): {error}", path.display()))?;
    let reader = BufReader::new(file);
    let mut session_id = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("session")
        .to_string();
    let mut cwd = String::new();
    let mut title = String::new();
    let mut messages = VecDeque::with_capacity(MAX_DETAIL_MESSAGES);

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            if let Some(payload) = value.get("payload") {
                session_id = string_at(payload, "session_id")
                    .or_else(|| string_at(payload, "id"))
                    .unwrap_or(session_id);
                cwd = string_at(payload, "cwd").unwrap_or(cwd);
            }
            continue;
        }

        if let Some(mut message) = conversation_message(&value) {
            if title.is_empty() && message.role == "user" {
                if let Some(candidate) = title_from_user_text(&message.text) {
                    title = candidate;
                }
            }
            message.text = truncate_chars(&message.text, MAX_MESSAGE_CHARS);
            if messages.len() == MAX_DETAIL_MESSAGES {
                messages.pop_front();
            }
            messages.push_back(message);
        }
    }

    if title.is_empty() {
        title = "Codex session".to_string();
    }

    Ok(SessionDetail {
        id: session_id,
        title,
        cwd,
        updated_at,
        messages: messages.into_iter().collect(),
    })
}

fn conversation_message(value: &Value) -> Option<ConversationMessage> {
    if value.get("type").and_then(Value::as_str) != Some("response_item") {
        return None;
    }
    let payload = value.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("message") {
        return None;
    }
    let role = payload.get("role").and_then(Value::as_str)?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let text = payload
        .get("content")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|part| {
            let part_type = part.get("type").and_then(Value::as_str)?;
            if part_type == "input_text" || part_type == "output_text" {
                part.get("text")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let text = clean_user_message_text(role, &text);
    if text.trim().is_empty() {
        None
    } else {
        Some(ConversationMessage {
            role: role.to_string(),
            text,
        })
    }
}

fn clean_user_message_text(role: &str, text: &str) -> String {
    if role != "user" {
        return text.to_string();
    }
    let trimmed = text.trim();
    if (trimmed.starts_with("<environment_context>") && trimmed.ends_with("</environment_context>"))
        || (trimmed.starts_with("<skill>") && trimmed.ends_with("</skill>"))
    {
        return String::new();
    }

    let markers = ["</INSTRUCTIONS>", "</environment_context>"];
    let cut = markers
        .iter()
        .filter_map(|marker| text.rfind(marker).map(|index| index + marker.len()))
        .max();
    if let Some(index) = cut {
        let after = text[index..].trim();
        if !after.is_empty() {
            return after.to_string();
        }
    }
    if let Some(index) = text.rfind("<environment_context>") {
        let before = text[..index].trim();
        if !before.is_empty() {
            return before.to_string();
        }
    }
    text.to_string()
}

fn title_from_user_text(text: &str) -> Option<String> {
    let preferred = text
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with('<')
                && !line.starts_with("```")
                && *line != "# AGENTS.md instructions"
        })
        .next_back()?;
    Some(truncate_chars(preferred, 72))
}

fn string_at(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn json_slice(value: &str) -> Option<&str> {
    let start = value.find('{')?;
    let end = value.rfind('}')?;
    (end >= start).then_some(&value[start..=end])
}

fn metadata_ms(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| format!("更新時刻を読めません ({}): {error}", path.display()))?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn decode_text_file(bytes: &[u8]) -> String {
    let mut remaining = bytes;
    let mut result = String::with_capacity(bytes.len());
    let mut previous = LogEncoding::Utf8;
    while !remaining.is_empty() {
        let (encoding, bom_length) = if remaining.starts_with(&[0xff, 0xfe]) {
            (LogEncoding::Utf16Le, 2)
        } else if remaining.starts_with(&[0xfe, 0xff]) {
            (LogEncoding::Utf16Be, 2)
        } else if remaining.starts_with(&[0xef, 0xbb, 0xbf]) {
            (LogEncoding::Utf8, 3)
        } else {
            (detect_log_encoding(remaining, previous), 0)
        };
        remaining = &remaining[bom_length..];
        let end = log_record_end(remaining, encoding);
        let record = &remaining[..end];
        match encoding {
            LogEncoding::Utf8 => result.push_str(&String::from_utf8_lossy(record)),
            encoding => {
                let units = record
                    .chunks_exact(2)
                    .map(|pair| encoding.unit(pair))
                    .collect::<Vec<_>>();
                result.push_str(&String::from_utf16_lossy(&units));
                if record.len() % 2 != 0 {
                    result.push('\u{fffd}');
                }
            }
        }
        remaining = &remaining[end..];
        previous = encoding;
    }
    result
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LogEncoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

impl LogEncoding {
    fn unit(self, pair: &[u8]) -> u16 {
        match self {
            Self::Utf16Be => u16::from_be_bytes([pair[0], pair[1]]),
            _ => u16::from_le_bytes([pair[0], pair[1]]),
        }
    }
}

fn log_record_end(bytes: &[u8], encoding: LogEncoding) -> usize {
    match encoding {
        LogEncoding::Utf8 => bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(bytes.len(), |index| index + 1),
        encoding => bytes
            .chunks_exact(2)
            .position(|pair| encoding.unit(pair) == 10)
            .map_or(bytes.len(), |index| (index + 1) * 2),
    }
}

fn detect_log_encoding(bytes: &[u8], previous: LogEncoding) -> LogEncoding {
    let utf8_end = log_record_end(bytes, LogEncoding::Utf8);
    let utf8_record = &bytes[..utf8_end];
    match std::str::from_utf8(utf8_record) {
        Ok(text) if text.chars().all(log_character) => {
            if text != "\n" || bytes.len() == 1 {
                return LogEncoding::Utf8;
            }
            // A leading 0A can also be the low byte of the first Japanese unit.
            let end = log_record_end(bytes, LogEncoding::Utf16Le);
            if !bytes[..end].ends_with(&[10, 0])
                || std::str::from_utf8(&bytes[..end])
                    .is_ok_and(|text| text.chars().all(log_character))
            {
                return LogEncoding::Utf8;
            }
        }
        Err(error) if error.error_len().is_none() => return LogEncoding::Utf8,
        _ => {}
    }
    // Include the high byte of a possible UTF-16LE newline in the evidence.
    let sample = &bytes[..(utf8_end + usize::from(utf8_end < bytes.len())).min(bytes.len())];
    let mut le_zeroes = 0;
    let mut be_zeroes = 0;
    for pair in sample.chunks_exact(2) {
        le_zeroes += usize::from(pair[1] == 0 && pair[0] != 0);
        be_zeroes += usize::from(pair[0] == 0 && pair[1] != 0);
    }
    if le_zeroes != be_zeroes {
        // U+4E00 has a zero low byte too. A complete newline is stronger
        // evidence of byte order than zeros in Japanese character bytes.
        for pair in bytes.chunks_exact(2) {
            if pair == [10, 0] {
                return LogEncoding::Utf16Le;
            }
            if pair == [0, 10] {
                return LogEncoding::Utf16Be;
            }
        }
    }
    if le_zeroes > be_zeroes {
        return LogEncoding::Utf16Le;
    }
    if be_zeroes > le_zeroes {
        return LogEncoding::Utf16Be;
    }

    // Japanese UTF-16 often has no zero bytes. Decode whole code units before
    // looking for LF: U+4E0A, for example, contains 0A without being a newline.
    let candidates = if previous == LogEncoding::Utf16Be {
        [LogEncoding::Utf16Be, LogEncoding::Utf16Le]
    } else {
        [LogEncoding::Utf16Le, LogEncoding::Utf16Be]
    };
    for encoding in candidates {
        let end = log_record_end(bytes, encoding);
        let units = bytes[..end]
            .chunks_exact(2)
            .map(|pair| encoding.unit(pair))
            .collect::<Vec<_>>();
        if let Ok(text) = String::from_utf16(&units) {
            if text.chars().all(log_character)
                && text.chars().any(|character| {
                    matches!(character, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}')
                })
            {
                return encoding;
            }
        }
    }
    LogEncoding::Utf8
}

fn log_character(character: char) -> bool {
    !character.is_control() || matches!(character, '\t' | '\r' | '\n' | '\u{1b}')
}

fn clean_terminal_text(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            if characters.peek() == Some(&'[') {
                characters.next();
                for suffix in characters.by_ref() {
                    if ('@'..='~').contains(&suffix) {
                        break;
                    }
                }
            }
            continue;
        }
        match character {
            '\0' => {}
            '\r' => {
                if characters.peek() != Some(&'\n') {
                    result.push('\n');
                }
            }
            '\u{8}' => {}
            character if character.is_control() && character != '\n' && character != '\t' => {}
            character => result.push(character),
        }
    }
    result
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    value.chars().skip(count - max_chars).collect()
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut shortened = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    shortened.push('…');
    shortened
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_bytes(text: &str, encoding: LogEncoding, bom: bool) -> Vec<u8> {
        let mut bytes = match (encoding, bom) {
            (LogEncoding::Utf8, true) => vec![0xef, 0xbb, 0xbf],
            (LogEncoding::Utf16Le, true) => vec![0xff, 0xfe],
            (LogEncoding::Utf16Be, true) => vec![0xfe, 0xff],
            _ => Vec::new(),
        };
        match encoding {
            LogEncoding::Utf8 => bytes.extend_from_slice(text.as_bytes()),
            encoding => {
                for unit in text.encode_utf16() {
                    bytes.extend_from_slice(&match encoding {
                        LogEncoding::Utf16Be => unit.to_be_bytes(),
                        _ => unit.to_le_bytes(),
                    });
                }
            }
        }
        bytes
    }

    #[test]
    fn decodes_mixed_log_records_with_and_without_boms() {
        for bom in [false, true] {
            for first in [LogEncoding::Utf8, LogEncoding::Utf16Le] {
                let second = if first == LogEncoding::Utf8 {
                    LogEncoding::Utf16Le
                } else {
                    LogEncoding::Utf8
                };
                let records = [
                    ("起動しました\r\n", first),
                    ("接続を確認しました\n", second),
                    ("\r\n", first),
                    ("\n", second),
                    ("server ready\n", first),
                    ("終了しました", second),
                ];
                let bytes = records
                    .iter()
                    .flat_map(|(text, encoding)| log_bytes(text, *encoding, bom))
                    .collect::<Vec<_>>();
                let expected = records.iter().map(|(text, _)| *text).collect::<String>();
                assert_eq!(decode_text_file(&bytes), expected, "BOM={bom}");
            }
        }
    }

    #[test]
    fn decodes_japanese_heavy_utf16_records_without_zero_ratio() {
        let text = format!("{}\r\n", "日本語の接続確認を開始しました".repeat(400));
        let mut bytes = log_bytes(&text, LogEncoding::Utf16Le, false);
        assert!(bytes.iter().filter(|byte| **byte == 0).count() * 3 < bytes.len());
        bytes.extend_from_slice("UTF-8 の追記\n".as_bytes());
        assert_eq!(decode_text_file(&bytes), format!("{text}UTF-8 の追記\n"));
    }

    #[test]
    fn does_not_split_japanese_code_units_containing_newline_bytes() {
        for bom in [false, true] {
            for text in [
                "上\n",
                "上上下上\r\n",
                "日本上語\n",
                "一上\n",
                "上\u{100a}\n",
            ] {
                let mut bytes = log_bytes(text, LogEncoding::Utf16Le, bom);
                bytes.extend_from_slice(b"next\n");
                assert_eq!(decode_text_file(&bytes), format!("{text}next\n"));
            }
        }
    }

    #[test]
    fn preserves_big_endian_records_among_other_encodings() {
        let records = [
            ("日本語\r\n", LogEncoding::Utf16Be, true),
            ("日本上語\n", LogEncoding::Utf16Be, false),
            ("\n", LogEncoding::Utf16Be, false),
            ("UTF-8\n", LogEncoding::Utf8, true),
            ("日本語\n", LogEncoding::Utf16Le, false),
            ("done", LogEncoding::Utf16Be, true),
        ];
        let bytes = records
            .iter()
            .flat_map(|(text, encoding, bom)| log_bytes(text, *encoding, *bom))
            .collect::<Vec<_>>();
        assert_eq!(
            decode_text_file(&bytes),
            records.iter().map(|(text, _, _)| *text).collect::<String>()
        );
    }

    #[test]
    fn preserves_utf8_blank_lines_japanese_and_literal_bom_characters() {
        let text = "\n\n日本語\r\n上\n😀\ntext\u{feff}inside";
        assert_eq!(decode_text_file(text.as_bytes()), text);
        assert_eq!(
            decode_text_file(&log_bytes(text, LogEncoding::Utf8, true)),
            text
        );
        assert_eq!(decode_text_file(&[]), "");
        for bom in [&[0xff, 0xfe][..], &[0xfe, 0xff], &[0xef, 0xbb, 0xbf]] {
            assert_eq!(decode_text_file(bom), "");
        }
    }

    #[test]
    fn replaces_incomplete_code_units_and_surrogates_at_the_tail() {
        for encoding in [LogEncoding::Utf16Le, LogEncoding::Utf16Be] {
            let mut bytes = log_bytes("日本語", encoding, true);
            bytes.push(0x42);
            assert_eq!(decode_text_file(&bytes), "日本語\u{fffd}");
            let mut bytes = log_bytes("hello ", encoding, true);
            bytes.extend_from_slice(&match encoding {
                LogEncoding::Utf16Be => 0xd83du16.to_be_bytes(),
                _ => 0xd83du16.to_le_bytes(),
            });
            assert_eq!(decode_text_file(&bytes), "hello \u{fffd}");
        }
        let mut bytes = log_bytes("日本語", LogEncoding::Utf16Le, false);
        bytes.push(0x42);
        assert_eq!(decode_text_file(&bytes), "日本語\u{fffd}");
        assert_eq!(decode_text_file(b"hello \xe3\x81"), "hello \u{fffd}");
        assert_eq!(decode_text_file(&[0xff]), "\u{fffd}");
    }

    #[test]
    fn decodes_utf16_le_logs_with_nuls() {
        let text = "hello 世界";
        let bytes = text
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        assert_eq!(decode_text_file(&bytes), text);
        assert_eq!(clean_terminal_text(&decode_text_file(&bytes)), text);
    }

    #[test]
    fn strips_ansi_and_controls() {
        let input = "\u{1b}[34mblue\u{1b}[39m\r\nnext\0";
        assert_eq!(clean_terminal_text(input), "blue\nnext");
    }

    #[test]
    fn parses_who_schema_from_cli() {
        let value: AgentDirectory = serde_json::from_str(
            r#"{
              "team":"team","person":"me","machine":"pc",
              "machines":[{"person":"me","machine":"pc","online":true}],
              "sessions":[{
                "address":"me/codex","name":"codex","person":"me","machine":"pc",
                "agent":"cli","repo":"repo","branch":"main","status":"busy",
                "since":1790000000000,"doing":"building","worker":true,"tier":"turn"
              }]
            }"#,
        )
        .expect("valid who payload");
        assert_eq!(value.sessions[0].address, "me/codex");
        assert!(value.sessions[0].worker);
    }

    #[test]
    fn extracts_only_visible_conversation_text() {
        let line = serde_json::json!({
          "type":"response_item",
          "payload":{
            "type":"message",
            "role":"assistant",
            "content":[{"type":"output_text","text":"done"}]
          }
        });
        assert_eq!(
            conversation_message(&line).map(|message| message.text),
            Some("done".to_string())
        );
        let reasoning = serde_json::json!({
          "type":"response_item",
          "payload":{"type":"reasoning","summary":[]}
        });
        assert!(conversation_message(&reasoning).is_none());
    }

    #[test]
    fn removes_harness_context_before_user_request() {
        let line = serde_json::json!({
          "type":"response_item",
          "payload":{
            "type":"message",
            "role":"user",
            "content":[{"type":"input_text","text":"# AGENTS.md instructions\n<INSTRUCTIONS>\nrule\n</INSTRUCTIONS>\n<environment_context>local</environment_context>\n# Build the app"}]
          }
        });
        let message = conversation_message(&line).expect("visible message");
        assert_eq!(message.text, "# Build the app");
        assert_eq!(
            title_from_user_text(&message.text).as_deref(),
            Some("# Build the app")
        );
    }
}
