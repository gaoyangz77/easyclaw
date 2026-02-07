import { useState } from "react";
import { updateSettings, createRule } from "../api.js";

const EXAMPLE_RULES = [
  "Never delete files without asking for confirmation first",
  "Always explain what changes you plan to make before executing them",
  "Limit file writes to the current project directory only",
];

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zhipu", label: "Zhipu" },
  { value: "moonshot", label: "Moonshot" },
  { value: "qwen", label: "Qwen" },
];

const PANEL_SECTIONS = [
  { name: "Rules", desc: "Manage behavior rules for your AI agent" },
  { name: "LLM Providers", desc: "Change provider or update your API key" },
  { name: "Channels", desc: "Connect messaging platforms (WeCom, DingTalk)" },
  { name: "Permissions", desc: "Control which files the agent can access" },
  { name: "Usage", desc: "Monitor token consumption" },
];

function StepDot({ step, currentStep }: { step: number; currentStep: number }) {
  const isActive = step === currentStep;
  const isCompleted = step < currentStep;
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          isCompleted || isActive ? "#1a73e8" : "#e0e0e0",
        color: isCompleted || isActive ? "#fff" : "#888",
        fontWeight: 600,
        fontSize: 14,
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
  const [currentStep, setCurrentStep] = useState(0);

  // Step 0 state
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [providerError, setProviderError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Step 1 state
  const [ruleText, setRuleText] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [creatingSaving, setCreatingSaving] = useState(false);

  async function handleSaveProvider() {
    if (!apiKey.trim()) {
      setProviderError("Please enter your API key.");
      return;
    }
    setSaving(true);
    setProviderError(null);
    try {
      await updateSettings({
        "llm-provider": provider,
        "llm-api-key": apiKey,
      });
      setCurrentStep(1);
    } catch (err) {
      setProviderError("Failed to save: " + String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateRule() {
    if (!ruleText.trim()) {
      setRuleError("Please enter a rule or select an example below.");
      return;
    }
    setCreatingSaving(true);
    setRuleError(null);
    try {
      await createRule(ruleText.trim());
      setCurrentStep(2);
    } catch (err) {
      setRuleError("Failed to create rule: " + String(err));
    } finally {
      setCreatingSaving(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f8f9fa",
        padding: 24,
        position: "relative",
      }}
    >
      <button
        onClick={onComplete}
        style={{
          position: "absolute",
          top: 20,
          right: 28,
          background: "none",
          border: "none",
          color: "#888",
          fontSize: 14,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Skip setup
      </button>

      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "48px 40px",
          maxWidth: 560,
          width: "100%",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        {/* Step indicator */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 16,
            marginBottom: 36,
          }}
        >
          <StepDot step={0} currentStep={currentStep} />
          <div style={{ width: 40, height: 2, backgroundColor: currentStep > 0 ? "#1a73e8" : "#e0e0e0" }} />
          <StepDot step={1} currentStep={currentStep} />
          <div style={{ width: 40, height: 2, backgroundColor: currentStep > 1 ? "#1a73e8" : "#e0e0e0" }} />
          <StepDot step={2} currentStep={currentStep} />
        </div>

        {/* Step 0: Welcome + Provider */}
        {currentStep === 0 && (
          <div>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>
              Welcome to EasyClaw
            </h1>
            <p style={{ color: "#5f6368", marginBottom: 24 }}>
              Let's get your AI agent set up. First, configure your LLM provider.
            </p>

            {providerError && (
              <div style={{ color: "red", marginBottom: 12 }}>
                {providerError}
              </div>
            )}

            <label style={{ display: "block", marginBottom: 12 }}>
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #e0e0e0",
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "block", marginBottom: 20 }}>
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: 8,
                  borderRadius: 4,
                  border: "1px solid #e0e0e0",
                  boxSizing: "border-box",
                }}
              />
              <small style={{ color: "#888" }}>
                Stored securely in your OS keychain. Never written to config
                files.
              </small>
            </label>

            <button
              onClick={handleSaveProvider}
              disabled={saving}
              style={{
                padding: "10px 24px",
                backgroundColor: "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving..." : "Save & Continue"}
            </button>
          </div>
        )}

        {/* Step 1: Create first rule */}
        {currentStep === 1 && (
          <div>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>
              Create Your First Rule
            </h1>
            <p style={{ color: "#5f6368", marginBottom: 16 }}>
              Rules control how your AI agent behaves. They can enforce
              policies, guard against dangerous actions, or define new skills.
            </p>

            {ruleError && (
              <div style={{ color: "red", marginBottom: 12 }}>
                {ruleError}
              </div>
            )}

            <textarea
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              placeholder="Enter a rule..."
              rows={3}
              style={{
                display: "block",
                width: "100%",
                padding: 8,
                borderRadius: 4,
                border: "1px solid #e0e0e0",
                resize: "vertical",
                fontFamily: "inherit",
                fontSize: 14,
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />

            <p style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>
              Or try an example:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {EXAMPLE_RULES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setRuleText(ex)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 16,
                    border: "1px solid #e0e0e0",
                    backgroundColor: ruleText === ex ? "#e3f2fd" : "#fff",
                    fontSize: 13,
                    cursor: "pointer",
                    color: "#333",
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={handleCreateRule}
                disabled={creatingSaving}
                style={{
                  padding: "10px 24px",
                  backgroundColor: "#1a73e8",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: creatingSaving ? "default" : "pointer",
                  opacity: creatingSaving ? 0.7 : 1,
                }}
              >
                {creatingSaving ? "Creating..." : "Create Rule & Continue"}
              </button>
              <button
                onClick={() => setCurrentStep(2)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#888",
                  fontSize: 14,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Skip this step
              </button>
            </div>
          </div>
        )}

        {/* Step 2: All set */}
        {currentStep === 2 && (
          <div>
            <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>
              You're All Set!
            </h1>
            <p style={{ color: "#5f6368", marginBottom: 20 }}>
              Here's what you can do in the management panel:
            </p>

            <div style={{ marginBottom: 24 }}>
              {PANEL_SECTIONS.map((s) => (
                <div
                  key={s.name}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 6,
                    borderRadius: 6,
                    backgroundColor: "#f8f9fa",
                  }}
                >
                  <strong>{s.name}</strong>
                  <span style={{ color: "#5f6368", marginLeft: 8 }}>
                    — {s.desc}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={onComplete}
              style={{
                padding: "10px 24px",
                backgroundColor: "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
