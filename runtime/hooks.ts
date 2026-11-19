/** Hooks never replace user callbacks or own engine objects. Dispose only restores our wrapper. */
export class HookScope {
    private disposers: Array<() => void> = [];

    wrap(owner: any, key: string, factory: (original: (...args: any[]) => any) => (...args: any[]) => any): boolean {
        if (!owner || typeof owner[key] !== 'function') return false;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        const original = owner[key];
        const wrapped = factory(original);
        try {
            Object.defineProperty(owner, key, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: wrapped });
            this.disposers.push(() => {
                if (owner[key] !== wrapped) return; // A subsequently installed tool owns this slot now.
                if (descriptor) Object.defineProperty(owner, key, descriptor);
                else delete owner[key];
            });
            return true;
        } catch { return false; }
    }

    dispose(): void {
        for (const dispose of this.disposers.reverse()) dispose();
        this.disposers = [];
    }
}

export type WeakHandle = { deref(): any };
export function weak(value: any): WeakHandle | undefined {
    const Ref = (globalThis as any).WeakRef;
    return typeof Ref === 'function' && value && (typeof value === 'object' || typeof value === 'function') ? new Ref(value) : undefined;
}
export function clock(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
export function short(value: any, limit = 500): string {
    try {
        const result = typeof value === 'string' ? value : JSON.stringify(value);
        return String(result ?? value).slice(0, limit);
    } catch { return String(value).slice(0, limit); }
}
