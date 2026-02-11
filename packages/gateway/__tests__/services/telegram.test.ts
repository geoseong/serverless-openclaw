import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendTelegramMessage } from "../../src/services/telegram.js";

describe("telegram service", () => {
  const botToken = "123456:ABC-DEF";
  const chatId = "99887766";
  const text = "Hello from bot";

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it("should call Telegram Bot API sendMessage with correct params", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await sendTelegramMessage(mockFetch, botToken, chatId, text);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${botToken}/sendMessage`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe(chatId);
    expect(body.text).toBe(text);
  });

  it("should not throw on API failure (fire-and-forget)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });

    await expect(sendTelegramMessage(mockFetch, botToken, chatId, text)).resolves.toBeUndefined();
  });

  it("should not throw on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    await expect(sendTelegramMessage(mockFetch, botToken, chatId, text)).resolves.toBeUndefined();
  });

  it("should extract chatId from telegram:prefixed connectionId", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await sendTelegramMessage(mockFetch, botToken, "telegram:12345", "test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe("12345");
  });
});
