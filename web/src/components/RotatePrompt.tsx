import { useEffect, useState } from 'react'

interface RotatePromptProps {
  onImport?: () => void
}

export function RotatePrompt({ onImport }: RotatePromptProps) {
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    setIsIOS(/iphone|ipad|ipod/.test(ua))
  }, [])

  return (
    <div className="rotate-prompt">
      <h1>Choose SGF in portrait</h1>
      <p>Review games in landscape</p>
      {onImport && (
        <button className="portrait-import-button" onClick={onImport}>
          Choose SGF
        </button>
      )}
      {isIOS && (
        <p className="rotate-hint">
          请关闭控制中心的竖屏锁定，然后将设备横置
        </p>
      )}
    </div>
  )
}
