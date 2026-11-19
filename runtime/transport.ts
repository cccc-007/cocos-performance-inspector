/** XHR is available in both Cocos web preview and JSB; no Node dependency is bundled. */
export function requestJSON(url: string, token: string, data?: unknown): Promise<any> {
    return requestJSONBody(url, token, data === undefined ? undefined : JSON.stringify(data));
}

/** Reuse the exact serialized pending packet on retries; do not serialize it again. */
export function requestJSONBody(url: string, token: string, body?: string): Promise<any> {
    return new Promise((resolve, reject) => {
        if (typeof XMLHttpRequest === 'undefined') { reject(new Error('XMLHttpRequest unavailable; use getReport() to export offline.')); return; }
        const xhr = new XMLHttpRequest();
        xhr.open(body === undefined ? 'GET' : 'POST', url, true);
        xhr.timeout = 5000;
        xhr.setRequestHeader('X-Inspector-Token', token);
        if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(`Inspector transport HTTP ${xhr.status}`)); return; }
            try { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
            catch { reject(new Error('Inspector transport returned invalid JSON')); }
        };
        xhr.onerror = () => reject(new Error('Inspector transport unavailable. Check endpoint/token, CORS and preview protocol.'));
        xhr.ontimeout = () => reject(new Error('Inspector transport timed out'));
        xhr.send(body === undefined ? null : body);
    });
}
