import type { SetupLocale } from "./setup/i18n.js";
import { type GlobalInstallation } from "./update-install.js";
interface AvailableUpdate {
    version: string;
    installation: GlobalInstallation;
}
export declare function findAvailableUpdate(): Promise<AvailableUpdate | undefined>;
type Release = () => void;
type NoticeReservation = "delivered" | "busy" | {
    complete: () => Release | undefined;
    release: Release;
};
/** Hold one notice per version until delivery, cancellation or expiration. */
export declare function reserveUpdateNotice(version: string): NoticeReservation;
/** Returns the relaunched command exit code, or undefined to continue locally. */
export declare function offerTerminalUpdate(argv: string[], locale?: SetupLocale): Promise<number | undefined>;
export {};
