/**
 * Bilingual content for the marketing site.
 * Lookup: strings[lang].section.key
 */

export type Lang = "zh" | "en";

export const strings = {
  zh: {
    nav: {
      features: "功能",
      useCases: "场景",
      pricing: "定价",
      docs: "文档",
      github: "GitHub",
      download: "下载",
      langSwitch: "EN",
    },
    hero: {
      eyebrow: "本地优先 · 个人 AI 助理",
      title: "你的 AI 助理，住在你所有的聊天 App 里",
      subtitle:
        "一次安装，Telegram、Discord、Slack、飞书、iMessage 都能找到它。本地运行，规则用大白话写，自带免费额度，零配置开聊。",
      ctaPrimary: "下载客户端",
      ctaSecondary: "查看 GitHub",
      platformLine: "Mac · Windows · Linux",
    },
    why: {
      title: "为什么选 DlxAI？",
      subtitle: "市面上没有第二个产品这样定位。",
      cards: [
        {
          title: "不像 Jan / Msty",
          body: "它会主动来找你。在你常用的聊天 App 里收发消息，而不是你打开 app 才能跟它说话。",
        },
        {
          title: "不像 Botpress / Voiceflow",
          body: "它是你的，不是你客户的。个人 AI，跟随你的身份和偏好，没有 visual flow editor。",
        },
        {
          title: "不像 n8n / Make",
          body: "你不用画流程图。规则用一句话说清楚，自动编译成策略和技能，立即生效。",
        },
      ],
    },
    features: {
      title: "核心功能",
      subtitle: "为不写代码的人设计的 AI agent 驾驶舱。",
      items: [
        {
          icon: "💬",
          title: "13+ 聊天平台接入",
          body: "Telegram、Discord、Slack、飞书 / Lark、iMessage、LINE、Matrix、Mattermost、企业微信…… 一个 agent 全都管。",
        },
        {
          icon: "📝",
          title: "自然语言规则",
          body: "用中文/英文写一句话，自动编译成 policy / guard / skill。改完即时生效，不用重启。",
        },
        {
          icon: "🧠",
          title: "20+ LLM Provider",
          body: "OpenAI、Anthropic、Gemini、DeepSeek、Kimi、Qwen、Groq、Mistral、xAI、本地 Ollama…… 自由切换。",
        },
        {
          icon: "🛒",
          title: "技能市场",
          body: "浏览、搜索、一键安装社区技能。也可以发布自己的技能。",
        },
        {
          icon: "🔒",
          title: "本地优先 + 数据隐私",
          body: "数据全在你的机器上。密钥进 macOS Keychain / Windows DPAPI，永不明文存储。",
        },
        {
          icon: "⚡",
          title: "零重启热更新",
          body: "改 API key、改代理、加渠道、改规则 —— 全部即时生效，不用重启 gateway。",
        },
      ],
    },
    how: {
      title: "三步开聊",
      steps: [
        {
          n: "1",
          title: "下载安装",
          body: "Mac / Windows / Linux 一键安装包，启动后驻留系统托盘。",
        },
        {
          n: "2",
          title: "接入聊天 App",
          body: "在面板里勾选你常用的平台，按提示填 token。WeChat 还支持扫码登录。",
        },
        {
          n: "3",
          title: "用大白话告诉它",
          body: "「每天早上九点把昨天的客户消息总结发我」 —— 写完即生效。",
        },
      ],
    },
    useCases: {
      title: "谁在用",
      items: [
        {
          tag: "个人助理",
          title: "你的随身大脑",
          body: "日程提醒、知识库问答、网页摘要、长期记忆 —— 在 Telegram 里随时召唤。",
        },
        {
          tag: "小微企业主",
          title: "微信飞书里随时回客户",
          body: "客户消息分类、自动回复草稿、订单跟单 —— 老板再也不用一直盯着手机。",
        },
        {
          tag: "跨境业务",
          title: "一个 agent 管所有渠道",
          body: "Telegram + WhatsApp + LINE + Slack 同一个上下文，客户在哪儿都不会漏单。",
        },
        {
          tag: "开发者",
          title: "Crons + 自定义 Skill",
          body: "定时任务 + 自己写的 TypeScript skill，把 agent 接进你已有的工作流。",
        },
      ],
    },
    pricing: {
      title: "定价",
      subtitle: "免费起步，按需升级。永远可以自托管。",
      tiers: [
        {
          name: "免费版",
          price: "¥0",
          period: "永久",
          features: [
            "100 注册积分",
            "每日 100k tokens 免费额度",
            "全部聊天渠道",
            "全部 LLM provider",
            "技能市场",
          ],
          cta: "立即下载",
          highlight: false,
        },
        {
          name: "Pro 订阅",
          price: "¥39",
          period: "/月",
          features: [
            "包含免费版全部",
            "更高每月 token 额度",
            "Premium 模型可用",
            "优先支持",
          ],
          cta: "升级 Pro",
          highlight: true,
        },
        {
          name: "自托管",
          price: "¥0",
          period: "永久",
          features: [
            "自己填 API key",
            "完全本地运行",
            "无积分系统依赖",
            "MIT License",
          ],
          cta: "查看 GitHub",
          highlight: false,
        },
      ],
    },
    trust: {
      title: "开源 · 透明 · 你拥有数据",
      body: "DlxAI 完全开源。数据存储在本地机器，密钥由系统钥匙串保护，永不上传。",
      ctaDocs: "阅读文档",
      ctaGithub: "GitHub",
    },
    footer: {
      tagline: "你的 AI 助理，住在你所有的聊天 App 里。",
      sections: [
        {
          title: "产品",
          links: [
            { label: "功能", href: "#features" },
            { label: "定价", href: "#pricing" },
            { label: "下载", href: "#download" },
          ],
        },
        {
          title: "资源",
          links: [
            { label: "文档", href: "/docs/" },
            { label: "GitHub", href: "https://github.com/nicepkg/dlxai" },
            { label: "Discord", href: "#" },
          ],
        },
        {
          title: "公司",
          links: [
            { label: "关于", href: "#" },
            { label: "隐私", href: "#" },
            { label: "条款", href: "#" },
          ],
        },
      ],
      copyright: "© 2026 DlxAI. 保留所有权利。",
    },
  },

  en: {
    nav: {
      features: "Features",
      useCases: "Use cases",
      pricing: "Pricing",
      docs: "Docs",
      github: "GitHub",
      download: "Download",
      langSwitch: "中文",
    },
    hero: {
      eyebrow: "Local-first · Personal AI",
      title: "Your AI assistant, living inside every chat app you already use",
      subtitle:
        "Install once. Reach it from Telegram, Discord, Slack, Lark, iMessage and more. Runs locally. Rules in plain English. Free credits out of the box.",
      ctaPrimary: "Download",
      ctaSecondary: "View on GitHub",
      platformLine: "Mac · Windows · Linux",
    },
    why: {
      title: "Why DlxAI?",
      subtitle: "Nothing else on the market is positioned quite like this.",
      cards: [
        {
          title: "Unlike Jan / Msty",
          body: "It comes to you. Sends and receives messages on the chat apps you already live in — you don't need to open another app.",
        },
        {
          title: "Unlike Botpress / Voiceflow",
          body: "It's yours, not your customers'. A personal AI that follows your identity and preferences. No visual flow editor required.",
        },
        {
          title: "Unlike n8n / Make",
          body: "You don't draw flowcharts. Write a single sentence — it compiles into policies and skills, and takes effect immediately.",
        },
      ],
    },
    features: {
      title: "Core features",
      subtitle: "An AI agent cockpit designed for people who don't write code.",
      items: [
        {
          icon: "💬",
          title: "13+ chat platforms",
          body: "Telegram, Discord, Slack, Lark/Feishu, iMessage, LINE, Matrix, Mattermost, WeCom and more. One agent, all of them.",
        },
        {
          icon: "📝",
          title: "Natural language rules",
          body: "Write a sentence. It compiles into a policy, guard, or skill. Hot-reloads on save — no restart needed.",
        },
        {
          icon: "🧠",
          title: "20+ LLM providers",
          body: "OpenAI, Anthropic, Gemini, DeepSeek, Kimi, Qwen, Groq, Mistral, xAI, local Ollama… switch freely.",
        },
        {
          icon: "🛒",
          title: "Skills marketplace",
          body: "Browse, search, install community skills with one click. Or publish your own.",
        },
        {
          icon: "🔒",
          title: "Local-first & private",
          body: "All data stays on your machine. Secrets sealed in macOS Keychain / Windows DPAPI — never plaintext.",
        },
        {
          icon: "⚡",
          title: "Zero-restart hot reload",
          body: "Change keys, proxies, channels, rules — everything applies instantly without restarting the gateway.",
        },
      ],
    },
    how: {
      title: "Three steps to start chatting",
      steps: [
        {
          n: "1",
          title: "Install",
          body: "One-click installer for Mac / Windows / Linux. Lives in your system tray.",
        },
        {
          n: "2",
          title: "Connect chat apps",
          body: "Tick the platforms you use, paste tokens or scan a QR. Done in under a minute.",
        },
        {
          n: "3",
          title: "Tell it in plain words",
          body: "\"Every morning at 9, summarise yesterday's customer messages and send to me.\" Done.",
        },
      ],
    },
    useCases: {
      title: "Who's using it",
      items: [
        {
          tag: "Personal",
          title: "Your second brain",
          body: "Reminders, knowledge Q&A, web summaries, long-term memory — summon it from Telegram anytime.",
        },
        {
          tag: "Small business",
          title: "Reply customers in WeChat / Lark",
          body: "Triage messages, draft replies, follow up orders. Stop staring at your phone all day.",
        },
        {
          tag: "Cross-border",
          title: "One agent across all channels",
          body: "Telegram + WhatsApp + LINE + Slack share the same context. Never miss a lead, wherever they message.",
        },
        {
          tag: "Developers",
          title: "Crons + custom skills",
          body: "Schedule jobs, write your own TypeScript skills, plug the agent into existing workflows.",
        },
      ],
    },
    pricing: {
      title: "Pricing",
      subtitle: "Free to start. Upgrade as you go. Self-host forever, free.",
      tiers: [
        {
          name: "Free",
          price: "$0",
          period: "forever",
          features: [
            "100 sign-up credits",
            "100k free tokens / day",
            "All chat channels",
            "All LLM providers",
            "Skills marketplace",
          ],
          cta: "Download",
          highlight: false,
        },
        {
          name: "Pro",
          price: "$5",
          period: "/month",
          features: [
            "Everything in Free",
            "Higher monthly token quota",
            "Premium models unlocked",
            "Priority support",
          ],
          cta: "Upgrade",
          highlight: true,
        },
        {
          name: "Self-host",
          price: "$0",
          period: "forever",
          features: [
            "Bring your own API keys",
            "Fully local execution",
            "No credits backend",
            "MIT License",
          ],
          cta: "GitHub",
          highlight: false,
        },
      ],
    },
    trust: {
      title: "Open source · Transparent · You own your data",
      body: "DlxAI is fully open source. Data stays on your machine. Secrets are sealed by your OS keychain. Never uploaded.",
      ctaDocs: "Read the docs",
      ctaGithub: "GitHub",
    },
    footer: {
      tagline: "Your AI assistant, living inside every chat app you already use.",
      sections: [
        {
          title: "Product",
          links: [
            { label: "Features", href: "#features" },
            { label: "Pricing", href: "#pricing" },
            { label: "Download", href: "#download" },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "Docs", href: "/en/docs/" },
            { label: "GitHub", href: "https://github.com/nicepkg/dlxai" },
            { label: "Discord", href: "#" },
          ],
        },
        {
          title: "Company",
          links: [
            { label: "About", href: "#" },
            { label: "Privacy", href: "#" },
            { label: "Terms", href: "#" },
          ],
        },
      ],
      copyright: "© 2026 DlxAI. All rights reserved.",
    },
  },
} as const;

export function t(lang: Lang) {
  return strings[lang];
}

/** Build a localized URL: t='/' + en → '/en/', zh → '/' */
export function localizedUrl(lang: Lang, path: string = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (lang === "zh") return clean;
  return `/en${clean === "/" ? "/" : clean}`;
}
