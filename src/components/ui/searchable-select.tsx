"use client";

import type { ReactNode } from "react";
import { useId, useMemo, useRef, useState } from "react";

import { filterSelectOptions, nextActiveOptionIndex, type SelectOption } from "./data-entry-state";

export function SearchableSelect({
  label,
  name,
  options,
  value,
  onValueChange,
  placeholder = "Search and select",
  required = true,
  disabled = false,
  quickCreate,
}: {
  label: string;
  name: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  quickCreate?: ReactNode;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.label ?? "");
  const [activeIndex, setActiveIndex] = useState(-1);
  const filtered = useMemo(() => filterSelectOptions(options, query), [options, query]);

  function choose(option: SelectOption) {
    onValueChange(option.value);
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return (
    <div className="relative min-w-0 text-sm font-medium">
      <div className="flex items-end justify-between gap-2">
        <label htmlFor={`${id}-input`}>{label}</label>
        {quickCreate}
      </div>
      <input name={name} type="hidden" value={value} />
      <input
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-required={required}
        autoComplete="off"
        className="mt-1 min-h-11 w-full rounded-lg border border-[var(--control-border)] bg-white px-3"
        disabled={disabled}
        id={`${id}-input`}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
          if (value) onValueChange("");
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onKeyDown={(event) => {
          const direction =
            event.key === "ArrowDown"
              ? "next"
              : event.key === "ArrowUp"
                ? "previous"
                : event.key === "Home"
                  ? "first"
                  : event.key === "End"
                    ? "last"
                    : null;
          if (direction) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => nextActiveOptionIndex(current, direction, filtered.length));
          } else if (event.key === "Enter" && open && activeIndex >= 0) {
            event.preventDefault();
            const option = filtered[activeIndex];
            if (option) choose(option);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setQuery(selected?.label ?? "");
            setActiveIndex(-1);
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
        required={required}
        role="combobox"
        value={open ? query : (selected?.label ?? "")}
      />
      {open ? (
        <div
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[var(--control-border)] bg-white p-1 shadow-lg"
          id={`${id}-listbox`}
          role="listbox"
        >
          {!required && value ? (
            <button
              className="min-h-11 w-full rounded-md px-3 text-left text-[var(--muted)] hover:bg-[var(--surface)]"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose({ value: "", label: "" })}
              type="button"
            >
              Clear selection
            </button>
          ) : null}
          {filtered.length ? (
            filtered.map((option, index) => (
              <button
                aria-selected={option.value === value}
                className={`min-h-11 w-full rounded-md px-3 text-left hover:bg-[var(--accent-soft)] ${
                  index === activeIndex ? "bg-[var(--accent-soft)]" : ""
                }`}
                id={`${id}-option-${index}`}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                role="option"
                type="button"
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-[var(--muted)]">No matching options</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
