import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../api/index.js";
import { ProviderSetupForm } from "../components/ProviderSetupForm.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { LangToggle } from "../components/LangToggle.js";

function StepDot({ step, currentStep }: { step: number; currentStep: number }) {
  const isActive = step === currentStep;
  const isCompleted = step < currentStep;
  const highlight = isCompleted || isActive;
  return (
    <div
      className="onboarding-step-dot"
      style={{
        backgroundColor: highlight ? "var(--color-primary)" : "var(--color-border)",
        color: highlight ? "#fff" : "var(--color-text-muted)",
      }}
    >
      {isCompleted ? "\u2713" : step + 1}
    </div>
  );
}

export function OnboardingPage({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    trackEvent("onboarding.started", { language: i18n.language });
  }, []);

  const panelSections = [
    { name: t("onboarding.sectionRules"), desc: t("onboarding.sectionRulesDesc") },
    { name: t("onboarding.sectionProviders"), desc: t("onboarding.sectionProvidersDesc") },
    { name: t("onboarding.sectionChannels"), desc: t("onboarding.sectionChannelsDesc") },
    { name: t("onboarding.sectionPermissions"), desc: t("onboarding.sectionPermissionsDesc") },
    { name: t("onboarding.sectionUsage"), desc: t("onboarding.sectionUsageDesc") },
  ];

  return (
    <div className="onboarding-page">
      <div className="onboarding-bottom-actions">
        <ThemeToggle />
        <LangToggle />
      </div>
      <div className="onboarding-top-controls">
        <button
          className="btn-ghost"
          onClick={onComplete}
        >
          {t("onboarding.skipSetup")}
        </button>
      </div>

      <div
        className="onboarding-card"
        style={{ maxWidth: currentStep === 0 ? 960 : 560 }}
      >
        {/* Step indicator */}
        <div className="onboarding-steps">
          <StepDot step={0} currentStep={currentStep} />
          <div
            className="onboarding-connector"
            style={{ backgroundColor: currentStep > 0 ? "var(--color-primary)" : "var(--color-border)" }}
          />
          <StepDot step={1} currentStep={currentStep} />
        </div>

        {/* Step 0: Welcome + Provider */}
        {currentStep === 0 && (
          <ProviderSetupForm
            onSave={(provider) => {
              trackEvent("onboarding.provider_saved", { provider });
              setCurrentStep(1);
            }}
            title={t("onboarding.welcomeTitle")}
            description={t("onboarding.welcomeDesc")}
            saveButtonLabel={t("onboarding.saveAndContinue")}
            validatingLabel={t("onboarding.validating")}
            savingLabel={t("onboarding.saving")}
            variant="page"
          />
        )}

        {/* Step 1: All set */}
        {currentStep === 1 && (
          <div>
            <h1>
              {t("onboarding.allSetTitle")}
            </h1>
            <p>
              {t("onboarding.allSetDesc")}
            </p>

            <div className="mb-lg">
              {panelSections.map((s) => (
                <div
                  key={s.name}
                  className="onboarding-section-item"
                >
                  <strong>{s.name}</strong>
                  <span className="text-secondary" style={{ marginLeft: 8 }}>
                    — {s.desc}
                  </span>
                </div>
              ))}
            </div>

            <button
              className="btn btn-primary"
              onClick={() => {
                trackEvent("onboarding.completed");
                onComplete();
              }}
            >
              {t("onboarding.goToDashboard")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
