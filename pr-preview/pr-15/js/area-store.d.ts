export declare function loadArea<T = any>(key: string): Promise<T | null>;
export declare function saveArea(key: string, value: unknown): Promise<boolean>;
export declare function deleteArea(key: string): Promise<boolean>;
