export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(appPath('sw.js'), { scope: appBasePath() }).catch(() => undefined)
    })
  }
}
import { appBasePath, appPath } from '../appPaths'
