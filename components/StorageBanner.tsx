"use client";

import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import {
  CANONICAL_HOST,
  readStorageHealth,
  type StorageHealth,
} from "@/lib/storageHealth";
import { cn } from "@/lib/utils";

/**
 * Warns (in Thai, since this bit users already) when the app is opened from a
 * throwaway Vercel deployment URL or when the browser will not keep site data.
 * Both make it look like "the app forgot me after I closed the browser" while
 * the data is fine — it just lives under a different origin.
 */
export function StorageBanner() {
  const [health, setHealth] = useState<StorageHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readStorageHealth().then((value) => {
      if (!cancelled) setHealth(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health || health.isCanonical) return null;

  return (
    <div
      className={cn(
        "mx-auto mb-4 flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-left",
        "border-amber-300 bg-amber-50/90 shadow-soft backdrop-blur-md",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="text-[12px] leading-5 text-amber-900">
        <p className="font-semibold">
          คุณกำลังเปิดแอปจาก URL สำรอง ({health.host})
        </p>
        <p className="mt-1">
          เบราว์เซอร์เก็บข้อมูล (บัญชี, แชท, Spaces) แยกตาม URL — ข้อมูลเดิมของคุณอยู่ที่{" "}
          <a
            href={`https://${CANONICAL_HOST}`}
            className="inline-flex items-center gap-0.5 font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-700"
          >
            {CANONICAL_HOST}
            <ExternalLink className="h-3 w-3" />
          </a>{" "}
          ซึ่งเป็น URL หลักที่ใช้ได้ตลอด กรุณาบุ๊กมาร์กและเปิดจาก URL หลักเสมอ
          ไม่เช่นนั้นแต่ละครั้งที่ deploy ใหม่จะเหมือนข้อมูลหายทั้งหมด
        </p>
      </div>
    </div>
  );
}

/**
 * Compact chip for the workspace shell / login card: shows whether the
 * browser will actually keep the data. Amber when durable-storage is not
 * granted.
 */
export function StorageStatusChip() {
  const [health, setHealth] = useState<StorageHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readStorageHealth().then((value) => {
      if (!cancelled) setHealth(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health) return null;

  const ok = health.persistent !== false;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
      )}
      title={
        ok
          ? `origin: ${health.host}
IndexedDB: ${health.indexedDbAvailable ? "available" : "unavailable"}
session pointer: ${health.sessionActive ? "active in this tab" : "not signed in"}
durable storage: ${health.persistent === true ? "granted" : "not yet requested"}
usage: ${health.usageBytes ?? "?"} / ${health.quotaBytes ?? "?"} bytes`.trim()
          : `This browser can clear site data when it closes:
origin: ${health.host}
durable storage: not granted
session pointer: ${health.sessionActive ? "active in this tab" : "not signed in"}
After a browser restart the session may be gone — sign out/sign in again, and avoid private windows or cleaners.`.trim()
      }
    >
      {ok ? (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
      )}
      {ok ? "การจัดเก็บเสถียร" : "การจัดเก็บมีความเสี่ยง"}
    </span>
  );
}

export default StorageBanner;
