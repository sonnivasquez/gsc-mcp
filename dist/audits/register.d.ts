import type { AuditDeps } from "./context.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerAudits(server: McpServer, deps?: AuditDeps): void;
