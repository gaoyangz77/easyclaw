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
import { UsagePage } from "./pages/UsagePage.js";
// TODO: Unhide after server-side telemetry receiver is deployed (see PROGRESS.md V1)
// import { SettingsPage } from "./pages/SettingsPage.js";
import { OnboardingPage } from "./pages/OnboardingPage.js";
import { WhatsNewModal } from "./components/WhatsNewModal.js";
import { fetchSettings, fetchChangelog } from "./api.js";
import type { ChangelogEntry } from "./api.js";

const PAGES: Record<string, () => ReactNode> = {
  "/": ChatPage,
  "/rules": RulesPage,
  "/providers": ProvidersPage,
  "/channels": ChannelsPage,
  "/permissions": PermissionsPage,
  "/stt": SttPage,
  "/usage": UsagePage,
  // TODO: Unhide after server-side telemetry receiver is deployed (see PROGRESS.md V1)
  // "/settings": SettingsPage,
};

/** Normalise a browser pathname to one of our known routes, defaulting to "/" */
function resolveRoute(pathname: string): string {
  return pathname in PAGES ? pathname : "/";
}

export function App() {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState(() => resolveRoute(window.location.pathname));
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);
  const [currentVersion, setCurrentVersion] = useState("");

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
  }, []);

  useEffect(() => {
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

  function handleOnboardingComplete() {
    setShowOnboarding(false);
    navigate("/");
  }

  if (showOnboarding === null) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
        }}
      >
        {t("common.loading")}
      </div>
    );
  }

  if (showOnboarding) {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  const PageComponent = PAGES[currentPath] ?? ChatPage;
  return (
    <Layout currentPath={currentPath} onNavigate={navigate}>
      <PageComponent />
      <WhatsNewModal
        isOpen={showWhatsNew}
        onClose={() => setShowWhatsNew(false)}
        entries={changelogEntries}
        currentVersion={currentVersion}
      />
    </Layout>
  );
}
