'use client';

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  label: string;
  tabs: TabItem[];
  defaultTabId?: string;
}

export function Tabs({ label, tabs, defaultTabId }: TabsProps) {
  const baseId = useId();
  const [activeId, setActiveId] = useState(defaultTabId ?? tabs[0]?.id);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    const next = tabs[nextIndex];
    if (!next) return;
    setActiveId(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-warm-200">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                // Same 44px floor every other control in this system carries.
                // A tab is tapped as often as a button and was 8px shorter
                // than one.
                'min-h-11 px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                selected
                  ? 'border-accent-600 text-accent-700'
                  : // ink-700, not ink-500. globals.css says ink-500 is for
                    // text on warm-50 ONLY and fails on warm-100, which is the
                    // Card background, and records that the rule has already
                    // been broken twice. An unselected tab inside a Card would
                    // have been the third. Nothing renders this component
                    // today, so this was a trap set for whoever used it first
                    // rather than a live failure.
                    'border-transparent text-ink-700 hover:text-ink-950 active:text-ink-950',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== activeId}
          className="pt-4"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
