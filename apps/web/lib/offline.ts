"use client";

import { useEffect, useState } from "react";

// Offline state + deferrable-work queue (§7 Phase 3 #20). The service
// worker keeps READS working offline; this file covers WRITES that can
// wait: they park in localStorage (scoped per school+user so two pupils
// sharing a device never swap work) and flush FIFO on reconnect. Anything
// that cannot be deferred surfaces a loud error instead — actions never
// fail silently here.

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

export interface QueuedSubmission {
  homeworkId: string;
  content: string;
  fileName: string | null;
  fileType: string | null;
  fileData: string | null;
  queuedAt: string;
}

// localStorage is ~5MB: cap a single queued file well below that so one
// attachment cannot evict the session or other queued work.
export const MAX_QUEUED_FILE_BYTES = 2 * 1024 * 1024;

function queueKey(schoolId: string, userId: string): string {
  return `studyfy-hw-queue:v1:${schoolId}:${userId}`;
}

export function readQueue(schoolId: string, userId: string): QueuedSubmission[] {
  try {
    const raw = window.localStorage.getItem(queueKey(schoolId, userId));
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedSubmission[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(schoolId: string, userId: string, items: QueuedSubmission[]): void {
  window.localStorage.setItem(queueKey(schoolId, userId), JSON.stringify(items));
}

export function enqueueSubmission(schoolId: string, userId: string, item: QueuedSubmission): QueuedSubmission[] {
  const next = [...readQueue(schoolId, userId), item];
  writeQueue(schoolId, userId, next);
  return next;
}

export function dropQueued(schoolId: string, userId: string, homeworkId: string, queuedAt: string): QueuedSubmission[] {
  const next = readQueue(schoolId, userId).filter(
    (q) => !(q.homeworkId === homeworkId && q.queuedAt === queuedAt),
  );
  writeQueue(schoolId, userId, next);
  return next;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_QUEUED_FILE_BYTES) {
      reject(new Error("That file is too big to queue offline — submit it once you are back online."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, name: string, type: string): File | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    return null;
  }
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return new File([bytes], name, { type: type || "application/octet-stream" });
  } catch {
    return null;
  }
}
