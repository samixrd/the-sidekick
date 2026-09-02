import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ink / surfaces — near-black editorial palette
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        "surface-raised": "var(--color-surface-raised)",
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        foreground: "var(--color-foreground)",
        muted: "var(--color-muted)",
        faint: "var(--color-faint)",

        // One restrained accent — brass/amber. Everything else is neutral.
        accent: "var(--color-accent)",
        "accent-strong": "var(--color-accent-strong)",
        "accent-faint": "var(--color-accent-faint)",
        "on-accent": "var(--color-on-accent)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      // Subtle motion only — institutional restraint, no bounce.
      transitionTimingFunction: {
        calm: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.4s var(--tw-ease, cubic-bezier(0.4,0,0.2,1)) both",
      },
    },
  },
  plugins: [],
};

export default config;
