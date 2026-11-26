import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

interface Props {
  address: string
  onClose: () => void
}

export function Receive({ address, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="min-h-full p-6 max-w-md mx-auto">
      <button onClick={onClose} className="text-ton-muted mb-4">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-4">Receive TON</h1>
      <div className="bg-white rounded-2xl p-6 flex justify-center mb-4">
        <QRCodeSVG value={address} size={220} />
      </div>
      <div className="bg-ton-card border border-ton-border rounded-xl p-4 mb-3">
        <div className="text-xs text-ton-muted mb-1">Your address</div>
        <div className="font-mono text-sm break-all">{address}</div>
      </div>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(address)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="w-full py-3 rounded-xl bg-ton-primary hover:brightness-110 font-semibold"
      >
        {copied ? 'Copied!' : 'Copy address'}
      </button>
      <p className="text-xs text-ton-muted mt-4 text-center">
        Send only TON (The Open Network) to this address.
      </p>
    </div>
  )
}
