import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { toDataURL } from "qrcode";
import { useAuthContext } from "./AuthProvider.js";
import "./LoginForm.css";

type Mode = "signIn" | "signUp" | "confirm";

export function LoginForm() {
  const { signIn, signUp, confirmSignUp, submitMfaCode, mfa, error, loading } = useAuthContext();

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    if (mfa?.type === "mfaSetup" && mfa.secretCode) {
      const otpauth = `otpauth://totp/ServerlessOpenClaw:${email}?secret=${mfa.secretCode}&issuer=ServerlessOpenClaw`;
      toDataURL(otpauth).then(setQrDataUrl).catch(() => setQrDataUrl(""));
    }
  }, [mfa, email]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (mode === "signIn") {
        await signIn(email, password);
      } else if (mode === "signUp") {
        await signUp(email, password);
        setMode("confirm");
      } else {
        await confirmSignUp(email, code);
        await signIn(email, password);
      }
    } catch {
      // error is set in useAuth
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await submitMfaCode(mfaCode);
    } catch {
      // error is set in useAuth
    }
  };

  if (mfa) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1 className="login-title">Serverless OpenClaw</h1>

          {mfa.type === "mfaSetup" && (
            <div className="mfa-setup">
              <p className="mfa-instruction">
                Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>
              {qrDataUrl && <img src={qrDataUrl} alt="TOTP QR Code" className="mfa-qr" />}
              {mfa.secretCode && (
                <p className="mfa-secret">
                  Or enter manually: <code>{mfa.secretCode}</code>
                </p>
              )}
            </div>
          )}

          {mfa.type === "mfaRequired" && (
            <p className="mfa-instruction">Enter the 6-digit code from your authenticator app.</p>
          )}

          <form onSubmit={handleMfaSubmit} className="login-form">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="6-digit code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              required
              disabled={loading}
              maxLength={6}
              autoComplete="one-time-code"
            />

            {error && <p className="login-error">{error}</p>}

            <button type="submit" disabled={loading || mfaCode.length !== 6}>
              {loading ? "..." : "Verify"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">Serverless OpenClaw</h1>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />

          {mode !== "confirm" && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={8}
            />
          )}

          {mode === "confirm" && (
            <input
              type="text"
              placeholder="Verification code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={loading}
            />
          )}

          {error && <p className="login-error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading
              ? "..."
              : mode === "signIn"
                ? "Sign In"
                : mode === "signUp"
                  ? "Sign Up"
                  : "Verify"}
          </button>
        </form>

        {mode === "signIn" && (
          <p className="login-switch">
            Don't have an account?{" "}
            <button type="button" onClick={() => setMode("signUp")}>
              Sign Up
            </button>
          </p>
        )}
        {mode === "signUp" && (
          <p className="login-switch">
            Already have an account?{" "}
            <button type="button" onClick={() => setMode("signIn")}>
              Sign In
            </button>
          </p>
        )}
        {mode === "confirm" && (
          <p className="login-switch">Check your email for the verification code.</p>
        )}
      </div>
    </div>
  );
}
