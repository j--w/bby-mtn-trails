// Browser storage for areas: the setup page's autosaved draft and the area handed to the route builder.
// IndexedDB, because an OSM snapshot is too big for localStorage. Every call fails soft (private windows,
// blocked storage): callers get null or false and carry on without it.
const DB = 'trail-areas', STORE = 'areas';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}
export async function loadArea(key) { try { return (await tx('readonly', s => s.get(key))) ?? null; } catch { return null; } }
export async function saveArea(key, value) { try { await tx('readwrite', s => s.put(value, key)); return true; } catch { return false; } }
export async function deleteArea(key) { try { await tx('readwrite', s => s.delete(key)); return true; } catch { return false; } }
