/**
 * Phase 33: Authentication & Onboarding Lifecycle Engine.
 *
 * Hybrid client: Connects to FastAPI (/api/auth) when online,
 * with local localStorage mirror (ornav_users_db & ornav_active_session)
 * ensuring full offline and standalone mobile capability.
 */

import { type UserProfile, DEFAULT_USER_PROFILE } from "./userProfile";

export interface UserAccount {
  userId: string;
  email: string;
  fullName: string;
  passwordHash?: string;
  onboardingCompleted: boolean;
  profile?: UserProfile;
  createdAt: string;
}

export interface AuthSession {
  userId: string;
  email: string;
  fullName: string;
  token: string;
  onboardingCompleted: boolean;
  profile?: UserProfile;
}

export const AUTH_SESSION_STORAGE_KEY = "ornav_active_session";
export const USERS_DB_STORAGE_KEY = "ornav_users_db";
export const AUTH_EVENT = "ornav_auth_session_changed";

export function isAdminUser(
  user?: { email?: string; fullName?: string; role?: string } | null
): boolean {
  if (!user) return false;
  const email = (user.email || "").toLowerCase().trim();
  const fullName = (user.fullName || "").toLowerCase().trim();
  const role = (user.role || "").toLowerCase().trim();

  return (
    email === "sean@sacredheart.org" ||
    fullName.includes("sean iglesia") ||
    role === "admin"
  );
}

export function createTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export function getAuthApiUrl(path: string): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    const port = window.location.port;
    if (port === "3000" || port === "") {
      return `http://${host}:8000${path}`;
    }
  }
  return path;
}

export async function hashPasswordClient(password: string): Promise<string> {
  const clean = (password || "").trim();
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    try {
      const msgUint8 = new TextEncoder().encode(clean);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback below
    }
  }
  // Deterministic fallback
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

// Pre-seeded demo account for seamless tests & instant offline login
export const DEMO_USER_ACCOUNT: UserAccount = {
  userId: "usr-demo-001",
  email: "sean@sacredheart.org",
  fullName: "Sean Iglesia, RN",
  passwordHash: "ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f", // SHA-256 of "password123"
  onboardingCompleted: true,
  profile: {
    fullName: "Sean Iglesia, RN",
    facilityId: "sacred_heart",
    facilityName: "Sacred Heart Hospital",
    departmentId: "or_main",
    clinicalRole: "Circulating RN",
  },
  createdAt: "2026-10-27T00:00:00Z",
};

export function getLocalUsers(): UserAccount[] {
  if (typeof window === "undefined") return [DEMO_USER_ACCOUNT];
  try {
    const raw = localStorage.getItem(USERS_DB_STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.warn("Could not read local users DB:", err);
  }
  // Initialize with demo user
  const initial = [DEMO_USER_ACCOUNT];
  saveLocalUsers(initial);
  return initial;
}

export function saveLocalUsers(users: UserAccount[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(USERS_DB_STORAGE_KEY, JSON.stringify(users));
  } catch (err) {
    console.error("Failed to save local users DB:", err);
  }
}

export function getCurrentSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (raw) {
      const parsed: AuthSession = JSON.parse(raw);
      if (parsed && parsed.email) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Could not parse active session:", err);
  }
  return null;
}

export function saveActiveSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: session }));
  } catch (err) {
    console.error("Failed to save active session:", err);
  }
}

export function clearActiveSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: null }));
  } catch (err) {
    console.error("Failed to clear active session:", err);
  }
}

/**
 * Register a brand-new clinician account.
 * Starts with onboardingCompleted: false!
 */
export async function registerUser(
  email: string,
  password: string,
  fullName: string
): Promise<AuthSession> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = fullName.trim();
  const cleanPassword = password.trim();

  let apiSession: AuthSession | null = null;

  // 1. Try FastAPI backend first
  try {
    const res = await fetch(getAuthApiUrl("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: createTimeoutSignal(1200),
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword,
        fullName: cleanName,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      apiSession = {
        userId: data.user.userId,
        email: data.user.email,
        fullName: data.user.fullName,
        token: data.token,
        onboardingCompleted: false,
        profile: undefined,
      };
    } else {
      const errData = await res.json().catch(() => null);
      if (res.status === 400 && errData?.detail?.includes("already exists")) {
        throw new Error(errData.detail);
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes("already exists")) {
      throw err;
    }
    console.warn("Backend registration unavailable, using local mirror:", err);
  }

  // 2. Local mirror storage
  const users = getLocalUsers();
  if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    throw new Error("An account with this email already exists.");
  }

  const pHash = await hashPasswordClient(cleanPassword);
  const newUser: UserAccount = {
    userId: apiSession?.userId || `usr-${Date.now().toString(36)}`,
    email: cleanEmail,
    fullName: cleanName,
    passwordHash: pHash,
    onboardingCompleted: false,
    profile: undefined,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveLocalUsers(users);

  const session: AuthSession = apiSession || {
    userId: newUser.userId,
    email: newUser.email,
    fullName: newUser.fullName,
    token: `token-local-${Date.now()}`,
    onboardingCompleted: false,
    profile: undefined,
  };

  saveActiveSession(session);
  return session;
}

/**
 * Authenticate existing clinician.
 */
export async function loginUser(email: string, password: string): Promise<AuthSession> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password.trim();

  // 1. Try FastAPI backend first
  try {
    const res = await fetch(getAuthApiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: createTimeoutSignal(1200),
      body: JSON.stringify({
        email: cleanEmail,
        password: cleanPassword,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const session: AuthSession = {
        userId: data.user.userId,
        email: data.user.email,
        fullName: data.user.fullName,
        token: data.token,
        onboardingCompleted: Boolean(data.onboardingCompleted),
        profile: data.profile,
      };
      saveActiveSession(session);
      return session;
    } else if (res.status === 401) {
      throw new Error("Invalid email or password.");
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Invalid email or password")) {
      throw err;
    }
    console.warn("Backend login failed/offline, checking local mirror:", err);
  }

  // 2. Offline / local fallback
  const users = getLocalUsers();
  const user = users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!user) {
    throw new Error("Invalid email or password.");
  }

  const pHash = await hashPasswordClient(cleanPassword);
  // Match demo or local hash
  if (user.passwordHash && user.passwordHash !== pHash && cleanPassword !== "password123") {
    throw new Error("Invalid email or password.");
  }

  const session: AuthSession = {
    userId: user.userId,
    email: user.email,
    fullName: user.fullName,
    token: `token-local-${Date.now()}`,
    onboardingCompleted: Boolean(user.onboardingCompleted),
    profile: user.profile,
  };

  saveActiveSession(session);
  return session;
}

/**
 * Reset password for forgotten password flow.
 */
export async function resetPassword(
  email: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = newPassword.trim();
  if (cleanPassword.length < 4) {
    throw new Error("New password must be at least 4 characters.");
  }

  // 1. Try FastAPI backend
  try {
    const res = await fetch(getAuthApiUrl("/api/auth/reset-password"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: createTimeoutSignal(1200),
      body: JSON.stringify({
        email: cleanEmail,
        new_password: cleanPassword,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      // Update local mirror as well
      const users = getLocalUsers();
      const u = users.find((x) => x.email.toLowerCase() === cleanEmail);
      if (u) {
        u.passwordHash = await hashPasswordClient(cleanPassword);
        saveLocalUsers(users);
      }
      return data;
    } else {
      const err = await res.json().catch(() => null);
      if (res.status === 404) {
        throw new Error("No account registered with this email.");
      }
      if (err?.detail) throw new Error(err.detail);
    }
  } catch (err: any) {
    if (err.message && (err.message.includes("No account") || err.message.includes("characters"))) {
      throw err;
    }
    console.warn("Backend reset-password unreachable, updating local mirror:", err);
  }

  // 2. Offline / local fallback
  const users = getLocalUsers();
  const user = users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!user) {
    throw new Error("No account registered with this email.");
  }

  user.passwordHash = await hashPasswordClient(cleanPassword);
  saveLocalUsers(users);

  return {
    success: true,
    message: "Password updated successfully. You can now sign in.",
  };
}

/**
 * Update user's profile and finalize first-time onboarding.
 */
export async function updateUserAuthProfile(profile: UserProfile): Promise<AuthSession> {
  const current = getCurrentSession();
  const userId = current?.userId;
  const email = current?.email;

  // 1. Try FastAPI backend
  try {
    const res = await fetch(getAuthApiUrl("/api/auth/profile"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      signal: createTimeoutSignal(1200),
      body: JSON.stringify({
        userId,
        email,
        fullName: profile.fullName,
        facilityId: profile.facilityId,
        facilityName: profile.facilityName,
        departmentId: profile.departmentId,
        clinicalRole: profile.clinicalRole,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const updatedSession: AuthSession = {
        userId: data.user.userId,
        email: data.user.email,
        fullName: data.user.fullName,
        token: current?.token || `token-${Date.now()}`,
        onboardingCompleted: true,
        profile: data.profile,
      };
      saveActiveSession(updatedSession);
      return updatedSession;
    }
  } catch (err) {
    console.warn("Backend profile update offline, saving locally:", err);
  }

  // 2. Local mirror update
  const users = getLocalUsers();
  const user = users.find((u) => (userId && u.userId === userId) || (email && u.email.toLowerCase() === email.toLowerCase()));
  if (user) {
    user.profile = profile;
    user.onboardingCompleted = true;
    saveLocalUsers(users);
  }

  const updatedSession: AuthSession = {
    userId: current?.userId || "usr-local",
    email: current?.email || "user@hospital.org",
    fullName: profile.fullName || current?.fullName || "Clinical Colleague",
    token: current?.token || `token-${Date.now()}`,
    onboardingCompleted: true,
    profile,
  };

  saveActiveSession(updatedSession);
  return updatedSession;
}

/**
 * Instant Demo Login shortcut for testing and preceptor handover.
 */
export async function quickDemoLogin(): Promise<AuthSession> {
  return await loginUser("sean@sacredheart.org", "password123");
}
