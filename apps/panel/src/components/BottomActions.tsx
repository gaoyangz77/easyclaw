import { ThemeToggle } from "./ThemeToggle.js";
import { LangToggle } from "./LangToggle.js";
import { HelpLink } from "./HelpLink.js";
import { UserAvatarButton } from "./UserAvatarButton.js";

/**
 * Unified bottom-actions bar used in both the sidebar and the onboarding page.
 * Pass `collapsed` to switch to the vertical (icon-only) layout used when the sidebar is collapsed.
 */
export function BottomActions({
    collapsed = false,
    onNavigate: _,
}: {
    collapsed?: boolean;
    onNavigate?: (path: string) => void;
}) {
    return (
        <div
            className={`sidebar-bottom-actions${collapsed ? " sidebar-bottom-actions-collapsed" : ""}`}
        >
            <ThemeToggle />
            <LangToggle />
            <HelpLink />
            <UserAvatarButton />
        </div>
    );
}
