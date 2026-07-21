// hooks/builtin.ts
import type readline from "node:readline";
import { confirm } from "../utils.js";
import type { HookRegistry } from "./registry";
import { PermissionEngine } from "../permissions/engine";
import {askPermission} from "../permissions/prompt";


// ============================================================
// 工厂函数模式:因为 hook 需要 rl(readline.Interface),
// 直接 export hook 函数就没地方拿 rl 了。
// 用工厂 (rl) => hook 把依赖注进去,再交给 registry 注册。
// ============================================================
export function injectCwdAndTime(ctx: { systemPromptExtras: string[] }) {
    ctx.systemPromptExtras.push(
        `Current working directory: ${process.cwd()}`,
        `Current time: ${new Date().toISOString()}`
    )
}

export function makeConfirmBash(rl: readline.Interface) {
    return async (ctx: { toolName: string; args: Record<string, unknown> }) => {
        const ok = await confirm(rl, `run: ${ctx.args.command}?`);
        if (!ok) return { block: true, reason: "user denied bash" };
    };
}

export function makeConfirmWrite(rl: readline.Interface) {
    return async (ctx: { toolName: string; args: Record<string, unknown> }) => {
        const verb = ctx.toolName === "wirte_file" ? "write" : "edit";
        const ok = await confirm(rl, `write file: ${ctx.args.file}?`);
        if (!ok) return { block: true, reason: `user denied ${verb}` };
    };
}
export function logToolResult(ctx: {toolName: string; args: Record<string, unknown>; result: string; }) {
    const preview = ctx.result.length > 80 ? ctx.result.slice(0, 80) + "..." : ctx.result;
    console.log(`> ${ctx.toolName}(${JSON.stringify(ctx.args)}) -> ${preview}`)
}
export function permissionStstem (engine:PermissionEngine, rl: readline.Interface) {
    return async (ctx: { toolName: string; args: Record<string, unknown> }) => {
        const decision = engine.decide(ctx.toolName, ctx.args);
        if (decision.verdict === "allow") return
        if (decision.verdict === "deny") {
            return { block: true, reason: decision.reason ?? "denied by policy" };
        }
        // verdict = ask
        const choice = await askPermission(rl, ctx.toolName, ctx.args, decision.reason);
        if (choice === "always") {
            engine.rememberAllowTool(ctx.toolName);
        } else if (choice === "no") {
            return { block: true, reason: "user denied" };
        }
        return;
    };
}
export function registerBuiltinHooks(hooks: HookRegistry, rl: readline.Interface, engine: PermissionEngine): void {
    hooks.register("sessionStart", "*", injectCwdAndTime);
    hooks.register("preToolUse", "*", permissionStstem(engine, rl));
    hooks.register("postToolUse", "*", logToolResult);
}

