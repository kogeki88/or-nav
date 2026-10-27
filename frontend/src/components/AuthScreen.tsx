"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  Lock,
  Mail,
  User,
  KeyRound,
  ArrowRight,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  loginUser,
  registerUser,
  resetPassword,
  quickDemoLogin,
  type AuthSession,
} from "@/lib/auth";

interface AuthScreenProps {
  onAuthSuccess: (session: AuthSession) => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const clearMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      const session = await loginUser(email, password);
      onAuthSuccess(session);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }
    if (password.length < 4) {
      setErrorMessage("Password must be at least 4 characters.");
      return;
    }

    setLoading(true);
    try {
      const session = await registerUser(email, password, fullName);
      onAuthSuccess(session);
    } catch (err: any) {
      setErrorMessage(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    if (password !== confirmPassword) {
      setErrorMessage("New passwords do not match.");
      return;
    }
    if (password.length < 4) {
      setErrorMessage("New password must be at least 4 characters.");
      return;
    }

    setLoading(true);
    try {
      const result = await resetPassword(email, password);
      setSuccessMessage(result.message || "Password updated successfully. You can now sign in.");
      setPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setMode("login");
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || "Could not reset password. Ensure the email is registered.");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    clearMessages();
    setLoading(true);
    try {
      const session = await quickDemoLogin();
      onAuthSuccess(session);
    } catch (err: any) {
      setErrorMessage(err.message || "Demo login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#09090b] text-zinc-100 overflow-y-auto">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-sm sm:max-w-md bg-[#121215] border border-zinc-800/90 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Top Header Branding */}
        <div className="p-6 pb-4 border-b border-zinc-800/80 bg-zinc-950/60 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-3 shadow-inner">
            <ShieldCheck className="w-6 h-6 stroke-[2]" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100 flex items-center justify-center gap-1.5">
            <span>OR-Nav</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              v0.4
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Clinical Operating Room & Resuscitation Guidance
          </p>
        </div>

        {/* Status Alerts */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in duration-150">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs flex items-start gap-2 animate-in fade-in duration-150">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-snug">{successMessage}</span>
          </div>
        )}

        {/* FORM MODES */}
        <div className="p-6 pt-5">
          {/* MODE 1: SIGN IN */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Hospital Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@hospital.org"
                    data-testid="input-login-email"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      clearMessages();
                      setMode("forgot");
                    }}
                    data-testid="link-forgot-password"
                    className="text-[11px] text-zinc-400 hover:text-emerald-400 transition-colors cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    data-testid="input-login-password"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/40 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                data-testid="btn-login-submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                <span>{loading ? "Authenticating..." : "Sign In"}</span>
                <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>

              {/* Demo Login Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  disabled={loading}
                  data-testid="btn-quick-demo-login"
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>⚡ Quick Demo Login: Sean Iglesia, RN</span>
                </button>
              </div>

              {/* Switch to Register */}
              <div className="pt-3 border-t border-zinc-800/60 text-center">
                <span className="text-xs text-zinc-400">Need an account? </span>
                <button
                  type="button"
                  onClick={() => {
                    clearMessages();
                    setMode("register");
                  }}
                  data-testid="link-register"
                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer ml-1"
                >
                  Create an Account
                </button>
              </div>
            </form>
          )}

          {/* MODE 2: CREATE ACCOUNT */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Full Name & Credentials
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Sean Iglesia, RN"
                    data-testid="input-register-fullname"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Hospital Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@hospital.org"
                    data-testid="input-register-email"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 4 characters"
                    data-testid="input-register-password"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    data-testid="input-register-confirm"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                data-testid="btn-register-submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50 mt-1"
              >
                <span>{loading ? "Creating Account..." : "Create Account"}</span>
                <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>

              <div className="pt-3 border-t border-zinc-800/60 text-center">
                <button
                  type="button"
                  onClick={() => {
                    clearMessages();
                    setMode("login");
                  }}
                  data-testid="link-back-to-login"
                  className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Already have an account? <span className="text-emerald-400">Sign In</span>
                </button>
              </div>
            </form>
          )}

          {/* MODE 3: FORGOT PASSWORD */}
          {mode === "forgot" && (
            <form onSubmit={handleForgotPassword} className="space-y-3.5">
              <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl mb-3">
                <h3 className="text-xs font-semibold text-blue-300 mb-0.5">
                  Reset Clinician Password
                </h3>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Enter your hospital email and a new password to restore account access.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Registered Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@hospital.org"
                    data-testid="input-forgot-email"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 4 characters"
                    data-testid="input-forgot-password"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    data-testid="input-forgot-confirm"
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-blue-500/60 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                data-testid="btn-forgot-submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50 mt-1"
              >
                <span>{loading ? "Updating..." : "Reset Password"}</span>
              </button>

              <div className="pt-3 border-t border-zinc-800/60 text-center">
                <button
                  type="button"
                  onClick={() => {
                    clearMessages();
                    setMode("login");
                  }}
                  data-testid="link-back-to-login-from-forgot"
                  className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  Return to <span className="text-emerald-400">Sign In</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
