import { readFile } from "node:fs/promises";
import type { PermissionRule } from "./engine.ts";
const VALID_VERDICTS = new Set(["allow", "deny", "ask"]);

//但 rule 是从 JSON.parse 来的,实际是 unknown——你等于在说"我保证这是 PermissionRule",但函数体里的 check 又假设它可能不是
function isValidRule(rule:unknown) {
    // 检查 tool 是 string、verdict 是三种之一、argPattern 结构对
    // 参考 skills.ts 里的 loadSkills 那种"失败跳过 + warn"风格
    if (typeof rule !== "object" || rule === null) {
        console.warn(`[permissions] rule is not an object`);
        return false;
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.tool !== "string"){ 
        console.warn(`[permission] rule.tool has invalid format`)
        return false    
    }
    if (typeof r.verdict !== "string" || !VALID_VERDICTS.has(r.verdict)) {
        console.warn(`[permissions] rule.verdict must be allow/deny/ask, got:`, r.verdict);
        return false;
    }
    // 为了应对无效的 argPattern
    if (r.argPattern !== undefined) {
        if (typeof r.argPattern !== "object" || r.argPattern === null) {
            console.warn(`[permissions] rule.argPattern must be object`);
            return false;
        }
        const p = r.argPattern as Record<string, unknown>;
        if (typeof p.field !== "string" || typeof p.matches !== "string") {
            console.warn(`[permissions] rule.argPattern must have string field + matches`);
            return false;
        }
    }
    if (r.reason !== undefined && typeof r.reason !== "string") {
        console.warn(`[permissions] rule.reason must be string if present`);
        return false;
    }
    return true
}

export async function loadRules(file: string) : Promise<PermissionRule[]> {
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
            console.warn(`[permissions] ${file} not found, no rules loaded`);
        } else {
            console.warn(`[permissions] cannot read ${file}:`, err);
        }
        return [];
    }
    let data : unknown;
    try {
        data = JSON.parse(text)
    } catch(err) {
        console.warn(`[permissions] ${file} is not valid JSON:`, err);
        return [];
    }
    if (typeof data !== "object" || data === null ||  !Array.isArray((data as { rules?: unknown }).rules)) {
        console.warn(`[permissions] ${file}: expected { rules: [...] }`);
        return [];
    }
    const rawRules = (data as {rules: PermissionRule[]}).rules
    const rules = rawRules.filter(isValidRule).sort((a, b) => {
        if (a.argPattern && !b.argPattern) return -1;
        if (!a.argPattern && b.argPattern) return 1;
        return 0;
    });
    console.log(`[permissions] loaded ${rules.length}/${rawRules.length} rules from ${file}`);
    return rules
}