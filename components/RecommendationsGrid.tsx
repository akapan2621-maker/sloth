"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

import { STARTER_PROMPTS } from "@/lib/constants";
import type { StarterPrompt } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RecommendationsGridProps {
  onSelect: (prompt: StarterPrompt) => void;
  visible: boolean;
}

export function RecommendationsGrid({ onSelect, visible }: RecommendationsGridProps) {
  const [browsing, setBrowsing] = useState(false);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-gradient-to-tr from-purple-50 via-pink-50 to-indigo-50 px-3 py-1.5 text-[12px] font-semibold text-purple-700">
              <Sparkles className="h-3.5 w-3.5" />
              Get recommended samples
            </span>
            <button
              type="button"
              onClick={() => setBrowsing((value) => !value)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition hover:text-slate-900"
            >
              Browse
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  browsing && "rotate-90",
                )}
              />
            </button>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(browsing ? STARTER_PROMPTS : STARTER_PROMPTS.slice(0, 3)).map(
              (prompt, index) => (
                <motion.button
                  key={prompt.id}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: index * 0.04 }}
                  onClick={() => onSelect(prompt)}
                  className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-purple-200 hover:shadow-lift"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-[15px] transition group-hover:bg-purple-50">
                    {prompt.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-800">
                      {prompt.title}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-4 text-slate-500">
                      {prompt.description}
                    </span>
                  </span>
                </motion.button>
              ),
            )}
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

export default RecommendationsGrid;
