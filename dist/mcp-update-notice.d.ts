import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { findAvailableUpdate } from "./update-notice.js";
export type ReadToolRegistrar = <Shape extends z.ZodRawShape>(name: string, description: string, schema: Shape, callback: ToolCallback<z.ZodObject<Shape>>) => void;
/** Only read tools opt into a prompt that can defer execution. */
export declare function createReadToolRegistrar(server: McpServer, lookup?: typeof findAvailableUpdate): ReadToolRegistrar;
