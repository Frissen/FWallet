import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { type WalletKeys } from '../lib/ton'
import { type MultiChainKeys } from '../lib/wallet'
import { loadVault } from '../lib/storage'
import { clearBiometric } from '../lib/biometric'
import {
  buildReferralLink,
  getMyTgId,
  getStoredReferrerTgId,
} from '../lib/referral'
import {
  cloudAvailable,
  clearVaultFromCloud,
  hasCloudBackup,
  saveVaultToCloud,
  wipeWallet,
} from '../lib/cloudVault'
import { copyText } from '../lib/clipboard'
import {
  APP_NAME,
  BOT_USERNAME,
  COMMISSION_RATES,
} from '../lib/config'
import { BiometricCard } from './BiometricCard'
import { AddressBookCard } from './AddressBookCard'
import { SeedBackup } from './SeedBackup'

interface Props {
  keys: WalletKeys
  all: MultiChainKeys | null
  onLock: () => void
  onForget: () => void
  onOpenCheques: () => void
}

export function SettingsTab({ keys, all, onLock, onForget, onOpenCheques }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const [seedOpen, setSeedOpen] = useState(false)
  const [showPriv, setShowPriv] = useState<string | null>(null)
  const [cloud, setCloud] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const [cloudBusy, setCloudBusy] = useState(false)
  const inTelegram = cloudAvailable()

  useEffect(() => {
    if (!inTelegram) return
    let cancelled = false
    void hasCloudBackup().then((ok) => {
      if (!cancelled) setCloud(ok ? 'yes' : 'no')
    })
    return () => {
      cancelled = true
    }
  }, [inTelegram])

  const myTgId = getMyTgId()
  const referralLink = myTgId ? buildReferralLink(myTgId) : null
  const referrer = getStoredReferrerTgId()

  const copy = (key: string, text: string) => {
    void copyText(text).then((ok) => {
      setCopied(ok ? key : null)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const referralPercent = (COMMISSION_RATES.send.referralBps / 100).toFixed(2)
  const totalPercent = (COMMISSION_RATES.send.totalBps / 100).toFixed(2)

  if (seedOpen) {
    return <SeedBackup mnemonic={keys.mnemonic} onClose={() => setSeedOpen(false)} />
  }

  async function toggleCloud() {
    setCloudBusy(true)
    try {
      if (cloud === 'yes') {
        if (
          confirm(
            'Удалить копию кошелька из облака Telegram? На других устройствах он больше не появится.',
          )
        ) {
          const ok = await clearVaultFromCloud()
          if (ok) setCloud('no')
        }
      } else {
        const v = loadVault()
        if (v && (await saveVaultToCloud(v))) setCloud('yes')
      }
    } finally {
      setCloudBusy(false)
    }
  }

  return (
    <div className="p-5 max-w-md mx-auto pb-24 space-y-4">
      <Card title="Seed-фраза">
        <p className="text-xs text-ton-muted mb-3">
          24 слова для восстановления кошелька. Сохрани их в надёжном месте и
          никому не показывай.
        </p>
        <button
          onClick={() => setSeedOpen(true)}
          className="w-full py-2.5 rounded-xl fw-cta-primary text-sm font-semibold"
        >
          Показать и скопировать
        </button>
      </Card>

      {inTelegram && (
        <Card title="Аккаунт Telegram">
          <p className="text-xs text-ton-muted mb-3">
            {cloud === 'yes'
              ? 'Зашифрованная копия кошелька хранится в облаке Telegram. На другом устройстве с этим аккаунтом достаточно ввести PIN.'
              : cloud === 'no'
                ? 'Кошелёк хранится только на этом устройстве. Сохрани копию в облако Telegram, чтобы открыть его на других устройствах.'
                : 'Проверяем облако Telegram…'}
          </p>
          <p className="text-[11px] text-amber-400 mb-3">
            В облаке лежит только зашифрованный PIN-кодом файл, а не сама
            фраза. Но 6-значный PIN можно подобрать, если файл попадёт в
            чужие руки — не используй простые коды вроде 123456.
          </p>
          <button
            onClick={() => void toggleCloud()}
            disabled={cloud === 'unknown' || cloudBusy}
            className="w-full py-2.5 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border text-sm font-semibold disabled:opacity-50"
          >
            {cloud === 'yes'
              ? 'Удалить копию из облака'
              : 'Сохранить в облако Telegram'}
          </button>
        </Card>
      )}

      <AddressBookCard />

      <Card title="Чеки">
        <p className="text-xs text-ton-muted mb-3">
          Отправь TON по ссылке любому пользователю — получатель забирает на
          свой кошелёк одним кликом. Комиссия 1%.
        </p>
        <button
          onClick={onOpenCheques}
          className="w-full py-2.5 rounded-xl fw-cta-primary text-sm font-semibold"
        >
          Открыть чеки
        </button>
      </Card>

      <Card title="Реферальная программа">
        {!referralLink && (
          <p className="text-xs text-ton-muted">
            Открой кошелёк через{' '}
            <a
              href={`https://t.me/${BOT_USERNAME}`}
              target="_blank"
              rel="noreferrer"
              className="text-ton-primary hover:underline"
            >
              @{BOT_USERNAME}
            </a>{' '}
            — реф-ссылка привязана к твоему Telegram ID.
          </p>
        )}
        {referralLink && (
          <>
            <p className="text-xs text-ton-muted mb-3">
              {referralPercent}% с каждой транзакции приглашённого. Из общей
              комиссии {totalPercent}%. Привязка по Telegram ID, кошельки в
              любой сети.
            </p>
            <div className="bg-white rounded-xl p-3 flex justify-center mb-3">
              <QRCodeSVG value={referralLink} size={160} />
            </div>
            <div className="bg-ton-card border border-ton-border rounded-xl p-3 mb-2">
              <div className="text-xs text-ton-muted mb-1">Твоя реф-ссылка</div>
              <div className="font-mono text-[11px] break-all">{referralLink}</div>
            </div>
            <button
              onClick={() => copy('ref', referralLink)}
              className="w-full py-2.5 rounded-xl fw-cta-primary text-sm font-semibold"
            >
              {copied === 'ref' ? 'Скопировано!' : 'Скопировать ссылку'}
            </button>
          </>
        )}
        {referrer && (
          <p className="text-[11px] text-ton-muted mt-3">
            Тебя пригласил TG ID <span className="font-mono">{referrer}</span>.{' '}
            {referralPercent}% твоих send-комиссий идут ему.
          </p>
        )}
      </Card>

      <Card title="Адреса всех сетей">
        <Row label="TON" value={keys.address} onCopy={() => copy('ton', keys.address)} copied={copied === 'ton'} />
        {all?.evm && (
          <Row label="Ethereum / BNB Smart Chain" value={all.evm.address} onCopy={() => copy('evm', all.evm!.address)} copied={copied === 'evm'} />
        )}
        {all?.sol && (
          <Row label="Solana" value={all.sol.publicKey} onCopy={() => copy('sol', all.sol!.publicKey)} copied={copied === 'sol'} />
        )}
        {all?.btc && (
          <Row label="Bitcoin (P2WPKH)" value={all.btc.address} onCopy={() => copy('btc', all.btc!.address)} copied={copied === 'btc'} />
        )}
      </Card>

      <Card title="Приватные ключи других сетей">
        <p className="text-xs text-ton-muted mb-3">
          Нужны только для импорта в сторонний кошелёк (MetaMask, Phantom,
          Electrum). Для каждой сети свой ключ. Никому не показывай.
        </p>
        {all?.evm && (
          <PrivKey label="EVM PK (ETH/BNB, hex)" value={all.evm.privateKeyHex} expanded={showPriv === 'evm'} onToggle={() => setShowPriv(showPriv === 'evm' ? null : 'evm')} onCopy={() => copy('evmpk', all.evm!.privateKeyHex)} copied={copied === 'evmpk'} />
        )}
        {all?.sol && (
          <PrivKey label="Solana secret key (hex)" value={all.sol.secretKeyHex} expanded={showPriv === 'sol'} onToggle={() => setShowPriv(showPriv === 'sol' ? null : 'sol')} onCopy={() => copy('solpk', all.sol!.secretKeyHex)} copied={copied === 'solpk'} />
        )}
        {all?.btc && (
          <PrivKey label="Bitcoin PK (hex, raw secp256k1)" value={all.btc.privateKeyHex} expanded={showPriv === 'btc'} onToggle={() => setShowPriv(showPriv === 'btc' ? null : 'btc')} onCopy={() => copy('btcpk', all.btc!.privateKeyHex)} copied={copied === 'btcpk'} />
        )}
        <p className="text-[10px] text-amber-400 mt-2">
          Ключи ETH/SOL/BTC выводятся из TON seed по формуле {APP_NAME} (не
          BIP-39/BIP-44). Чтобы восстановить их вне приложения, импортируй
          именно эти hex-ключи.
        </p>
      </Card>

      <BiometricCard />

      <Card title="Безопасность">
        <button
          onClick={onLock}
          className="w-full py-3 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border font-semibold mb-2"
        >
          Заблокировать кошелёк
        </button>
        <button
          onClick={() => {
            if (
              confirm(
                'Кошелёк будет удалён с устройства и из облака Telegram. Убедись, что seed-фраза сохранена.',
              )
            ) {
              clearBiometric()
              void wipeWallet()
              onForget()
            }
          }}
          className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 font-semibold"
        >
          Удалить кошелёк
        </button>
      </Card>

      <div className="text-[10px] text-ton-muted text-center pt-2">
        {APP_NAME} · некастодиальный · мульти-чейн · комиссия сервиса {totalPercent}%
      </div>
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-ton-card border border-ton-border rounded-2xl p-4">
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      {children}
    </div>
  )
}

function Row({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string
  value: string
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-xs text-ton-muted mb-1">{label}</div>
      <div className="flex items-center gap-2 bg-ton-card/60 border border-ton-border rounded-lg px-3 py-2">
        <div className="font-mono text-[11px] break-all flex-1">{value}</div>
        <button
          onClick={onCopy}
          className="text-xs text-ton-primary hover:underline shrink-0"
        >
          {copied ? '✓' : 'Копировать'}
        </button>
      </div>
    </div>
  )
}

// Removed: virtual ledger / withdrawal UI. Referral 0.5% is now paid
// on-chain at send time — see referral.ts → lookupReferrerAddress.

function Toggle({
  open,
  label,
  onClick,
  children,
}: {
  open: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <button
        onClick={onClick}
        className="w-full py-2 rounded-xl bg-ton-card border border-ton-border hover:bg-ton-border text-sm mb-2"
      >
        {label}
      </button>
      {open && (
        <div className="bg-ton-card border border-ton-border rounded-xl p-3 mb-3">
          {children}
        </div>
      )}
    </>
  )
}

function PrivKey({
  label,
  value,
  expanded,
  onToggle,
  onCopy,
  copied,
}: {
  label: string
  value: string
  expanded: boolean
  onToggle: () => void
  onCopy: () => void
  copied: boolean
}) {
  return (
    <Toggle open={expanded} label={expanded ? `Скрыть ${label}` : `Показать ${label}`} onClick={onToggle}>
      <div className="font-mono text-[10px] break-all">{value}</div>
      <button onClick={onCopy} className="mt-2 text-xs text-ton-primary hover:underline">
        {copied ? 'Скопировано!' : 'Скопировать'}
      </button>
    </Toggle>
  )
}
