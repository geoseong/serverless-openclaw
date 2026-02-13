import { describe, it, expect, vi } from "vitest";
import {
  saveMessagePair,
  loadRecentHistory,
  formatHistoryContext,
} from "../src/conversation-store.js";
import type { ConversationItem } from "@serverless-openclaw/shared";

describe("conversation-store", () => {
  describe("saveMessagePair", () => {
    it("should save user and assistant messages to DynamoDB", async () => {
      const send = vi.fn().mockResolvedValue({});

      await saveMessagePair(send, "telegram:123", "Hello", "Hi there!", "telegram");

      expect(send).toHaveBeenCalledTimes(2);

      // User message
      const userItem = send.mock.calls[0][0].input.Item;
      expect(userItem.PK).toBe("USER#telegram:123");
      expect(userItem.SK).toMatch(/^CONV#default#MSG#\d+$/);
      expect(userItem.role).toBe("user");
      expect(userItem.content).toBe("Hello");
      expect(userItem.channel).toBe("telegram");
      expect(userItem.ttl).toBeGreaterThan(0);

      // Assistant message
      const assistantItem = send.mock.calls[1][0].input.Item;
      expect(assistantItem.role).toBe("assistant");
      expect(assistantItem.content).toBe("Hi there!");

      // Assistant timestamp should be after user timestamp
      const userTs = Number(userItem.SK.split("#").pop());
      const assistantTs = Number(assistantItem.SK.split("#").pop());
      expect(assistantTs).toBeGreaterThan(userTs);
    });
  });

  describe("loadRecentHistory", () => {
    it("should return messages in chronological order", async () => {
      const items: ConversationItem[] = [
        { PK: "USER#u1", SK: "CONV#default#MSG#200", role: "assistant", content: "Hi!", channel: "telegram" },
        { PK: "USER#u1", SK: "CONV#default#MSG#100", role: "user", content: "Hello", channel: "telegram" },
      ];
      const send = vi.fn().mockResolvedValue({ Items: items });

      const result = await loadRecentHistory(send, "u1");

      expect(result).toHaveLength(2);
      // Reversed to chronological order
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
    });

    it("should return empty array when no history", async () => {
      const send = vi.fn().mockResolvedValue({ Items: [] });

      const result = await loadRecentHistory(send, "u1");
      expect(result).toEqual([]);
    });
  });

  describe("formatHistoryContext", () => {
    it("should format messages as XML context", () => {
      const history: ConversationItem[] = [
        { PK: "USER#u1", SK: "CONV#default#MSG#1", role: "user", content: "Hello", channel: "telegram" },
        { PK: "USER#u1", SK: "CONV#default#MSG#2", role: "assistant", content: "Hi!", channel: "telegram" },
      ];

      const result = formatHistoryContext(history);

      expect(result).toContain("<conversation_history>");
      expect(result).toContain('<message role="user">Hello</message>');
      expect(result).toContain('<message role="assistant">Hi!</message>');
      expect(result).toContain("</conversation_history>");
    });

    it("should return empty string for empty history", () => {
      expect(formatHistoryContext([])).toBe("");
    });
  });
});
