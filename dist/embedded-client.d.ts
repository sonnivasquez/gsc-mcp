/**
 * Quick Connect uses this desktop OAuth client. A desktop client secret ships
 * with the app because the installed-app flow treats it as non-confidential:
 * it only names the app on the consent screen. Access still requires the
 * user's own Google sign-in, and tokens stay on the user's machine.
 * GSC_OAUTH_CLIENT_ID plus GSC_OAUTH_CLIENT_SECRET, or
 * GSC_OAUTH_SECRETS_FILE, replace these values when set.
 */
export declare const EMBEDDED_CLIENT_ID = "101991762166-8i1530uhjukg3tp8hgjvj11tfoat6a69.apps.googleusercontent.com";
export declare const EMBEDDED_CLIENT_SECRET = "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";
export declare function embeddedClientAvailable(): boolean;
