import { useState, useEffect, useCallback } from "react";
import type { CognitoUserSession, CognitoUser } from "amazon-cognito-identity-js";
import * as authService from "../services/auth.js";

export interface MfaState {
  type: "mfaSetup" | "mfaRequired";
  user: CognitoUser;
  secretCode?: string;
}

export interface AuthState {
  session: CognitoUserSession | null;
  loading: boolean;
  error: string | null;
  mfa: MfaState | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  submitMfaCode: (code: string) => Promise<void>;
  signOut: () => void;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<CognitoUserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<MfaState | null>(null);

  useEffect(() => {
    authService
      .getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const result = await authService.signIn(email, password);
      if (result.type === "success") {
        setSession(result.session);
        setMfa(null);
      } else if (result.type === "mfaSetup") {
        setMfa({ type: "mfaSetup", user: result.user, secretCode: result.secretCode });
      } else {
        setMfa({ type: "mfaRequired", user: result.user });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const submitMfaCode = useCallback(
    async (code: string) => {
      if (!mfa) return;
      setError(null);
      setLoading(true);
      try {
        let s: CognitoUserSession;
        if (mfa.type === "mfaSetup") {
          s = await authService.verifySoftwareToken(mfa.user, code);
        } else {
          s = await authService.sendMFACode(mfa.user, code);
        }
        setSession(s);
        setMfa(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "MFA verification failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [mfa],
  );

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      await authService.signUp(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    setError(null);
    setLoading(true);
    try {
      await authService.confirmSignUp(email, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    authService.signOut();
    setSession(null);
    setMfa(null);
  }, []);

  return { session, loading, error, mfa, signIn, signUp, confirmSignUp, submitMfaCode, signOut };
}
