import type { ReactElement } from 'react'

export type TabKey = 'home' | 'p2p' | 'swap' | 'more'

interface Props {
  active: TabKey
  onChange: (tab: TabKey) => void
}

const TABS: { key: TabKey; label: string; icon: ReactElement }[] = [
  {
    key: 'home',
    label: 'Кошелёк',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-6 h-6"
        aria-hidden="true"
      >
        <path
          d="M3 8.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3V9h-3.5a2.5 2.5 0 0 0 0 5H21v1.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7Z"
          fill="currentColor"
        />
        <circle cx="17.5" cy="11.5" r="1.2" fill="var(--ton-dark)" />
      </svg>
    ),
  },
  {
    key: 'p2p',
    label: 'P2P',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-6 h-6"
        aria-hidden="true"
      >
        <path
          d="M7 8h10l-2-2.5M17 16H7l2 2.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: 'swap',
    label: 'Обмен',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-6 h-6"
        aria-hidden="true"
      >
        <path
          d="M5 9h12l-3-3M19 15H7l3 3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: 'more',
    label: 'Ещё',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="w-6 h-6"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="6" height="6" rx="1.5" fill="currentColor" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" fill="currentColor" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" fill="currentColor" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" fill="currentColor" />
      </svg>
    ),
  },
]

export function TabBar({ active, onChange }: Props) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pointer-events-none">
      <div className="max-w-md mx-auto pointer-events-auto fw-card-soft shadow-lg">
        <div className="grid grid-cols-4 px-1.5 py-1.5">
          {TABS.map((tab) => {
            const isActive = active === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => onChange(tab.key)}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition active:scale-[0.96] ${
                  isActive
                    ? 'text-ton-primary bg-ton-primary/10 fw-ring-accent'
                    : 'text-ton-muted hover:text-white'
                }`}
              >
                <span className="leading-none">{tab.icon}</span>
                <span className="text-[11px] font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
