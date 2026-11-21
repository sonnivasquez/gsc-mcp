"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReadToolRegistrar = createReadToolRegistrar;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const registry_version_js_1 = require("./registry-version.js");
const update_notice_js_1 = require("./update-notice.js");
const RETRY_DELAY_MS = 60_000;
function text(text) {
    return { type: "text", text };
}
/** Only read tools opt into a prompt that can defer execution. */
function createReadToolRegistrar(server, lookup = update_notice_js_1.findAvailableUpdate) {
    let nextCheckAt = 0;
    let lastNoticedVersion;
    function reserveVersion(version) {
        const reservation = (0, update_notice_js_1.reserveUpdateNotice)(version);
        // Another session can remove its delivery marker if its response is cancelled.
        if (reservation === "delivered")
            return undefined;
        if (reservation === "busy") {
            nextCheckAt = Date.now() + RETRY_DELAY_MS;
            return undefined;
        }
        return reservation;
    }
    return (name, description, schema, callback) => {
        const wrapped = async (input, extra) => {
            let version;
            if (Date.now() >= nextCheckAt && process.env.GSC_UPDATE_CHECK !== "0") {
                // Parallel calls proceed while the first call checks or asks. Retry
                // transient failures on a later call, never in a background timer.
                nextCheckAt = Date.now() + RETRY_DELAY_MS;
                const update = await lookup();
                if (update && !extra.signal.aborted) {
                    nextCheckAt = Date.now() + registry_version_js_1.REGISTRY_VERSION_CACHE_TTL_MS;
                    if (lastNoticedVersion !== update.version)
                        version = update.version;
                }
            }
            extra.signal.throwIfAborted();
            if (!version)
                return callback(input, extra);
            const guidance = `Run gsc update --to ${version} with the CLI that runs this server, then reconnect GSC MCP.`;
            const elicitation = server.server.getClientCapabilities()?.elicitation;
            if (elicitation && (elicitation.form !== undefined || Object.keys(elicitation).length === 0)) {
                const reservation = reserveVersion(version);
                if (!reservation)
                    return callback(input, extra);
                const answer = await extra.sendRequest({
                    method: "elicitation/create",
                    params: {
                        mode: "form",
                        message: `GSC MCP ${version} is available. Choose whether to update before running this request.`,
                        requestedSchema: {
                            type: "object",
                            properties: {
                                action: { type: "string", enum: ["update", "continue"], enumNames: ["Update now", "Continue"] },
                            },
                            required: ["action"],
                        },
                    },
                }, types_js_1.ElicitResultSchema, { timeout: 20_000, signal: extra.signal }).catch(() => {
                    // Release the reservation before falling back to a text notice.
                    reservation.release();
                    return undefined;
                });
                if (answer) {
                    reservation.complete();
                    lastNoticedVersion = version;
                    if (answer.action === "accept" && answer.content?.action === "update") {
                        return { isError: true, content: [text(`Request paused for update. ${guidance} Retry the request after reconnecting.`)] };
                    }
                    extra.signal.throwIfAborted();
                    return callback(input, extra);
                }
            }
            try {
                extra.signal.throwIfAborted();
                const result = await callback(input, extra);
                extra.signal.throwIfAborted();
                const notice = text(`GSC MCP ${version} is available. ${guidance}`);
                const response = { ...result, content: [...result.content, notice] };
                const undoDelivery = reserveVersion(version)?.complete();
                if (!undoDelivery)
                    return result;
                lastNoticedVersion = version;
                // The SDK can still discard the response if the request is cancelled.
                extra.signal.addEventListener("abort", () => {
                    undoDelivery();
                    if (lastNoticedVersion === version) {
                        lastNoticedVersion = undefined;
                        nextCheckAt = 0;
                    }
                }, { once: true });
                return response;
            }
            catch (error) {
                nextCheckAt = 0;
                throw error;
            }
        };
        // Preserve the SDK's raw-shape conversion, including its Zod 4 empty schema.
        server.registerTool(name, { description, inputSchema: schema }, wrapped);
    };
}
