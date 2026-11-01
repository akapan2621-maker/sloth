/**
 * Account layer for the workspace.
 *
 * Two backends behind one API:
 *  - "local"    (default, zero setup): accounts live in the browser. Passwords
 *               are salted + hashed with WebCrypto PBKDF2-SHA256 and never
 *               stored in plain text. Each account owns an isolated namespace
 *               in IndexedDB, which is what preserves its sessions (chats,
 *               spaces, documents, settings) across sign-out / sign-in.
 *  - "supabase" (when NEXT_PUBLIC_SUPABASE_URL is set): real auth via
 *               supabase.auth, which also enables per-user cloud sync through
 *               RLS (see `supabase/auth-migration.sql`).
 *
 * The guest option keeps the legacy un-namespaced workspace so no existing
 * data is stranded.
 */

import { getSupabase, isSupabaseConfigured } from "./supabase";

export interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
  kind: "local" | "supabase" | "guest";
}

export const authMode: "local" | "supabase" = isSupabaseConfigured
  ? "supabase"
  : "local";

/**
 * Cloud sync only makes sense when the signed-in identity is the Supabase
 * session itself — otherwise every local account would mix into one shared
 * anonymous pool. `WorkspaceContext` flips this on/off per login.
 */
let remoteSyncUserId: string | null = null;

export function setRemoteSyncUser(userId: string | null): void {
  remoteSyncUserId = userId;
}

export function remoteSyncActive(): boolean {
  return remoteSyncUserId !== null;
}

/* -------------------------------------------------------------------------- */
/* Session pointers (who is logged in right now)                              */
/* -------------------------------------------------------------------------- */

interface SessionPointer {
  userId: string;
  remember: boolean;
  at: number;
}

const SESSION_KEY = "aqw:auth:session";
const ACCOUNTS_KEY = "aqw:auth:accounts";

function safeGet(storage: "local" | "session", key: string): string | null {
  try {
    const bag = storage === "local" ? localStorage : sessionStorage;
    return typeof bag === "undefined" ? null : bag.getItem(key);
  } catch {
    return null;
  }
}

function safeSetWithRemove(storage: "local" | "session", key: string, raw: string | null) {
  const other = storage === "local" ? "session" : "local";
  try {
    const bag = storage === "local" ? localStorage : sessionStorage;
    const drop = other === "local" ? localStorage : sessionStorage;
    if (raw === null) bag.removeItem(key);
    else bag.setItem(key, raw);
    if (typeof drop !== "undefined") drop.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function setSessionPointer(pointer: SessionPointer): void {
  const raw = JSON.stringify(pointer);
  safeSetWithRemove(pointer.remember ? "local" : "session", SESSION_KEY, raw);
}

async function clearSessionPointer(): Promise<void> {
  safeSetWithRemove("local", SESSION_KEY, null);
  safeSetWithRemove("session", SESSION_KEY, null);
  if (authMode === "supabase") {
    try {
      await getSupabase()?.auth.signOut();
    } catch {
      /* ignore */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Local accounts                                                             */
/* -------------------------------------------------------------------------- */

interface StoredAccount {
  id: string;
  email: string;
  name: string;
  salt: string;
  iterations: number;
  hash: string;
  createdAt: number;
}

function readAccounts(): StoredAccount[] {
  const raw = safeGet("local", ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: StoredAccount[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* ignore */
  }
}

/** Public face of existing accounts (for quick-pick on the login screen). */
export function listLocalAccounts(): { email: string; name: string }[] {
  return readAccounts()
    .map(({ email, name }) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const PBKDF2_ITERATIONS = 150_000;

/** Fresh 16-byte salt, backed by a dedicated ArrayBuffer for WebCrypto. */
function randomSalt(): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(16);
  crypto.getRandomValues(new Uint8Array(buffer));
  return new Uint8Array(buffer);
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function localSignUp(options: {
  name: string;
  email: string;
  password: string;
}): Promise<WorkspaceUser> {
  const name = options.name.trim();
  const email = options.email.trim().toLowerCase();
  const password = options.password;

  if (name.length < 1) throw new Error("Please enter a display name.");
  if (!isValidEmail(email)) throw new Error("Please enter a valid email address.");
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const accounts = readAccounts();
  if (accounts.some((account) => account.email === email)) {
    throw new Error("An account with this email already exists. Try signing in.");
  }

  const salt = randomSalt();
  const saltB64 = toBase64Url(salt);
  const hash = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);

  const account: StoredAccount = {
    id: `u_${randomHex(9)}`,
    email,
    name,
    salt: saltB64,
    iterations: PBKDF2_ITERATIONS,
    hash,
    createdAt: Date.now(),
  };

  writeAccounts([...accounts, account]);
  setSessionPointer({ userId: account.id, remember: true, at: Date.now() });

  return { id: account.id, email: account.email, name: account.name, kind: "local" };
}

export async function localSignIn(
  email: string,
  password: string,
  remember = true,
): Promise<WorkspaceUser> {
  const accounts = readAccounts();
  const account = accounts.find(
    (item) => item.email === email.trim().toLowerCase(),
  );
  if (!account) {
    throw new Error("Email or password is not correct.");
  }

  const hash = await derivePasswordHash(
    password,
    fromBase64Url(account.salt),
    account.iterations,
  );
  if (hash !== account.hash) {
    throw new Error("Email or password is not correct.");
  }

  setSessionPointer({ userId: account.id, remember, at: Date.now() });
  return { id: account.id, email: account.email, name: account.name, kind: "local" };
}

/* -------------------------------------------------------------------------- */
/* Supabase auth                                                              */
/* -------------------------------------------------------------------------- */

function mapSupabaseUser(raw: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): WorkspaceUser {
  const metaName =
    typeof raw.user_metadata?.name === "string" ? raw.user_metadata.name : "";
  const email = raw.email ?? "";
  const name = metaName || email.split("@")[0] || "Account";
  return { id: raw.id, email, name, kind: "supabase" };
}

function mapAuthError(message: string): string {
  const msg = (message ?? "").toLowerCase();
  if (msg.includes("invalid login credentials")) {
    return "Email or password is not correct.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email first — open the verification link we sent you.";
  }
  if (msg.includes("user already registered")) {
    return "This email is already registered — try signing in.";
  }
  if (msg.includes("rate limit")) {
    return "Too many attempts — wait a moment and try again.";
  }
  if (msg.includes("password")) {
    return `Password: ${message}`;
  }
  return message || "Sign in failed.";
}

export async function supabaseSignIn(
  email: string,
  password: string,
  remember = true,
): Promise<WorkspaceUser> {
  const client = getSupabase();
  if (!client) throw new Error("Sign in is not configured.");
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(mapAuthError(error.message));
  if (!data.user) throw new Error("Sign in failed.");

  setSessionPointer({
    userId: data.user.id,
    remember,
    at: Date.now(),
  });
  return mapSupabaseUser(data.user);
}

export async function supabaseSignUp(options: {
  name: string;
  email: string;
  password: string;
}): Promise<WorkspaceUser> {
  const name = options.name.trim();
  if (name.length < 1) throw new Error("Please enter a display name.");

  const client = getSupabase();
  if (!client) throw new Error("Sign in is not configured.");
  const { data, error } = await client.auth.signUp({
    email: options.email.trim().toLowerCase(),
    password: options.password,
    options: { data: { name } },
  });
  if (error) throw new Error(mapAuthError(error.message));
  if (data.session && data.user) return mapSupabaseUser(data.user);

  // No session means email confirmation is required for this project.
  throw new Error(
    "Account created — confirm your email via the link, then sign in.",
  );
}

/* -------------------------------------------------------------------------- */
/* Guest                                                                      */
/* -------------------------------------------------------------------------- */

const GUEST: WorkspaceUser = {
  id: "guest",
  email: "",
  name: "Guest",
  kind: "guest",
};

export function guestUser(): WorkspaceUser {
  return { ...GUEST };
}

/** Guest keeps the legacy (pre-login) workspace namespace. */
export async function continueAsGuest(): Promise<WorkspaceUser> {
  setSessionPointer({ userId: "guest", remember: true, at: Date.now() });
  return { ...GUEST };
}

/* -------------------------------------------------------------------------- */
/* Restore                                                                    */
/* -------------------------------------------------------------------------- */

export async function restoreSession(): Promise<WorkspaceUser | null> {
  let pointer: SessionPointer | null = null;
  for (const storage of ["local", "session"] as const) {
    const raw = safeGet(storage, SESSION_KEY);
    if (!raw) continue;
    try {
      pointer = JSON.parse(raw) as SessionPointer;
      break;
    } catch {
      /* skip */
    }
  }
  if (!pointer?.userId) return null;

  if (pointer.userId === "guest") return { ...GUEST };

  const local = readAccounts().find((account) => account.id === pointer.userId);
  if (local) {
    return { id: local.id, email: local.email, name: local.name, kind: "local" };
  }

  if (authMode === "supabase") {
    try {
      const client = getSupabase();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      if (data?.session?.user && data.session.user.id === pointer.userId) {
        return mapSupabaseUser(data.session.user);
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

export async function signOut(): Promise<void> {
  await clearSessionPointer();
}
