/**
 * IndexedDB cache for user-sent chat images.
 *
 * The gateway strips image data from chat.history responses, so images
 * disappear after app restart.  This module caches images at send time
 * and merges them back when loading history.
 */

import type { ChatImage, ChatMessage } from "../pages/chat/chat-utils.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

interface CachedImageRecord {
  sessionKey: string;
  timestamp: number;   // same Date.now() used in the optimistic ChatMessage
  images: ChatImage[];
  savedAt: number;     // for 30-day expiry
}

const DB_NAME = "easyclaw-image-cache";
const DB_VERSION = 1;
const STORE = "images";
const TIMESTAMP_TOLERANCE_MS = 5_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { autoIncrement: true });
        store.createIndex("sessionKey", "sessionKey", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Cache images when the user sends a message with attachments. */
export async function saveImages(
  sessionKey: string,
  timestamp: number,
  images: ChatImage[],
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).add({
    sessionKey,
    timestamp,
    images,
    savedAt: Date.now(),
  } satisfies CachedImageRecord);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Merge cached images into parsed history messages.
 *
 * For each user message that has no images, look for a cached record
 * with a matching sessionKey and timestamp (±5 s tolerance).
 * Returns a new array — does not mutate the input.
 */
export async function restoreImages(
  sessionKey: string,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const index = tx.objectStore(STORE).index("sessionKey");
  const req = index.getAll(sessionKey);

  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      db.close();
      const cached: CachedImageRecord[] = req.result;
      if (cached.length === 0) { resolve(messages); return; }

      // Mark used entries so the same cache record isn't matched twice
      const used = new Set<number>();

      const result = messages.map((msg) => {
        if (msg.role !== "user" || (msg.images && msg.images.length > 0)) return msg;

        for (let i = 0; i < cached.length; i++) {
          if (used.has(i)) continue;
          if (Math.abs(cached[i].timestamp - msg.timestamp) <= TIMESTAMP_TOLERANCE_MS) {
            used.add(i);
            return { ...msg, images: cached[i].images };
          }
        }
        return msg;
      });

      resolve(result);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Clear cached images.
 * - With `sessionKey`: delete all entries for that session (conversation reset).
 * - Without: delete entries older than 30 days (startup cleanup).
 */
export async function clearImages(sessionKey?: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);

  if (sessionKey) {
    const idx = store.index("sessionKey");
    const cursorReq = idx.openCursor(sessionKey);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  } else {
    const cutoff = Date.now() - MAX_AGE_MS;
    const idx = store.index("savedAt");
    const cursorReq = idx.openCursor(IDBKeyRange.upperBound(cutoff));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
