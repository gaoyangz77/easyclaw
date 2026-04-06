import { useState, useEffect } from "react";
import { fetchAccessMode, setAccessMode } from "../api/credits.js";
import type { AccessMode } from "@rivonclaw/core";

const MODES: { id: AccessMode; label: string; desc: string }[] = [
  {
    id: "credits",
    label: "默认模型（积分）",
    desc: "新用户免费体验，消耗积分使用 AI。积分耗尽后可充值。",
  },
  {
    id: "coding-plan",
    label: "编程订阅计划",
    desc: "使用您自己的编程订阅（智谱编程、Moonshot Coding、通义编程等）。",
  },
  {
    id: "subscription",
    label: "订阅 / API Key",
    desc: "使用您自己的 Claude/Gemini 订阅或 OpenAI、Anthropic、OpenRouter 等 API Key。",
  },
];

export function AccessModePage() {
  const [current, setCurrent] = useState<AccessMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchAccessMode()
      .then((r) => setCurrent(r.mode))
      .catch(() => {});
  }, []);

  async function handleSelect(mode: AccessMode) {
    setSaving(true);
    setMsg(null);
    try {
      await setAccessMode(mode);
      setCurrent(mode);
      setMsg("切换成功，下次启动时生效。");
    } catch (err) {
      setMsg(`切换失败：${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page access-mode-page">
      <h1>接入模式</h1>
      <p>选择您希望使用的 AI 接入方式：</p>

      <div className="access-mode-page__cards">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`access-mode-page__card ${current === m.id ? "selected" : ""}`}
            onClick={() => handleSelect(m.id)}
            disabled={saving}
          >
            <div className="access-mode-page__card-label">{m.label}</div>
            <div className="access-mode-page__card-desc">{m.desc}</div>
            {current === m.id && <div className="access-mode-page__card-badge">当前</div>}
          </button>
        ))}
      </div>

      {msg && <p className="access-mode-page__msg">{msg}</p>}
    </div>
  );
}
