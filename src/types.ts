export type SourceState<T> =
  | {
      state: "ok";
      data: T;
    }
  | {
      state: "error";
      error: string;
    };

export interface MachineStatus {
  person: string;
  machine: string;
  online: boolean;
}

export interface AgentSession {
  address: string;
  name: string;
  person: string;
  machine: string;
  agent: string;
  repo: string | null;
  branch: string | null;
  status: string;
  since: number | null;
  doing: string | null;
  worker: boolean;
  tier: string | null;
}

export interface AgentDirectory {
  team: string | null;
  person: string;
  machine: string;
  machines: MachineStatus[];
  sessions: AgentSession[];
  all?: boolean;
}

export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  cwd: string;
  updatedAt: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
  messages: ConversationMessage[];
}

export interface Dashboard {
  generatedAt: number;
  agents: SourceState<AgentDirectory>;
  inbox: SourceState<string>;
  serveLog: SourceState<string>;
  sessions: SourceState<SessionSummary[]>;
}

export type Panel = "agents" | "sessions" | "serve" | "inbox";

export type Selection =
  | { kind: "agents" }
  | { kind: "agent"; key: string }
  | { kind: "sessions" }
  | { kind: "session"; key: string }
  | { kind: "serve" }
  | { kind: "inbox" };

export interface DesktopState {
  dashboard: Dashboard | null;
  selection: Selection | null;
  sessionDetail: SessionDetail | null;
  panel: Panel;
  filter: string;
  composerDraft: string;
  loading: boolean;
  sessionLoading: boolean;
  sending: boolean;
  notice: Notice | null;
  theme: "dark" | "light";
}

export interface Notice {
  tone: "info" | "success" | "error";
  message: string;
}
