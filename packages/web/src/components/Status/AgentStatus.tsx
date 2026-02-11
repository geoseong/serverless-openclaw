import type { TaskStatus } from "@serverless-openclaw/shared";
import "./AgentStatus.css";

const STATUS_LABELS: Record<TaskStatus, string> = {
  Idle: "Idle",
  Starting: "Waking up agent...",
  Running: "Running",
  Stopping: "Stopping",
};

export function AgentStatus({ status }: { status: TaskStatus }) {
  return (
    <div className={`agent-status agent-status--${status.toLowerCase()}`}>
      <span className="agent-status__dot" />
      <span className="agent-status__label">{STATUS_LABELS[status]}</span>
    </div>
  );
}
