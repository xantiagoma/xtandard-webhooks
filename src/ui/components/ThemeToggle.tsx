import React, { useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { getThemePref, setThemePref, type ThemePref } from "../theme.ts";
import { cn } from "../lib/utils.ts";

const OPTIONS: { value: ThemePref; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());

  const choose = (value: ThemePref) => {
    setPref(value);
    setThemePref(value);
  };

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => choose(value)}
            className={cn(
              "inline-flex h-6 w-7 items-center justify-center rounded-[5px] outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
