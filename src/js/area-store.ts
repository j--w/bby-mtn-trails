// Browser storage for areas: the setup page's autosaved draft and the area handed to the route builder.
// IndexedDB, because an OSM snapshot is too big for localStorage. Every call fails soft (private windows,
// blocked storage): callers get null or false and carry on without it.
const DB = 'trail-areas', STORE = 'areas';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}
// T is what was saved under the key (the store doesn't check it).
export async function loadArea<T = any>(key: string): Promise<T | null> { try { return (await tx('readonly', s => s.get(key))) ?? null; } catch { return null; } }
export async function saveArea(key: string, value: unknown): Promise<boolean> { try { await tx('readwrite', s => s.put(value, key)); return true; } catch { return false; } }
export async function deleteArea(key: string): Promise<boolean> { try { await tx('readwrite', s => s.delete(key)); return true; } catch { return false; } }
