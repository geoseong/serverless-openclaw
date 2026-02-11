import { useState, useEffect, useCallback } from "react";
import type { CognitoUserSession } from "amazon-cognito-identity-js";
import * as authService from "../services/auth";

export interface AuthState {
  session: CognitoUserSession | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<CognitoUserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const s = await authService.signIn(email, password);
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

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
  }, []);

  return { session, loading, error, signIn, signUp, confirmSignUp, signOut };
}
