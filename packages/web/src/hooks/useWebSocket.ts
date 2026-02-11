import { useState, useEffect, useRef, useCallback } from "react";
import type { ServerMessage, TaskStatus } from "@serverless-openclaw/shared";
import { WebSocketClient } from "../services/websocket";
import type { ConnectionStatus } from "../services/websocket";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export interface UseWebSocketResult {
  connected: ConnectionStatus;
  messages: ChatMessage[];
  agentStatus: TaskStatus;
  sendMessage: (text: string) => void;
  requestStatus: () => void;
}

let msgCounter = 0;

export function useWebSocket(wsUrl: string, token: string | null): UseWebSocketResult {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [connected, setConnected] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<TaskStatus>("Idle");

  useEffect(() => {
    if (!token) return;

    const client = new WebSocketClient();
    clientRef.current = client;

    const unsubStatus = client.onStatusChange(setConnected);
    const unsubMessage = client.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case "message":
          if (msg.content) {
            setMessages((prev) => {
              // Replace any streaming message with the final one
              const withoutStreaming = prev.filter((m) => !m.streaming);
              return [
                ...withoutStreaming,
                { id: `msg-${++msgCounter}`, role: "assistant", content: msg.content! },
              ];
            });
          }
          break;
        case "stream_chunk":
          if (msg.content) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.streaming) {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: last.content + msg.content },
                ];
              }
              return [
                ...prev,
                {
                  id: `msg-${++msgCounter}`,
                  role: "assistant",
                  content: msg.content!,
                  streaming: true,
                },
              ];
            });
          }
          break;
        case "stream_end":
          setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
          break;
        case "status":
          if (msg.status) {
            const normalized =
              msg.status.charAt(0).toUpperCase() + msg.status.slice(1).toLowerCase();
            setAgentStatus(normalized as TaskStatus);
          }
          break;
        case "error":
          if (msg.error) {
            setMessages((prev) => [
              ...prev,
              { id: `msg-${++msgCounter}`, role: "assistant", content: `Error: ${msg.error}` },
            ]);
          }
          break;
      }
    });

    client.connect(wsUrl, token);

    return () => {
      unsubStatus();
      unsubMessage();
      client.disconnect();
      clientRef.current = null;
    };
  }, [wsUrl, token]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!clientRef.current) return;
      setMessages((prev) => [
        ...prev,
        { id: `msg-${++msgCounter}`, role: "user", content: text },
      ]);
      clientRef.current.send({ action: "sendMessage", message: text });
    },
    [],
  );

  const requestStatus = useCallback(() => {
    clientRef.current?.send({ action: "getStatus" });
  }, []);

  return { connected, messages, agentStatus, sendMessage, requestStatus };
}
