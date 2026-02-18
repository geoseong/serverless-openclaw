import { useState } from "react";
import { useAuthContext } from "../Auth/AuthProvider";
import { useWebSocket } from "../../hooks/useWebSocket";
import { AgentStatus } from "../Status/AgentStatus";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { TelegramLink } from "../Settings/TelegramLink";
import { getConfig } from "../../config";
import "./ChatContainer.css";

export function ChatContainer() {
  const config = getConfig();
  const { session, signOut } = useAuthContext();
  const token = session?.getIdToken().getJwtToken() ?? null;
  const { connected, messages, agentStatus, sendMessage } = useWebSocket(config.webSocketUrl, token);
  const [showSettings, setShowSettings] = useState(false);

  const inputDisabled = connected === "disconnected";

  return (
    <div className="chat-container">
      <header className="chat-header">
        <AgentStatus status={agentStatus} />
        <div className="chat-header__actions">
          {connected === "disconnected" && (
            <span className="chat-header__offline">Offline</span>
          )}
          <button
            className="chat-header__settings"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "Chat" : "Settings"}
          </button>
          <button className="chat-header__logout" onClick={signOut}>
            Logout
          </button>
        </div>
      </header>
      {showSettings ? (
        <main className="chat-main">
          {token && <TelegramLink token={token} />}
        </main>
      ) : (
        <>
          <main className="chat-main">
            <MessageList messages={messages} />
          </main>
          <MessageInput onSend={sendMessage} disabled={inputDisabled} />
        </>
      )}
    </div>
  );
}
