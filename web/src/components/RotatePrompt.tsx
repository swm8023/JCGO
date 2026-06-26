import { useEffect, useState } from 'react'

export function RotatePrompt() {
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    setIsIOS(/iphone|ipad|ipod/.test(ua))
  }, [])

  return (
    <div className="rotate-prompt">
      <h1>请旋转设备</h1>
      <p>JCGO 需要横屏使用</p>
      {isIOS && (
        <p className="rotate-hint">
          请关闭控制中心的竖屏锁定，然后将设备横置
        </p>
      )}
    </div>
  )
}
