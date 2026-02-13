import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from "amazon-cognito-identity-js";

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
});

export type SignInResult =
  | { type: "success"; session: CognitoUserSession }
  | { type: "mfaSetup"; user: CognitoUser; secretCode: string }
  | { type: "mfaRequired"; user: CognitoUser };

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ type: "success", session }),
      onFailure: (err) => reject(err),
      totpRequired: () => resolve({ type: "mfaRequired", user }),
      mfaSetup: () => {
        user.associateSoftwareToken({
          associateSecretCode: (secretCode: string) => {
            resolve({ type: "mfaSetup", user, secretCode });
          },
          onFailure: (err: Error) => reject(err),
        });
      },
    });
  });
}

export function verifySoftwareToken(user: CognitoUser, totpCode: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.verifySoftwareToken(totpCode, "TOTP", {
      onSuccess: (session: CognitoUserSession) => resolve(session),
      onFailure: (err: Error) => reject(err),
    });
  });
}

export function sendMFACode(user: CognitoUser, totpCode: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.sendMFACode(
      totpCode,
      {
        onSuccess: (session) => resolve(session),
        onFailure: (err) => reject(err),
      },
      "SOFTWARE_TOKEN_MFA",
    );
  });
}

export function signUp(email: string, password: string): Promise<CognitoUser> {
  const attributes = [new CognitoUserAttribute({ Name: "email", Value: email })];

  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, attributes, [], (err, result) => {
      if (err || !result) {
        reject(err ?? new Error("Sign up failed"));
        return;
      }
      resolve(result.user);
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });

  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function getSession(): Promise<CognitoUserSession | null> {
  const user = userPool.getCurrentUser();
  if (!user) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(session);
    });
  });
}

export function getCurrentUser(): CognitoUser | null {
  return userPool.getCurrentUser();
}

export function signOut(): void {
  const user = userPool.getCurrentUser();
  if (user) {
    user.signOut();
  }
}
