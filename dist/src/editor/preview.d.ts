export declare const PREVIEW_SCRIPT = "cocos-performance-inspector/auto.js";
/** Creator 3.8 loads plugins/jsList after engine initialization and before project scripts. */
export declare function onSettingsBrowser(settings: {
    plugins?: {
        jsList?: string[];
    };
    jsList?: string[];
}): Promise<void>;
/** Creator's server contribution mounts these on the preview origin, including the plugins/ prefix. */
export declare const get: {
    url: string;
    handle(req: any, res: any): void;
}[];
