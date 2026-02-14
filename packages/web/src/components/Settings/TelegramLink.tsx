import { useState, useEffect, useCallback } from "react";
import { generateOtp, getLinkStatus, unlinkTelegram } from "../../services/link";
import type { LinkStatus } from "../../services/link";
import "./TelegramLink.css";

interface Props {
  token: string;
}

const OTP_DURATION_SEC = 300;

export function TelegramLink({ token }: Props) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [otpCode, setOtpCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getLinkStatus(token);
      setStatus(s);
    } catch {
      setError("연동 상태를 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Countdown timer
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  const handleGenerateOtp = async () => {
    setError(null);
    try {
      const { code } = await generateOtp(token);
      setOtpCode(code);
      setRemaining(OTP_DURATION_SEC);
    } catch {
      setError("OTP 생성에 실패했습니다.");
    }
  };

  const handleUnlink = async () => {
    setError(null);
    try {
      await unlinkTelegram(token);
      setStatus({ linked: false });
      setOtpCode(null);
    } catch {
      setError("연동 해제에 실패했습니다.");
    }
  };

  if (loading) {
    return <div className="telegram-link">불러오는 중...</div>;
  }

  return (
    <div className="telegram-link">
      <h3 className="telegram-link__title">Telegram 연동</h3>

      {error && <p className="telegram-link__error">{error}</p>}

      {status?.linked ? (
        <div className="telegram-link__linked">
          <p>Telegram ID <strong>{status.telegramUserId}</strong> 연동됨</p>
          <button className="telegram-link__btn telegram-link__btn--danger" onClick={handleUnlink}>
            연동 해제
          </button>
        </div>
      ) : (
        <div className="telegram-link__unlinked">
          {otpCode ? (
            <div className="telegram-link__otp">
              {remaining > 0 ? (
                <>
                  <p className="telegram-link__otp-code">{otpCode}</p>
                  <p className="telegram-link__otp-guide">
                    Telegram 봇에 <code>/link {otpCode}</code>를 전송하세요.
                  </p>
                  <p className="telegram-link__countdown">
                    {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                  </p>
                </>
              ) : (
                <p className="telegram-link__expired">코드가 만료되었습니다.</p>
              )}
              <button className="telegram-link__btn" onClick={handleGenerateOtp}>
                새 코드 생성
              </button>
            </div>
          ) : (
            <button className="telegram-link__btn" onClick={handleGenerateOtp}>
              Telegram 연동
            </button>
          )}
        </div>
      )}
    </div>
  );
}
