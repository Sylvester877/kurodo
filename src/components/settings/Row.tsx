import { type ReactNode } from 'react'

interface Props {
  label: string
  description?: string
  children: ReactNode
}

/** Standard settings row: label/description on the left, control on the right. */
export default function Row({ label, description, children }: Props) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-white/[0.04] last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium">{label}</p>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
