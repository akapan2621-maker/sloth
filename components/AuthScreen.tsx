"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Cloud,
  EyeOff,
  HardDrive,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

type Tab = "signin" | "register";

/**
 * The gate every session passes through. Local accounts live in this browser
 * (isolated per login); when Supabase is configured the same form talks to
 * supabase.auth instead and unlocks per-user cloud sync.
 */
export function AuthScreen() {
  const { mode, accounts, signIn, signUp, signInAsGuest } = useAuth();
  const [tab, setTab] = useState<Tab>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === "signin") {
        await signIn(email, password, remember);
      } else {
        await signUp(name, email, password);
      }
    } catch (signError) {
      setError(
        signError instanceof Error
          ? signError.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-alabaster px-4">
      {/* Ambient gradient backdrop, matching the app shell */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-purple-300/40 via-pink-300/30 to-indigo-300/40 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 right-[-120px] h-[420px] w-[420px] rounded-full bg-gradient-to-tr from-indigo-200/50 via-sky-200/40 to-transparent blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-lift backdrop-blur-md">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
              <Lock className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
                Sign in to Sloth
              </h1>
              <p className="text-[12.5px] text-slate-500">
                Your chats, Spaces and documents are kept per account.
              </p>
            </div>
          </div>

          {mode === "supabase" ? (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11.5px] font-medium text-emerald-700">
              <Cloud className="h-3.5 w-3.5" />
              Supabase auth — sign in from any device, data synced per user
            </div>
          ) : null}

          {/* Tabs */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                { id: "signin", label: "Sign in", icon: LogIn },
                { id: "register", label: "Create account", icon: UserPlus },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setError(null);
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition",
                  tab === item.id
                    ? "bg-white text-slate-900 shadow-soft"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={submit} className="mt-5 space-y-3">
            <AnimatePresence initial={false}>
              {tab === "register" ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <label className="block text-[12px] font-medium text-slate-600">
                    Display name
                  </label>
                  <div className="relative mt-1.5">
                    <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                      placeholder="e.g. Akapan"
                      className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-[13.5px] text-slate-800 outline-none transition focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div>
              <label className="block text-[12px] font-medium text-slate-600">
                Email
              </label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input
                  type="text"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-[13.5px] text-slate-800 outline-none transition focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-slate-600">
                Password
              </label>
              <div className="relative mt-1.5">
                <EyeOff className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={tab === "signin" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-[13.5px] text-slate-800 outline-none transition focus:border-purple-400 focus:ring-4 focus:ring-purple-100"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-600">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-purple-600"
              />
              Stay signed in on this device
            </label>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy || !email.trim() || !password.trim()}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-soft transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {tab === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          {/* Existing accounts (local mode convenience) */}
          {tab === "signin" && accounts.length > 0 ? (
            <div className="mt-4">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                Recovered on this device
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {accounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setError(null);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11.5px] text-slate-600 transition hover:border-purple-300 hover:text-purple-700"
                    title="Fill email"
                  >
                    {account.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Guest */}
          <div className="mt-6 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => void signInAsGuest()}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <HardDrive className="h-4 w-4 text-slate-400" />
              Continue as guest
              <span className="text-[11px] font-normal text-slate-400">
                (โหมดไม่มีบัญชี — เก็บในเบราว์เซอร์นี้)
              </span>
            </button>
            <p className="mt-2.5 text-center text-[11.5px] leading-5 text-slate-400">
              Each account keeps its own chats, Spaces and files. Guests share
              whatever this browser held before.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default AuthScreen;
