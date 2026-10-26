import type { ProviderPreset, QuickMode, StarterPrompt } from "./types";

// Kilo's OpenAI-compatible gateway. `api.kilocode.ai` is the marketing site
// (its /v1/* paths 404 with an HTML page), so the API lives on its own host.
export const KILO_DEFAULT_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "kilo",
    label: "Kilo Code AI Gateway",
    baseUrl: KILO_DEFAULT_BASE_URL,
    defaultModelId: "google/gemini-2.5-flash",
    models: [
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "kilo-auto/free",
      "kilo-auto/efficient",
      "anthropic/claude-sonnet-5.5",
      "anthropic/claude-haiku-5.5",
      "openai/gpt-6.1-sol",
      "openai/gpt-4o-mini",
      "deepseek/deepseek-v4.1-flash",
    ],
    supportsEmbeddings: true,
    keyHint: "Kilo Code API key (kilo.ai)",
  },
  {
    id: "custom",
    label: "Custom OpenAI-Compatible Endpoint",
    baseUrl: "http://localhost:11434/v1",
    defaultModelId: "llama3.1",
    models: ["llama3.1", "qwen2.5", "mistral", "gpt-4o-mini", "deepseek-r1"],
    supportsEmbeddings: true,
    keyHint: "Any API key your endpoint expects (may be empty)",
  },
  {
    id: "gemini",
    label: "Google Gemini Direct",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModelId: "gemini-2.5-pro",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
    ],
    supportsEmbeddings: false,
    keyHint: "Google AI Studio API key (aistudio.google.com)",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModelId: "llama-3.3-70b-versatile",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "qwen/qwen3-32b",
    ],
    supportsEmbeddings: false,
    keyHint: "Groq API key (console.groq.com)",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModelId: "anthropic/claude-3.7-sonnet",
    models: [
      "anthropic/claude-3.7-sonnet",
      "google/gemini-2.5-pro",
      "openai/gpt-4o",
      "deepseek/deepseek-r1",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    supportsEmbeddings: true,
    keyHint: "OpenRouter API key (openrouter.ai)",
  },
];

export function getProviderPreset(id: string): ProviderPreset {
  return (
    PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0]
  );
}

/** Model ids that the app offers when the user has not configured anything. */
export const DEFAULT_SAVED_MODEL_IDS: string[] = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "kilo-auto/free",
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-4o-mini",
  "deepseek/deepseek-v4.1-flash",
];

export const DEFAULT_SYSTEM_PROMPT = `You are Sloth, a precise and discreet AI workspace assistant.

When knowledge from a Space is provided, ground your answer in it. Cite the source document by name in square brackets, for example [Brokerage-Handbook.pdf]. If the provided context does not answer the question, say so plainly and answer from general knowledge instead of inventing sources.

Prefer precise, well-structured answers. Use Markdown for headings, lists, tables and fenced code blocks. Keep prose tight and skimmable. Never fabricate citations.

You cannot create, attach or send files: never output download links, "sandbox:" paths or file attachments. When the user asks for a document or a deck, put the full content in your reply as Markdown instead.`;

export const QUICK_MODES: QuickMode[] = [
  {
    id: "research",
    label: "Research",
    icon: "✨",
    prompt:
      "Research this topic deeply. Compare options, cite the Space documents I gave you, and end with a short list of concrete recommendations.",
  },
  {
    id: "document",
    label: "Document",
    icon: "📄",
    prompt:
      "Turn the material in my Space into a polished document. Structure it with a title, sections, and bullet points.",
  },
  {
    id: "presentation",
    label: "Presentation",
    icon: "📊",
    prompt:
      "Build a presentation outline from my Space content: a title slide, one slide per idea with speaker notes, and a closing summary.",
  },
  {
    id: "visual",
    label: "Visual",
    icon: "🖼️",
    prompt:
      "Describe the data in my Space visually - suggest chart types, axis labels, a colour palette, and the key takeaway for each visual.",
  },
];

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: "research-brief",
    title: "Research brief",
    description: "Synthesise a Space into an executive brief",
    icon: "✨",
    prompt:
      "Summarise everything in the selected Space into a one-page executive brief: key findings, risks, and recommended actions.",
    category: "research",
  },
  {
    id: "compare-approaches",
    title: "Compare approaches",
    description: "Build a decision table",
    icon: "⚖️",
    prompt:
      "Compare the distinct approaches described in the selected Space. Return a Markdown table with criteria, pros, cons and a recommendation.",
    category: "research",
  },
  {
    id: "summarise-doc",
    title: "Summarise a document",
    description: "Extract the arguments that matter",
    icon: "📄",
    prompt:
      "Summarise the most important document in the selected Space: its thesis, its strongest evidence, and what a skeptic would challenge.",
    category: "document",
  },
  {
    id: "deck-outline",
    title: "Presentation outline",
    description: "Turn notes into slides",
    icon: "📊",
    prompt:
      "Turn the content in the selected Space into a presentation outline with a title slide, 5-7 content slides, speaker notes, and a closing slide.",
    category: "presentation",
  },
  {
    id: "chart-plan",
    title: "Chart plan",
    description: "Design the right visualisation",
    icon: "🖼️",
    prompt:
      "Propose three visualisations for the data in the selected Space. For each: chart type, x/y axes, series, colour, and the single insight it communicates.",
    category: "visual",
  },
  {
    id: "knowledge-gaps",
    title: "Find knowledge gaps",
    description: "See what the Space is missing",
    icon: "🔍",
    prompt:
      "Audit the selected Space: what questions can it answer confidently, what is ambiguous, and what documents are missing?",
    category: "general",
  },
];

export const ACCEPTED_FILE_EXTENSIONS = [".pdf", ".txt", ".md", ".csv", ".json"];

export const EMBEDDING_MODEL_CANDIDATES = [
  "text-embedding-3-small",
  "text-embedding-004",
  "embedding-001",
];

export const MAX_CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 150;
