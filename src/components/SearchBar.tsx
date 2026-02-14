"use client";

type Chip = { label: string; apply: () => void; active?: boolean; variant?: "default" | "spotlight" | "vintage" | "cannes" };

export default function SearchBar({
  value,
  onChange,
  onClear,
  quickChips
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  quickChips: Chip[];
}) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-soft backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1">
          <label className="sr-only">Search</label>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search brands, titles, agencies… e.g., “airline”, “Etihad”, “women’s rights”, “integrated”"
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-0 focus:border-black/20"
          />
        </div>
        <button
          onClick={onClear}
          className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-black/5 active:translate-y-0 active:scale-[0.98]"
          title="Reset search + filters"
        >
          Reset
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {quickChips.map((c) => (
          (() => {
            const isSpotlight = c.variant === "spotlight";
            const isVintage = c.variant === "vintage";
            const isCannes = c.variant === "cannes";
            const style = isSpotlight
              ? c.active
                ? {
                    background: "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
                    color: "#ffffff",
                    boxShadow: "0 0 0 1px rgba(37,99,235,0.52), 0 0 26px rgba(59,130,246,0.65)"
                  }
                : {
                    background: "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)",
                    color: "#1d4ed8",
                    boxShadow: "0 0 0 1px rgba(37,99,235,0.28), 0 0 14px rgba(59,130,246,0.35)"
                  }
              : isVintage
                ? c.active
                  ? {
                      background: "linear-gradient(135deg, #111827 0%, #030712 100%)",
                      color: "#ffffff",
                      boxShadow: "0 0 0 1px rgba(17,24,39,0.55), 0 0 22px rgba(15,23,42,0.6)"
                    }
                  : {
                      background: "linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)",
                      color: "#111827",
                      boxShadow: "0 0 0 1px rgba(17,24,39,0.24), 0 0 12px rgba(15,23,42,0.28)"
                    }
                : isCannes
                  ? c.active
                    ? {
                        background: "linear-gradient(135deg, #b91c1c 0%, #ef4444 100%)",
                        color: "#ffffff",
                        boxShadow: "0 0 0 1px rgba(220,38,38,0.55), 0 0 24px rgba(239,68,68,0.6)"
                      }
                    : {
                        background: "linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)",
                        color: "#991b1b",
                        boxShadow: "0 0 0 1px rgba(220,38,38,0.28), 0 0 14px rgba(239,68,68,0.35)"
                      }
                  : undefined;

            return (
              <button
                key={c.label}
                onClick={c.apply}
                style={style}
                className={`rounded-full px-3 py-1.5 text-xs transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${
                  isSpotlight
                    ? c.active
                      ? "animate-[chipGlow_1.8s_ease-in-out_infinite] scale-[1.02]"
                      : "hover:brightness-[1.03]"
                    : isVintage
                      ? c.active
                        ? "animate-[chipGlowDark_1.9s_ease-in-out_infinite] scale-[1.02]"
                        : "hover:brightness-[1.03]"
                    : isCannes
                      ? c.active
                        ? "animate-[chipGlowRed_1.8s_ease-in-out_infinite] scale-[1.02]"
                        : "hover:brightness-[1.03]"
                    : c.active
                      ? "bg-blue-600 text-white shadow-[0_0_0_1px_rgba(37,99,235,0.35),0_0_18px_rgba(59,130,246,0.45)] animate-[chipGlow_1.8s_ease-in-out_infinite]"
                      : "bg-black/5 text-black hover:bg-black/10"
                }`}
              >
                {c.label}
              </button>
            );
          })()
        ))}
      </div>
      <style jsx>{`
        @keyframes chipGlow {
          0% {
            box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35), 0 0 12px rgba(59, 130, 246, 0.35);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.5), 0 0 24px rgba(59, 130, 246, 0.6);
          }
          100% {
            box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35), 0 0 12px rgba(59, 130, 246, 0.35);
          }
        }
        @keyframes chipGlowDark {
          0% {
            box-shadow: 0 0 0 1px rgba(17, 24, 39, 0.35), 0 0 10px rgba(15, 23, 42, 0.32);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(17, 24, 39, 0.55), 0 0 22px rgba(15, 23, 42, 0.55);
          }
          100% {
            box-shadow: 0 0 0 1px rgba(17, 24, 39, 0.35), 0 0 10px rgba(15, 23, 42, 0.32);
          }
        }
        @keyframes chipGlowRed {
          0% {
            box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.35), 0 0 12px rgba(239, 68, 68, 0.35);
          }
          50% {
            box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.55), 0 0 24px rgba(239, 68, 68, 0.6);
          }
          100% {
            box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.35), 0 0 12px rgba(239, 68, 68, 0.35);
          }
        }
      `}</style>
    </div>
  );
}
