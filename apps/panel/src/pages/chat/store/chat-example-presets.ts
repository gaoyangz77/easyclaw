export const EXAMPLE_KEYS = ["example1", "example2", "example3", "example4", "example5", "example6"] as const;
export type ExampleKey = (typeof EXAMPLE_KEYS)[number];

/**
 * Ecommerce preset examples by locale.
 * Falls back to "en" for unknown locales.
 */
export const ECOMMERCE_PRESET: Record<string, Record<ExampleKey, string>> = {
  en: {
    example1: "Check if there are any pending customer service conversations",
    example2: "Review all pending CS conversations — mark trivial ones as read, escalate the rest to a human agent",
    example3: "Use the cs-prompt skill to help me write store prompt guidelines",
    example4: "Use the cs-optimize skill to review and audit yesterday's customer service conversations",
    example5: "Check which orders have return/refund requests and whether the return shipping has been completed",
    example6: "Summarize our store's recent customer service performance",
  },
  zh: {
    example1: "看看有哪些待处理的客服对话",
    example2: "待处理的客服对话你帮过过一遍，没必要处理的直接标记为已读，有必要处理的就派客服处理",
    example3: "使用cs-prompt技能帮我写一下店铺提示词",
    example4: "使用cs-optmize技能帮我回顾审核一下过去一天的客服对话",
    example5: "看看店铺有哪些退货退款订单，并且看看退货的物流完成了没",
    example6: "帮我总结一下最近店铺的客服表现",
  },
};

/**
 * Get preset-specific example texts for a given preset and locale.
 * Returns null for the "default" preset (uses i18n fallback).
 */
export function getPresetExamples(presetId: string, lang: string): Record<ExampleKey, string> | null {
  if (presetId === "default") return null;
  if (presetId === "ecommerce") {
    const locale = lang.startsWith("zh") ? "zh" : "en";
    return ECOMMERCE_PRESET[locale] ?? ECOMMERCE_PRESET["en"];
  }
  return null;
}
