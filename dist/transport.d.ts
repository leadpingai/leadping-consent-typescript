/** Serial, bounded retry transport. A resolved request means durable server acknowledgment. */
export declare class CaptureTransport {
    private readonly baseUrl;
    private readonly token;
    private readonly abort;
    constructor(baseUrl: string, token: string);
    put(path: string, json: string): Promise<void>;
    dispose(): void;
    private delay;
}
