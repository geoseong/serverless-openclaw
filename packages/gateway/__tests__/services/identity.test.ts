import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveUserId,
  generateOtp,
  verifyOtpAndLink,
  getLinkStatus,
  unlinkTelegram,
} from "../../src/services/identity.js";

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  GetCommand: vi.fn((params) => ({ _type: "Get", ...params })),
  PutCommand: vi.fn((params) => ({ _type: "Put", ...params })),
  DeleteCommand: vi.fn((params) => ({ _type: "Delete", ...params })),
}));

describe("identity service", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
  });

  // ── resolveUserId ──

  describe("resolveUserId", () => {
    it("should return userId as-is for non-telegram users", async () => {
      const result = await resolveUserId(mockSend, "cognito-uuid-123");
      expect(result).toBe("cognito-uuid-123");
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should return linked cognitoId for linked telegram user", async () => {
      mockSend.mockResolvedValueOnce({
        Item: { value: { cognitoUserId: "cognito-abc" } },
      });

      const result = await resolveUserId(mockSend, "telegram:67890");

      expect(result).toBe("cognito-abc");
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: expect.stringContaining("Settings"),
          Key: {
            PK: "USER#telegram:67890",
            SK: "SETTING#linked-cognito",
          },
        }),
      );
    });

    it("should return original userId for unlinked telegram user", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await resolveUserId(mockSend, "telegram:67890");

      expect(result).toBe("telegram:67890");
    });
  });

  // ── generateOtp ──

  describe("generateOtp", () => {
    it("should generate a 6-digit OTP and store two records", async () => {
      mockSend.mockResolvedValue({});

      const code = await generateOtp(mockSend, "cognito-abc");

      expect(code).toMatch(/^\d{6}$/);
      expect(mockSend).toHaveBeenCalledTimes(2);

      // First call: OTP record for cognito user
      const firstCall = mockSend.mock.calls[0][0];
      expect(firstCall.TableName).toContain("Settings");
      expect(firstCall.Item.PK).toBe("USER#cognito-abc");
      expect(firstCall.Item.SK).toBe("SETTING#telegram-otp");
      expect(firstCall.Item.value.code).toBe(code);
      expect(firstCall.Item.ttl).toBeGreaterThan(0);

      // Second call: reverse lookup record
      const secondCall = mockSend.mock.calls[1][0];
      expect(secondCall.Item.PK).toBe(`USER#otp:${code}`);
      expect(secondCall.Item.SK).toBe("SETTING#otp-owner");
      expect(secondCall.Item.value.cognitoUserId).toBe("cognito-abc");
    });
  });

  // ── verifyOtpAndLink ──

  describe("verifyOtpAndLink", () => {
    it("should link successfully with valid OTP", async () => {
      // 1. Atomic OTP claim (DeleteCommand with ReturnValues) → found
      mockSend.mockResolvedValueOnce({
        Attributes: { value: { cognitoUserId: "cognito-abc" } },
      });
      // 2. TaskState check for telegram user → no running container
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // 3. Check existing link for telegram user → not linked
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // 4-5. Two PutCommand for bilateral links
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      // 6. DeleteCommand for user's OTP record (reverse lookup already deleted in step 1)
      mockSend.mockResolvedValueOnce({});

      const result = await verifyOtpAndLink(mockSend, "67890", "123456");

      expect(result).toEqual({ cognitoUserId: "cognito-abc" });
      expect(mockSend).toHaveBeenCalledTimes(6);
    });

    it("should return error for expired/invalid OTP (no Attributes)", async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });

      const result = await verifyOtpAndLink(mockSend, "67890", "000000");

      expect(result).toEqual({ error: "OTP가 만료되었거나 유효하지 않습니다." });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should return error for already-consumed OTP (ConditionalCheckFailedException)", async () => {
      const err = new Error("Condition not met");
      (err as unknown as { name: string }).name = "ConditionalCheckFailedException";
      mockSend.mockRejectedValueOnce(err);

      const result = await verifyOtpAndLink(mockSend, "67890", "123456");

      expect(result).toEqual({ error: "OTP가 만료되었거나 유효하지 않습니다." });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("should return error when telegram container is running", async () => {
      // OTP found
      mockSend.mockResolvedValueOnce({
        Attributes: { value: { cognitoUserId: "cognito-abc" } },
      });
      // TaskState → running container
      mockSend.mockResolvedValueOnce({
        Item: { status: "Running", PK: "USER#telegram:67890" },
      });

      const result = await verifyOtpAndLink(mockSend, "67890", "123456");

      expect(result).toEqual({
        error: "Telegram 컨테이너가 실행 중입니다. 약 15분 후 다시 시도해주세요.",
      });
    });

    it("should return error when telegram is already linked to another account", async () => {
      // OTP found
      mockSend.mockResolvedValueOnce({
        Attributes: { value: { cognitoUserId: "cognito-abc" } },
      });
      // TaskState → no container
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Already linked to different account
      mockSend.mockResolvedValueOnce({
        Item: { value: { cognitoUserId: "cognito-other" } },
      });

      const result = await verifyOtpAndLink(mockSend, "67890", "123456");

      expect(result).toEqual({
        error: "이 Telegram 계정은 이미 다른 계정에 연동되어 있습니다.",
      });
    });

    it("should allow re-linking to same cognito account", async () => {
      // OTP found
      mockSend.mockResolvedValueOnce({
        Attributes: { value: { cognitoUserId: "cognito-abc" } },
      });
      // TaskState → no container
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Already linked to SAME account
      mockSend.mockResolvedValueOnce({
        Item: { value: { cognitoUserId: "cognito-abc" } },
      });
      // Put bilateral links
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      // Delete user OTP record
      mockSend.mockResolvedValueOnce({});

      const result = await verifyOtpAndLink(mockSend, "67890", "123456");

      expect(result).toEqual({ cognitoUserId: "cognito-abc" });
    });

    it("should return error when Starting container exists", async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { value: { cognitoUserId: "cognito-abc" } },
      });
      mockSend.mockResolvedValueOnce({
        Item: { status: "Starting", PK: "USER#telegram:67890" },
      });

      const result = await verifyOtpAndLink(mockSend, "67890", "123456");

      expect(result).toEqual({
        error: "Telegram 컨테이너가 실행 중입니다. 약 15분 후 다시 시도해주세요.",
      });
    });
  });

  // ── getLinkStatus ──

  describe("getLinkStatus", () => {
    it("should return linked status with telegramUserId", async () => {
      mockSend.mockResolvedValueOnce({
        Item: { value: { telegramUserId: "67890" } },
      });

      const result = await getLinkStatus(mockSend, "cognito-abc");

      expect(result).toEqual({ linked: true, telegramUserId: "67890" });
    });

    it("should return unlinked status when no link exists", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getLinkStatus(mockSend, "cognito-abc");

      expect(result).toEqual({ linked: false });
    });
  });

  // ── unlinkTelegram ──

  describe("unlinkTelegram", () => {
    it("should delete both bilateral link records", async () => {
      // Get current link to find telegramUserId
      mockSend.mockResolvedValueOnce({
        Item: { value: { telegramUserId: "67890" } },
      });
      // Delete cognito → telegram link
      mockSend.mockResolvedValueOnce({});
      // Delete telegram → cognito link
      mockSend.mockResolvedValueOnce({});

      await unlinkTelegram(mockSend, "cognito-abc");

      expect(mockSend).toHaveBeenCalledTimes(3);

      // First delete: cognito side
      const del1 = mockSend.mock.calls[1][0];
      expect(del1.Key.PK).toBe("USER#cognito-abc");
      expect(del1.Key.SK).toBe("SETTING#linked-telegram");

      // Second delete: telegram side
      const del2 = mockSend.mock.calls[2][0];
      expect(del2.Key.PK).toBe("USER#telegram:67890");
      expect(del2.Key.SK).toBe("SETTING#linked-cognito");
    });

    it("should be a no-op when no link exists", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await unlinkTelegram(mockSend, "cognito-abc");

      // Only the initial Get call
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
