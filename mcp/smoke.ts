// mcp/smoke.ts
import { McpClient } from "./client.ts";
import {mcpTool} from "./adapter.ts"

async function main() {
    const client = new McpClient("filesystem", {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    });

    await client.start();
    const tools = await client.listTools();
    const piTools = tools.map(t => mcpTool(client, t));
    console.log(piTools);   // 看看 adapter 输出对不对
    await client.close()
    console.log("[smoke] closed");
}
main()