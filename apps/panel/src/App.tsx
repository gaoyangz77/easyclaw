import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Layout } from "./layout/Layout.js";
import { RulesPage } from "./pages/RulesPage.js";
import { ProvidersPage } from "./pages/ProvidersPage.js";
import { ChannelsPage } from "./pages/ChannelsPage.js";
import { PermissionsPage } from "./pages/PermissionsPage.js";
import { UsagePage } from "./pages/UsagePage.js";
import { OnboardingPage } from "./pages/OnboardingPage.js";
import { fetchSettings, fetchStatus, updateSettings } from "./api.js";

const PAGES: Record<string, () => ReactNode> = {
  "/": RulesPage,
  "/providers": ProvidersPage,
  "/channels": ChannelsPage,
  "/permissions": PermissionsPage,
  "/usage": UsagePage,
};

export function App() {
  const [currentPath, setCurrentPath] = useState("/");
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    checkOnboarding();
  }, []);

  async function checkOnboarding() {
    try {
      const [settings, status] = await Promise.all([
        fetchSettings(),
        fetchStatus(),
      ]);
      const hasProvider = !!settings["llm-provider"];
      const hasRules = status.ruleCount > 0;
      const completed = settings["onboarding-completed"] === "true";

      setShowOnboarding(!completed && !hasProvider && !hasRules);
    } catch {
      setShowOnboarding(false);
    }
  }

  async function handleOnboardingComplete() {
    try {
      await updateSettings({ "onboarding-completed": "true" });
    } catch {
      // non-critical
    }
    setShowOnboarding(false);
    setCurrentPath("/");
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
        Loading...
      </div>
    );
  }

  if (showOnboarding) {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  const PageComponent = PAGES[currentPath] ?? RulesPage;
  return (
    <Layout currentPath={currentPath} onNavigate={setCurrentPath}>
      <PageComponent />
    </Layout>
  );
}
