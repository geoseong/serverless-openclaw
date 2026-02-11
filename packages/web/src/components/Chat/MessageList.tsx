import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../hooks/useWebSocket";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="message-list message-list--empty">
        <p>Send a message to start a conversation.</p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <div key={msg.id} className={`message message--${msg.role}`}>
          <div className="message__content">
            {msg.content}
            {msg.streaming && <span className="message__cursor">|</span>}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
