"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLI_VERSION = void 0;
// Single source of truth for the published CLI version.
// Imported by doctor.ts (re-exported to preserve its public API) and by
// client-config.ts for pinned automatic setup outputs. Kept dependency-free
// so pure config builders never pull oauth/auth-provider/googleapis.
exports.CLI_VERSION = "1.0.0";
