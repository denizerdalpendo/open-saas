import { LogOut } from "lucide-react";
import { logout } from "wasp/client/auth";
import { Link as WaspRouterLink } from "wasp/client/router";
import { type User } from "wasp/entities";
import { userMenuItems } from "./constants";

export const UserMenuItems = ({
  user,
  onItemClick,
}: {
  user?: Partial<User>;
  onItemClick?: () => void;
}) => {
  return (
    <>
      {userMenuItems.map((item) => {
        if (item.isAuthRequired && !user) return null;
        if (item.isAdminOnly && (!user || !user.isAdmin)) return null;

        return (
          <li key={item.name}>
            <WaspRouterLink
              to={item.to}
              onClick={onItemClick}
              className="text-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium leading-7 transition-colors"
            >
              <item.icon size="1.1rem" />
              {item.name}
            </WaspRouterLink>
          </li>
        );
      })}
      <li>
        <button
          onClick={() => {
            // Track user_logout event
            if (typeof window !== 'undefined' && (window as any).pendo && user) {
              // Calculate session duration from localStorage or session storage
              const sessionStartKey = `session_start_${user.id}`;
              const sessionStart = localStorage.getItem(sessionStartKey);
              let sessionDurationMinutes = 0;

              if (sessionStart) {
                const now = new Date();
                const startTime = new Date(sessionStart);
                sessionDurationMinutes = Math.floor((now.getTime() - startTime.getTime()) / (1000 * 60));
              }

              (window as any).pendo.track("user_logout", {
                user_id: user.id,
                session_duration_minutes: sessionDurationMinutes,
                actions_performed_in_session: "unknown"
              });

              // Clean up session tracking
              localStorage.removeItem(sessionStartKey);
            }

            logout();
            onItemClick?.();
          }}
          className="text-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium leading-7 transition-colors"
        >
          <LogOut size="1.1rem" />
          Log Out
        </button>
      </li>
    </>
  );
};
