import {loadRules} from "./loader"

export type Verdict = "allow" | "deny" | "ask";

export interface PermissionRule {
    tool: string;           // 精确匹配 tool name(必填)
    verdict: Verdict;
    argPattern?: {         // 可选:对参数做 pattern 匹配(简单版)
        field: string;      // 参数字段名,比如 "command"
        matches: string;    // 正则字符串,比如 "^rm\\s"
    };
    reason?: string;        // deny/ask 时给用户/LLM 看的说明
}
//优先级规则(从高到低):
//  1. Session 内存里的"always allow"记录(用户之前 confirm 过)
//  2. 精确匹配 rule(有 argPattern 的 rule)——命中的第一条
//  3. 通用匹配 rule(只有 tool,没有 argPattern)
//  4. 兜底:allow(未定义的 tool 默认放行)

export interface Decision {
    verdict: Verdict;
    reason?: string;
    ruleId?: number  /// 匹配到的 rule 在数组里的 index,便于 debug
}

export class PermissionEngine {
    private memory= {
        rules: [] as PermissionRule[],
        alwaysAllow: new Set<string>()
    };
    constructor(rules: PermissionRule[]) {
        this.memory.rules = rules
    };
    /**
     * 主查询接口
     * 优先级:memory > 精确 rule (含 argPattern) > 通用 rule > default(allow)
     */
    decide(toolName: string, args: Record<string, unknown>): Decision {

        if (this.memory.alwaysAllow.has(toolName)) {
            return { verdict: "allow", reason: "session memory" }
        }
        for (const [i, rule] of this.memory.rules.entries()) {
            if (rule.tool !== toolName) continue
            if (rule.argPattern) {
                const value = args[rule.argPattern.field];
                if (typeof value !== "string") continue
                const re = new RegExp(rule.argPattern.matches)
                if (re.test(value)) {
                    return { verdict: rule.verdict, reason: rule.reason, ruleId:i }
                }
                // 如果没匹配上，那么return 最后的兜底
            } else {
                // 通用规则
                return { verdict: rule.verdict, reason: rule.reason, ruleId: i }
            }
        }
        return {verdict: "allow", reason: "default (no rule matched)"}
    }
    // 用户 "always allow this tool" 后调
    rememberAllowTool(toolName: string): void {
        this.memory.alwaysAllow.add(toolName)
    }
    // 获取信息
    getRules() : readonly PermissionRule[] {
        return this.memory.rules;
    }
    getMemory(): { alwaysAllow: readonly string[] } {
        return { alwaysAllow: Array.from(this.memory.alwaysAllow) }
    }
}


export async  function loadPermissionEngine(file:string) {
    const rules = await loadRules(file)
    const engin = new PermissionEngine(rules)
    return engin
}

// smoke-test
// const rules: PermissionRule[] = [
//     { tool: "read_file", verdict: "allow" },
//     { tool: "bash", argPattern: { field: "command", matches: "^\\s*rm\\s" }, verdict: "deny", reason: "rm blocked" },
//     { tool: "bash", verdict: "ask" },
// ];
// const e = new PermissionEngine(rules);
// console.log(e.decide("read_file", {}));                      // allow
// console.log(e.decide("bash", { command: "rm foo.txt" }));    // deny
// console.log(e.decide("bash", { command: "ls" }));            // ask
// e.rememberAllowTool("bash");
// console.log(e.decide("bash", { command: "ls" }));            // allow (memory)
// console.log(e.decide("unknown_tool", {}));                   // allow (default)