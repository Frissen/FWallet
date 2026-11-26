import { APP_NAME, COMMISSION_RATES } from '../lib/config'
import { cloudAvailable } from '../lib/cloudVault'

interface Props {
  onCreate: () => void
  onImport: () => void
}

export function Welcome({ onCreate, onImport }: Props) {
  const fee = (COMMISSION_RATES.send.totalBps / 100).toFixed(2)
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-3xl fw-logo flex items-center justify-center mb-6">
        <span className="text-4xl font-extrabold tracking-tight text-white">F</span>
      </div>
      <h1 className="text-3xl font-bold mb-2">{APP_NAME}</h1>
      <p className="text-ton-muted max-w-xs mb-8">
        Некастодиальный кошелёк для TON, Bitcoin, Ethereum и Solana. Ключи
        шифруются PIN-кодом и никогда не покидают твоё устройство
        {cloudAvailable() ? ' в открытом виде' : ''}.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={onCreate}
          className="w-full py-3.5 rounded-2xl fw-cta-primary font-semibold active:scale-[0.98] transition"
        >
          Создать кошелёк
        </button>
        <button
          onClick={onImport}
          className="w-full py-3.5 rounded-2xl bg-ton-card hover:bg-ton-card-hover border border-ton-border transition font-semibold active:scale-[0.98]"
        >
          У меня уже есть кошелёк
        </button>
      </div>
      <p className="text-xs text-ton-muted mt-8 max-w-xs">
        Без регистрации и KYC. Комиссия сервиса {fee}% за исходящие переводы
        всегда показывается перед подтверждением.
      </p>
    </div>
  )
}
