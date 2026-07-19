// hooks/types.ts
import type { SessionStorage } from "../session/storage.ts";

export interface HookContexts {
    sessionStart: {
        storage: SessionStorage;
        systemPromptExtras: string[];   // hook 可以往这里 push 内容,拼进 system prompt
    };
    userPromptSubmit: {
        input: string;                  // 用户原始输入,hook 可以改写
        storage: SessionStorage;
    };
    preToolUse: {
        toolName: string;
        args: Record<string, unknown>;  // hook 可以改参数
        storage: SessionStorage;
    };
    postToolUse: {
        toolName: string;
        args: Record<string, unknown>;
        result: string;                 // hook 可以改结果
        storage: SessionStorage;
    };
}

export type HookKind = keyof HookContexts;
// ============================================================
// 2) Hook 返回值:三种情况都要能表达
// ============================================================
export interface HookResult<C> {
    block?: boolean;    // 阻断后续 hook,主流程也知道被拦
    reason?: string;    // 阻断原因(打日志用)
    ctx?: C;            // 替换 ctx,后续 hook 和主流程都用新的
}
// hook 函数本体:同步或异步都行
export type Hook <C> = 
    | ((ctx: C) => void | HookResult<C>)
    | ((ctx: C) => Promise<void | HookResult<C>>);

// ============================================================
// 3) matcher:注册时带的,决定 hook 是否被激活
// ============================================================
export type Matcher = string | string[] | "*";
// ============================================================
// 4) HookRegistry.run() 的返回值
// ============================================================
export interface HookRunResult<C> {
    ctx: C;           // 最终 ctx(可能被 hook 改过)
    blocked: boolean; // 主流程要看这个决定是否继续
    reason?: string;  // 阻断原因
}


