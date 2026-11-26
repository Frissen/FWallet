import { useEffect, useState } from 'react'
import {
  listEntries,
  removeEntry,
  upsertEntry,
  type AddressEntry,
} from '../lib/addressBook'

const EMOJI_OPTIONS = ['👤', '👥', '🎁', '💼', '🏦', '🛒', '🍕', '🎮', '⭐', '❤️']

export function AddressBookCard() {
  const [entries, setEntries] = useState<AddressEntry[]>(() => listEntries())
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')
  const [emoji, setEmoji] = useState('👤')

  useEffect(() => {
    const onStorage = () => setEntries(listEntries())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function add() {
    if (!name.trim() || !addr.trim()) return
    upsertEntry(addr.trim(), name.trim(), emoji)
    setEntries(listEntries())
    setName('')
    setAddr('')
    setEmoji('👤')
    setAdding(false)
  }

  function remove(a: string) {
    removeEntry(a)
    setEntries(listEntries())
  }

  return (
    <div className="bg-ton-card border border-ton-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold">Адресная книга</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[11px] text-ton-primary font-medium"
        >
          {adding ? 'Отмена' : '+ Добавить'}
        </button>
      </div>
      <p className="text-xs text-ton-muted mb-3">
        Сохраняй адреса с именами — выбирай их в один тап при отправке.
      </p>

      {adding && (
        <div className="mb-3 bg-ton-dark border border-ton-border rounded-xl p-3 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя (например: Мама)"
            className="w-full bg-ton-card border border-ton-border rounded-lg px-3 py-2 text-sm placeholder-ton-muted"
          />
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="UQ... или EQ..."
            spellCheck={false}
            className="w-full bg-ton-card border border-ton-border rounded-lg px-3 py-2 text-sm font-mono placeholder-ton-muted"
          />
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_OPTIONS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-8 h-8 rounded-lg text-lg ${
                  emoji === e
                    ? 'bg-ton-primary/20 ring-1 ring-ton-primary'
                    : 'bg-ton-card border border-ton-border'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <button
            onClick={add}
            disabled={!name.trim() || !addr.trim()}
            className="w-full fw-cta-primary rounded-xl py-2 text-sm font-semibold disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      )}

      {entries.length === 0 && !adding && (
        <div className="text-xs text-ton-muted py-3 text-center">
          Пока пусто. Добавь первый контакт.
        </div>
      )}

      <ul className="divide-y divide-ton-border -mx-1">
        {entries.map((e) => (
          <li key={e.address} className="flex items-center gap-3 py-2.5 px-1">
            <span
              className="w-9 h-9 rounded-full bg-ton-dark border border-ton-border flex items-center justify-center text-lg shrink-0"
              aria-hidden
            >
              {e.emoji ?? '👤'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{e.name}</div>
              <div className="text-[11px] text-ton-muted truncate font-mono">
                {e.address.slice(0, 6)}…{e.address.slice(-6)}
              </div>
            </div>
            {e.count > 0 && (
              <span className="text-[10px] text-ton-muted shrink-0">
                {e.count}×
              </span>
            )}
            <button
              onClick={() => remove(e.address)}
              className="text-rose-400/80 hover:text-rose-400 text-xs shrink-0"
              title="Удалить"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
