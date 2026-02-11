import { useState } from "react";
import type { FormEvent } from "react";
import { useAuthContext } from "./AuthProvider";
import "./LoginForm.css";

type Mode = "signIn" | "signUp" | "confirm";

export function LoginForm() {
  const { signIn, signUp, confirmSignUp, error, loading } = useAuthContext();

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

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
