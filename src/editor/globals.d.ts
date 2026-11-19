declare const Editor: {
    Project: { path: string };
    Panel: { open(name: string): Promise<unknown>; define(options: any): any };
    Message: { request(channel: string, message: string, ...args: any[]): Promise<any> };
    Dialog: {
        save(options: any): Promise<{ canceled: boolean; filePath?: string }>;
        select(options: any): Promise<{ canceled: boolean; filePaths?: string[] }>;
    };
};
