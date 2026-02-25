import { useState } from 'react'

interface InfoTooltipProps {
  text: string
}

export default function InfoTooltip({ text }: InfoTooltipProps) {
  const [show, setShow] = useState(false)

  return (
    <span
      className="info-tooltip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="info-tooltip-icon">ⓘ</span>
      {show && (
        <span className="info-tooltip-content">
          {text}
        </span>
      )}
    </span>
  )
}
