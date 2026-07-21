import type { Interface as ReadlineInterface } from "node:readline";

export type PromptChoice = "once" | "always" | "no"

export async function askPermission(
    rl:ReadlineInterface,
    toolName: string,
    args: Record<string, unknown>,
    reason?: string
) :Promise<PromptChoice> {
    console.log(`\n[permission] run ${toolName}`)
    if (reason) console.log(`  reason: ${reason}`)
    console.log(`   args: ${JSON.stringify(args).slice(0, 200)}`)
    return new Promise<PromptChoice>((resolve) => {
        rl.question(
            "  [y] allow once  [a] always for this tool  [n] deny: ",
            (input) => {
                const c = input.trim().toLowerCase()
                if (c === "a" || c === "always") return resolve("always");
                if (c === "n" || c === "no") return resolve("no");
                return resolve("once");
            }
        )
    })

}