use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SourceState<T> {
    Ok { data: T },
    Error { error: String },
}

impl<T> SourceState<T> {
    pub fn from_result(result: Result<T, String>) -> Self {
        match result {
            Ok(data) => Self::Ok { data },
            Err(error) => Self::Error { error },
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineStatus {
    #[serde(default)]
    pub person: String,
    #[serde(default)]
    pub machine: String,
    pub online: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub person: String,
    #[serde(default)]
    pub machine: String,
    #[serde(default)]
    pub agent: String,
    pub repo: Option<String>,
    pub branch: Option<String>,
    #[serde(default = "unknown_status")]
    pub status: String,
    pub since: Option<i64>,
    pub doing: Option<String>,
    #[serde(default)]
    pub worker: bool,
    pub tier: Option<String>,
}

fn unknown_status() -> String {
    "unknown".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDirectory {
    pub team: Option<String>,
    #[serde(default)]
    pub person: String,
    #[serde(default)]
    pub machine: String,
    #[serde(default)]
    pub machines: Vec<MachineStatus>,
    #[serde(default)]
    pub sessions: Vec<AgentSession>,
    #[serde(default)]
    pub all: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub cwd: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at: u64,
    pub messages: Vec<ConversationMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub generated_at: u64,
    pub agents: SourceState<AgentDirectory>,
    pub inbox: SourceState<String>,
    pub serve_log: SourceState<String>,
    pub sessions: SourceState<Vec<SessionSummary>>,
}
