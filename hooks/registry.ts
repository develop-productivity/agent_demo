import type { SessionStorage } from "../session/storage.ts";

// 内部结构:一条注册记录
interface Entry<K extends HookKind> {
    matcher: Matcher;
    hook: Hook<HookContexts[K]>;
}


// ============================================================
// 1) 每种 hook 的 ctx 结构
// ============================================================
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
export type Hook<C> =
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
    ctx: C;             // 最终 ctx(可能被 hook 改过)
    blocked: boolean;   // 主流程要看这个决定是否继续
    reason?: string;    // 阻断原因
}

export class HookRegistry {
    // 每种 kind 一个数组
    private hooks: { [K in HookKind]: Entry<K>[] } = {
        sessionStart: [],
        userPromptSubmit: [],
        preToolUse: [],
        postToolUse: [],
    };

    // ============================================================
    // 注册
    // ============================================================
    register<K extends HookKind>(
        kind: K,
        matcher: Matcher,
        hook: Hook<HookContexts[K]>,
    ): void {
        // 需要 as 断言:TS 无法证明这个数组元素的 K 就是当前 K
        // 但我们通过泛型约束保证了运行时正确
        (this.hooks[kind] as Entry<K>[]).push({ matcher, hook });
    }

    // ============================================================
    // 触发
    // ============================================================
    async run<K extends HookKind>(
        kind: K,
        ctx: HookContexts[K],
        toolNameForMatch?: string,
    ): Promise<HookRunResult<HookContexts[K]>> {
        const entries = this.hooks[kind] as Entry<K>[];
        let currentCtx = ctx;

        for (const entry of entries) {
            // ---- 1. 判断 matcher 是否命中 ----
            if (!this.matches(entry.matcher, toolNameForMatch)) continue;

            // ---- 2. 执行 hook,always await(同步返回也可以 await)----
            let result: void | HookResult<HookContexts[K]>;
            try {
                result = await entry.hook(currentCtx);
            } catch (err) {
                // hook 抛异常:打日志,跳过这个 hook,不影响其他
                console.error(
                    `[hook] ${kind} hook threw, skipped:`,
                    (err as Error).message,
                );
                continue;
            }

            // ---- 3. 空返回:观察者,继续下一个 ----
            if (!result) continue;

            // ---- 4. 有返回:先更新 ctx(即使被 block 也更新,方便日志)----
            if (result.ctx !== undefined) {
                currentCtx = result.ctx;
            }

            // ---- 5. 阻断:立即返回,不跑后续 hook ----
            if (result.block) {
                return { ctx: currentCtx, blocked: true, reason: result.reason };
            }
        }

        return { ctx: currentCtx, blocked: false };
    }

    // ============================================================
    // matcher 匹配逻辑
    // ============================================================
    private matches(matcher: Matcher, name: string | undefined): boolean {
        // 通配
        if (matcher === "*") return true;
        // SessionStart / UserPromptSubmit 这类没有 toolName 的 hook,
        // 只有 "*" matcher 才生效;传具体名字给它们没意义
        if (name === undefined) return false;
        if (typeof matcher === "string") return matcher === name;
        return matcher.includes(name);
    }
}