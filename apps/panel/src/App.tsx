import { useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Layout } from "./layout/Layout.js";
import { ChatPage } from "./pages/ChatPage.js";
import { RulesPage } from "./pages/RulesPage.js";
import { ProvidersPage } from "./pages/ProvidersPage.js";
import { ChannelsPage } from "./pages/ChannelsPage.js";
import { PermissionsPage } from "./pages/PermissionsPage.js";
import { SttPage } from "./pages/SttPage.js";
import { KeyUsagePage } from "./pages/KeyUsagePage.js";
import { SkillsPage } from "./pages/SkillsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { AppsPage } from "./pages/AppsPage.js";
import { OnboardingPage } from "./pages/OnboardingPage.js";
import { WhatsNewModal } from "./components/WhatsNewModal.js";
import { TelemetryConsentModal } from "./components/TelemetryConsentModal.js";
import { fetchSettings, fetchChangelog, trackEvent } from "./api/index.js";
import type { ChangelogEntry } from "./api/index.js";

const PAGES: Record<string, () => ReactNode> = {
  "/": () => null, // ChatPage is always rendered directly (not via PAGES) to keep its WS alive
  "/rules": RulesPage,
  "/providers": ProvidersPage,
  "/channels": ChannelsPage,
  "/permissions": PermissionsPage,
  "/stt": SttPage,
  "/usage": KeyUsagePage,
  "/skills": SkillsPage,
  "/apps": AppsPage,
  "/settings": SettingsPage,
};

/** Normalise a browser pathname to one of our known routes, defaulting to "/" */
function resolveRoute(pathname: string): string {
  return pathname in PAGES ? pathname : "/";
}

function pageNameFromRoute(route: string): string {
  return route === "/" ? "chat" : route.slice(1);
}

export function App() {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState(() => resolveRoute(window.location.pathname));
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [showTelemetryConsent, setShowTelemetryConsent] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);
  const [currentVersion, setCurrentVersion] = useState("");
  const [agentName, setAgentName] = useState<string | null>(null);

  // Keep state in sync when user presses browser Back / Forward
  useEffect(() => {
    function onPopState() {
      setCurrentPath(resolveRoute(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    const route = resolveRoute(path);
    if (route !== window.location.pathname) {
      window.history.pushState(null, "", route);
    }
    setCurrentPath(route);
    trackEvent("panel.page_viewed", { page: pageNameFromRoute(route) });
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_FORCE_ONBOARDING === "1") {
      setShowOnboarding(true);
      return;
    }
    checkOnboarding();
  }, []);

  async function checkOnboarding() {
    try {
      const settings = await fetchSettings();
      const provider = settings["llm-provider"];
      // API keys are masked to "configured" by the server when present
      const hasApiKey = provider
        ? settings[`${provider}-api-key`] === "configured"
        : false;

      // Show onboarding until a provider with a valid API key is configured
      setShowOnboarding(!hasApiKey);
    } catch {
      setShowOnboarding(false);
    }
  }

  // Check for "What's New" after onboarding is resolved
  useEffect(() => {
    if (showOnboarding !== false) return;
    fetchChangelog()
      .then((data) => {
        if (!data.currentVersion || data.entries.length === 0) return;
        const lastSeen = localStorage.getItem("whatsNew.lastSeenVersion");
        if (lastSeen !== data.currentVersion) {
          setChangelogEntries(data.entries);
          setCurrentVersion(data.currentVersion);
          setShowWhatsNew(true);
        }
      })
      .catch(() => {});
  }, [showOnboarding]);

  // Show telemetry consent dialog on first launch (after onboarding)
  useEffect(() => {
    if (showOnboarding !== false) return;
    if (!localStorage.getItem("telemetry.consentShown")) {
      setShowTelemetryConsent(true);
    }
  }, [showOnboarding]);

  // Track initial page view when main app mounts (not during onboarding)
  useEffect(() => {
    if (showOnboarding === false) {
      trackEvent("panel.page_viewed", { page: pageNameFromRoute(currentPath) });
    }
  }, [showOnboarding === false]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleOnboardingComplete() {
    setShowOnboarding(false);
    navigate("/");
  }

  if (showOnboarding === null) {
    return (
      <div className="app-loading">
        {t("common.loading")}
      </div>
    );
  }

  if (showOnboarding) {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  const OtherPage = currentPath !== "/" && currentPath !== "/channels" ? PAGES[currentPath] : null;
  return (
    <Layout currentPath={currentPath} onNavigate={navigate} agentName={agentName}>
      {/* Keep ChatPage always mounted so its WebSocket connection and pending
          message state survive navigation to other pages (e.g. ProvidersPage). */}
      <div className={currentPath === "/" ? "contents-toggle" : "hidden-toggle"}>
        <ChatPage onAgentNameChange={setAgentName} />
      </div>
      {/* Keep ChannelsPage mounted to avoid re-fetching channel status on every visit. */}
      <div className={currentPath === "/channels" ? "contents-toggle" : "hidden-toggle"}>
        <ChannelsPage />
      </div>
      {OtherPage && <OtherPage />}
      <WhatsNewModal
        isOpen={showWhatsNew}
        onClose={() => setShowWhatsNew(false)}
        entries={changelogEntries}
        currentVersion={currentVersion}
      />
      <TelemetryConsentModal
        isOpen={showTelemetryConsent && !showWhatsNew}
        onClose={() => setShowTelemetryConsent(false)}
      />
    </Layout>
  );
}
