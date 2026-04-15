/**
 * Documentation navigation + page metadata.
 * Pages live in src/pages/docs/* (zh) and src/pages/en/docs/* (en).
 */

import type { Lang } from "./strings.ts";

export interface DocPage {
  slug: string;        // URL segment under /docs/, e.g. "install"
  title: string;       // sidebar + page title
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const docsNav: Record<Lang, DocSection[]> = {
  zh: [
    {
      title: "上手",
      pages: [
        { slug: "", title: "概览" },
        { slug: "install", title: "安装" },
        { slug: "quick-start", title: "快速开始" },
      ],
    },
    {
      title: "核心概念",
      pages: [
        { slug: "channels", title: "聊天渠道" },
        { slug: "rules", title: "自然语言规则" },
        { slug: "llm-providers", title: "LLM 服务商" },
      ],
    },
    {
      title: "其他",
      pages: [
        { slug: "faq", title: "常见问题" },
      ],
    },
  ],
  en: [
    {
      title: "Get started",
      pages: [
        { slug: "", title: "Overview" },
        { slug: "install", title: "Install" },
        { slug: "quick-start", title: "Quick start" },
      ],
    },
    {
      title: "Core concepts",
      pages: [
        { slug: "channels", title: "Chat channels" },
        { slug: "rules", title: "Natural language rules" },
        { slug: "llm-providers", title: "LLM providers" },
      ],
    },
    {
      title: "Other",
      pages: [
        { slug: "faq", title: "FAQ" },
      ],
    },
  ],
};

export const docsLabels = {
  zh: {
    docsTitle: "DlxAI 文档",
    onThisPage: "本页内容",
    edit: "编辑此页",
    prev: "上一页",
    next: "下一页",
  },
  en: {
    docsTitle: "DlxAI Docs",
    onThisPage: "On this page",
    edit: "Edit this page",
    prev: "Previous",
    next: "Next",
  },
};

/** Build the URL for a doc page given the lang and slug. */
export function docUrl(lang: Lang, slug: string): string {
  const base = lang === "zh" ? "/docs" : "/en/docs";
  return slug ? `${base}/${slug}/` : `${base}/`;
}
