import { useEffect, useMemo } from "react";
import { Outlet, useLocation } from "react-router";
import { useAuth } from "wasp/client/auth";
import { routes } from "wasp/client/router";
import { Toaster } from "../client/components/ui/toaster";
import "./Main.css";
import NavBar from "./components/NavBar/NavBar";
import {
  demoNavigationitems,
  marketingNavigationItems,
} from "./components/NavBar/constants";
import CookieConsentBanner from "./components/cookie-consent/Banner";

/**
 * use this component to wrap all child components
 * this is useful for templates, themes, and context
 */
export default function App() {
  const location = useLocation();
  const { data: user } = useAuth();
  const isMarketingPage = useMemo(() => {
    return (
      location.pathname === "/" || location.pathname.startsWith("/pricing")
    );
  }, [location]);

  const navigationItems = isMarketingPage
    ? marketingNavigationItems
    : demoNavigationitems;

  const shouldDisplayAppNavBar = useMemo(() => {
    return (
      location.pathname !== routes.LoginRoute.build() &&
      location.pathname !== routes.SignupRoute.build()
    );
  }, [location]);

  const isAdminDashboard = useMemo(() => {
    return location.pathname.startsWith("/admin");
  }, [location]);

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.replace("#", "");
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView();
      }
    }
  }, [location]);

  // Initialize Pendo with anonymous ID on app load
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.initialize({
        visitor: {
          id: 'ANONYMOUS_VISITOR_ID'
        }
      });
    }
  }, []);

  // Identify with actual user data once authenticated
  useEffect(() => {
    if (user && typeof window !== 'undefined' && (window as any).pendo) {
      (window as any).pendo.identify({
        visitor: {
          id: user.id,
          email: user.email || undefined,
          username: user.username || undefined,

          // Selectively include important visitor metadata fields
          is_admin: user.isAdmin,
          subscription_plan: user.subscriptionPlan || 'free',
          subscription_status: user.subscriptionStatus || 'none',
          credits: user.credits,
          created_at: user.createdAt?.toISOString(),
        }
      });
    }
  }, [user]);

  return (
    <>
      <div className="bg-background text-foreground min-h-screen">
        {isAdminDashboard ? (
          <Outlet />
        ) : (
          <>
            {shouldDisplayAppNavBar && (
              <NavBar navigationItems={navigationItems} />
            )}
            <div className="mx-auto max-w-(--breakpoint-2xl)">
              <Outlet />
            </div>
          </>
        )}
      </div>
      <Toaster position="bottom-right" />
      <CookieConsentBanner />
    </>
  );
}
