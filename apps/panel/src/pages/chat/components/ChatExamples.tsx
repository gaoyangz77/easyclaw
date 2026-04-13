import { useTranslation } from "react-i18next";

export interface ChatExamplesProps {
  chatExamplesExpanded: boolean;
  resolvedExamples: Record<string, string>;
  overriddenKeys: Set<string>;
  onToggleExpanded: () => void;
  onSelectExample: (text: string) => void;
  onEditExample: (key: string, currentText: string) => void;
}

export function ChatExamples({
  chatExamplesExpanded,
  resolvedExamples,
  onToggleExpanded,
  onSelectExample,
  onEditExample,
}: ChatExamplesProps) {
  const { t } = useTranslation();

  return (
    <div className="chat-examples">
      <button
        className="chat-examples-toggle"
        onClick={onToggleExpanded}
      >
        <svg className={`chat-examples-chevron ${chatExamplesExpanded ? "chat-examples-chevron-down" : ""}`} width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4.5 10L8 6.5L11.5 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {chatExamplesExpanded && (
        <>
          <div className="chat-examples-title">{t("chat.examplesTitle")}</div>
          <div className="chat-examples-grid">
            {(["example1", "example2", "example3", "example4", "example5", "example6"] as const).map((key) => {
              const text = resolvedExamples[key];
              return (
                <button
                  key={key}
                  className="chat-example-card"
                  onClick={() => onSelectExample(text)}
                >
                  {text}
                  <span
                    className="chat-example-edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditExample(key, resolvedExamples[key]);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
