"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  FileStack,
  Gauge,
  GraduationCap,
  ListChecks,
  Presentation,
  ScrollText,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { useWorkspace } from "@/context/WorkspaceContext";

interface SecondaryViewsProps {
  onGoToChat: () => void;
}

interface AgentPreset {
  id: string;
  name: string;
  icon: typeof Sparkles;
  accent: string;
  summary: string;
  systemPrompt: string;
  starter: string;
}

const AGENTS: AgentPreset[] = [
  {
    id: "researcher",
    name: "Researcher",
    icon: GraduationCap,
    accent: "from-purple-600 via-pink-500 to-indigo-600",
    summary: "Cited, multi-source research with explicit confidence levels.",
    systemPrompt:
      "You are a rigorous research analyst. Work from the provided Space excerpts, cite the source document by name for every factual claim, distinguish evidence from inference, and finish with a confidence statement.",
    starter:
      "Research the material in the selected Space and produce a cited brief with findings, open questions, and confidence levels.",
  },
  {
    id: "analyst",
    name: "Document Analyst",
    icon: FileStack,
    accent: "from-sky-500 via-blue-600 to-indigo-600",
    summary: "Pulls structured facts, figures and dates out of documents.",
    systemPrompt:
      "You are a document analyst. Extract facts, figures, dates and named entities into tight tables. Never paraphrase away precision — keep units and qualifiers exactly as written, and flag anything ambiguous.",
    starter:
      "Extract the key facts, figures and dates from the selected Space into a structured table.",
  },
  {
    id: "editor",
    name: "Editor",
    icon: ScrollText,
    accent: "from-emerald-500 via-teal-500 to-cyan-600",
    summary: "Tightens prose without losing meaning or voice.",
    systemPrompt:
      "You are a precise editor. Keep the author's meaning and voice. Cut filler, prefer active voice, preserve every technical term, and return only the edited text plus a short changelog.",
    starter:
      "Edit the draft in the selected Space for clarity and concision, and list what you changed.",
  },
  {
    id: "compliance",
    name: "Risk & Compliance",
    icon: ShieldAlert,
    accent: "from-amber-500 via-orange-500 to-rose-500",
    summary: "ISO 27001-style control gap analysis.",
    systemPrompt:
      "You are an ISO 27001 and IT audit reviewer. Map the evidence in the Space to control objectives, state whether each control is satisfied, partially met or missing, and always propose a concrete remediation with an owner and due date.",
    starter:
      "Run a control gap analysis against the selected Space and produce a remediation table.",
  },
  {
    id: "market",
    name: "Market Analyst",
    icon: TrendingUp,
    accent: "from-fuchsia-500 via-purple-600 to-violet-700",
    summary: "Price action, risk and execution for XAUUSD-style markets.",
    systemPrompt:
      "You are a discretionary market analyst covering XAUUSD and MT5 automation. Discuss levels, liquidity, invalidation and risk sizing. Never present a forecast as certainty, and always state the invalidation level of a view.",
    starter:
      "Summarise the current market structure, levels and invalidations from the selected Space.",
  },
  {
    id: "dashboards",
    name: "Dashboard Designer",
    icon: BarChart3,
    accent: "from-teal-500 via-cyan-500 to-sky-500",
    summary: "Turns numbers into charts, dashboards and metric trees.",
    systemPrompt:
      "You are a dashboard designer. For every metric you propose, give the chart type, axes, series, colour and the single decision it supports. Prefer fewer, sharper visuals over many shallow ones.",
    starter:
      "Design a dashboard for the data in the selected Space: metrics, chart types, and the decisions each one drives.",
  },
];

interface AppTemplate {
  id: string;
  name: string;
  icon: typeof Sparkles;
  description: string;
  prompt: string;
}

const APPS: AppTemplate[] = [
  {
    id: "briefing",
    name: "Daily Briefing",
    icon: Gauge,
    description: "Three bullets, one risk, one action.",
    prompt:
      "Write a daily briefing from the selected Space: three most important updates, the biggest open risk, and one concrete action for today.",
  },
  {
    id: "deck",
    name: "Slide Deck",
    icon: Presentation,
    description: "Title, slides, speaker notes, close.",
    prompt:
      "Turn the selected Space into a presentation: a title slide, one slide per idea with a headline and two bullets, speaker notes for each slide, and a closing summary slide.",
  },
  {
    id: "checklist",
    name: "Document → Checklist",
    icon: ListChecks,
    description: "Turn policy text into actions.",
    prompt:
      "Convert the selected Space into an actionable checklist grouped by owner, with a priority and an estimated effort for each item.",
  },
  {
    id: "audit",
    name: "Audit Notes",
    icon: ClipboardCheck,
    description: "Findings, evidence, remediation.",
    prompt:
      "Turn the selected Space into audit-ready notes: findings, supporting evidence references, gaps, and remediation actions with owners and due dates.",
  },
  {
    id: "compare",
    name: "Comparison Table",
    icon: FileStack,
    description: "Side-by-side with a recommendation.",
    prompt:
      "Compare the distinct options described in the selected Space in a Markdown table (criteria, strengths, weaknesses, cost, risk) and finish with a clear recommendation.",
  },
  {
    id: "onepager",
    name: "Executive One-Pager",
    icon: ScrollText,
    description: "Single page, zero fluff.",
    prompt:
      "Write a single-page executive summary of the selected Space: the situation, what matters, what to do, and what to watch. No filler.",
  },
];

const RESEARCH_TEMPLATES: AppTemplate[] = [
  {
    id: "scan",
    name: "Literature Scan",
    icon: GraduationCap,
    description: "Map what the Space says on a topic.",
    prompt:
      "Scan the selected Space for everything related to my question. Group the material by theme, cite each document, and mark clearly what is not covered.",
  },
  {
    id: "structure",
    name: "Market Structure Review",
    icon: TrendingUp,
    description: "Levels, liquidity, invalidation.",
    prompt:
      "Review the market structure material in the selected Space: current levels, liquidity pockets, invalidation conditions and the risk per idea.",
  },
  {
    id: "gap",
    name: "Policy Gap Analysis",
    icon: ShieldAlert,
    description: "What the Space does not cover.",
    prompt:
      "Audit the selected Space for policy and control gaps. For each gap: why it matters, the evidence that is missing, and a concrete remediation.",
  },
];

/* -------------------------------------------------------------------------- */

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Sparkles;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <h1 className="text-2xl font-light tracking-tight text-slate-800">
          {title}
        </h1>
      </div>
      <p className="mt-1.5 text-[13px] text-slate-500">{subtitle}</p>
    </header>
  );
}

/* -------------------------------------------------------------------------- */

export function AgentsView({ onGoToChat }: SecondaryViewsProps) {
  const { newChat, setPendingPrompt, updateSettings, settings } = useWorkspace();

  const start = (agent: AgentPreset) => {
    updateSettings({ systemPrompt: agent.systemPrompt });
    newChat();
    setPendingPrompt(agent.starter);
    onGoToChat();
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <SectionHeader
        icon={Sparkles}
        title="Chat agents"
        subtitle="Specialised personas that set a system prompt for the conversation."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent, index) => (
          <motion.button
            key={agent.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.04 }}
            onClick={() => start(agent)}
            className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-lift"
          >
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr ${agent.accent} text-white shadow-soft`}
            >
              <agent.icon className="h-5 w-5" />
            </span>
            <span className="mt-3 text-[14px] font-semibold text-slate-900">
              {agent.name}
            </span>
            <span className="mt-1 text-[12.5px] leading-5 text-slate-500">
              {agent.summary}
            </span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-purple-600 opacity-0 transition group-hover:opacity-100">
              Start chat
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </motion.button>
        ))}
      </div>

      <p className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12.5px] text-slate-500">
        Starting an agent replaces your system prompt override. The active
        prompt is{" "}
        <span className="font-mono text-[11.5px] text-slate-700">
          {settings.systemPrompt.slice(0, 64)}…
        </span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function AppsView({ onGoToChat }: SecondaryViewsProps) {
  const { newChat, setPendingPrompt } = useWorkspace();

  const start = (app: AppTemplate) => {
    newChat();
    setPendingPrompt(app.prompt);
    onGoToChat();
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <SectionHeader
        icon={Gauge}
        title="Apps"
        subtitle="One-click workflows that pre-fill a structured prompt."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((app, index) => (
          <motion.button
            key={app.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.04 }}
            onClick={() => start(app)}
            className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-lift"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-gradient-to-tr group-hover:from-purple-600 group-hover:via-pink-500 group-hover:to-indigo-600 group-hover:text-white">
              <app.icon className="h-5 w-5" />
            </span>
            <span className="mt-3 text-[14px] font-semibold text-slate-900">
              {app.name}
            </span>
            <span className="mt-1 text-[12.5px] leading-5 text-slate-500">
              {app.description}
            </span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-purple-600 opacity-0 transition group-hover:opacity-100">
              Run
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function ResearchView({ onGoToChat }: SecondaryViewsProps) {
  const { newChat, setPendingPrompt, chats } = useWorkspace();

  const start = (template: AppTemplate) => {
    newChat();
    setPendingPrompt(template.prompt);
    onGoToChat();
  };

  const researchChats = chats.filter((chat) =>
    chat.messages.some((message) =>
      /research|scan|gap analysis|review/i.test(message.content),
    ),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <SectionHeader
        icon={GraduationCap}
        title="Research"
        subtitle="Start a grounded research run against your Spaces."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {RESEARCH_TEMPLATES.map((template, index) => (
          <motion.button
            key={template.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.04 }}
            onClick={() => start(template)}
            className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-lift"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-600 text-white shadow-soft">
              <template.icon className="h-5 w-5" />
            </span>
            <span className="mt-3 text-[14px] font-semibold text-slate-900">
              {template.name}
            </span>
            <span className="mt-1 text-[12.5px] leading-5 text-slate-500">
              {template.description}
            </span>
          </motion.button>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Recent research runs
        </h2>
        {researchChats.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-[13px] text-slate-400">
            No research runs yet. Pick a template above to start one.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
            {researchChats.slice(0, 8).map((chat) => (
              <li
                key={chat.id}
                className="border-b border-slate-100 px-4 py-3 last:border-0"
              >
                <p className="truncate text-[13px] font-medium text-slate-800">
                  {chat.title}
                </p>
                <p className="mt-0.5 text-[11.5px] text-slate-400">
                  {chat.messages.length} message
                  {chat.messages.length === 1 ? "" : "s"} ·{" "}
                  {chat.modelId}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
