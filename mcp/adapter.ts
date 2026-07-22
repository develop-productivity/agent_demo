import type { McpClient } from "./client.ts";
import type { McpToolDef } from "./types.ts";
import type { TSchema } from "typebox";
import { defineTool, type Tool} from "../tools/tools.ts";

export function mcpTool(client: McpClient, def:McpToolDef): Tool<any>  {
    return defineTool({
        name: `mcp__${client.name}__${def.name}`,
        description: def.description ?? `MCP tool from ${client.name}`,
        parameters: def.inputSchema as TSchema,
        execute: async (args, ctx) => {
            // args 已经过 typebox validateArgs 校验
            // ctx.signal 可以传给 client(如果 client 支持)—— day-12 先不做
            return await client.callTool(def.name, args as Record<string, unknown>);
        }
    })
}