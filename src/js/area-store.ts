// Browser storage for areas: the setup page's autosaved draft and the area handed to the route builder.
// IndexedDB (through idb-keyval), because an OSM snapshot is too big for localStorage. Every call fails soft
// (private windows, blocked storage): callers get null or false and carry on without it.
import { createStore, get, set, del } from 'idb-keyval';

// the database and store the hand-written version used, so saved areas carry over (opened on first use)
const areas = createStore('trail-areas', 'areas');

// T is what was saved under the key (the store doesn't check it).
export async function loadArea<T = any>(key: string): Promise<T | null> { try { return (await get<T>(key, areas)) ?? null; } catch { return null; } }
export async function saveArea(key: string, value: unknown): Promise<boolean> { try { await set(key, value, areas); return true; } catch { return false; } }
export async function deleteArea(key: string): Promise<boolean> { try { await del(key, areas); return true; } catch { return false; } }
