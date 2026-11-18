import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our named tokens (styles.css, section 2) must be known to tailwind-merge, otherwise it
// reads e.g. `text-body` as a colour or `shadow-pill` as a shadow colour and drops the
// wrong class. Every new named token in @theme is added here in the same change.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "micro",
        "meta",
        "list",
        "body",
        "section",
        "title",
        "page",
        "display",
        "hero",
        // Legacy scale only (alias layer, removed).
        "lead",
      ],
      radius: ["pill"],
      shadow: ["card", "raised", "overlay", "pill"],
      tracking: ["display", "title"],
      ease: ["standard"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
