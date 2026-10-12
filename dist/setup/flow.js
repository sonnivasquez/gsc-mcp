"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChoiceAnswer = parseChoiceAnswer;
exports.terminalPromptAdapter = terminalPromptAdapter;
exports.validatedChoice = validatedChoice;
exports.createSetupState = createSetupState;
exports.chooseProperty = chooseProperty;
const readline = __importStar(require("node:readline/promises"));
function parseChoiceAnswer(answer, choiceCount, defaultIndex) {
    const trimmed = answer.trim();
    const index = Number(trimmed) - 1;
    return /^\d+$/.test(trimmed) && index >= 0 && index < choiceCount ? index : defaultIndex;
}
/** Terminal I/O is deliberately outside the setup decision model. */
function terminalPromptAdapter(nonInteractive) {
    if (nonInteractive || !process.stdin.isTTY) {
        return {
            choose: async (_question, _choices, defaultIndex) => defaultIndex,
            text: async (_question, fallback) => fallback,
            close: () => undefined,
            interactive: false,
        };
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return {
        choose: async (question, choices, defaultIndex) => {
            return parseChoiceAnswer(await rl.question(question), choices.length, defaultIndex);
        },
        text: async (question, fallback) => (await rl.question(question)).trim() || fallback,
        close: () => rl.close(),
        interactive: true,
    };
}
function validatedChoice(choices, index) {
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
        throw new Error("Invalid setup choice");
    }
    return choices[index];
}
function createSetupState(scope, site, client) {
    if (scope !== "readonly" && scope !== "full")
        throw new Error("Invalid setup scope");
    if (!site.trim())
        throw new Error("A dashboard property is required");
    if (!["desktop", "code", "both", "print"].includes(client))
        throw new Error("Invalid setup client");
    return { scope, site, client };
}
function chooseProperty(properties, index) {
    if (properties.length === 0)
        throw new Error("No Search Console properties available");
    return validatedChoice(properties, index);
}
