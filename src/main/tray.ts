import { Tray, Menu, nativeImage, BrowserWindow, screen, app, clipboard } from 'electron'
import { SessionState, type RecentSession } from './services'
import { basename } from 'path'

let tray: Tray | null = null
let mainWindowRef: BrowserWindow | null = null
let recentSessions: RecentSession[] = []

// Base64 encoded 16x16 template icons for menu bar
// These are simple monochrome icons that work with macOS dark/light mode
const ICONS = {
  idle: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABkSURBVDiN7dKxDcAgDATA/xdlhIyQFbJCRsgIWSEjZIWMwAgZISNQUCBFSqLEvuZ1Nkgy8AUOIANN4L4VNGAHXMDYBhpwAr0Xa8ABrJYLLoAzc8fXAQMYMndkLujA+H/gDzyJhRqVp1LDAAAAAElFTkSuQmCC',
  recording: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAB2SURBVDiNtZLRDcAgCER95LdTOIIjOIojOIojOIIjdAQ6Ah2hI+gHpjFqY5r0kvth4B0kkELIAhMgA+y+oAd2oAa6b6AAHsCQ5b7FAcxhCi6AO3NHegEDGDJ3eC7IwfxPMAA5zB1eCxLwPP8Kev4H/oE7sBs9KfXDAAAAAElFTkSuQmCC',
  processing: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABvSURBVDiNxZJBDsAgCAS3/P+n9OSh2mhFwdhLDzuBYYFJkQBqoASMgOULBmADTGD6BgMwAv0zGIAVaJ5BAQ7g8w7qbxiANgzBEXBm7sheYAJD5o6sBT6Y/wkmoA9zRdYCH/j+h+/4G/gHzsCJiCw7A8EAAAAASUVORK5CYII=',
  complete: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABpSURBVDiNtZJRDoAgDAX7yv2vVE+uGIOhMAr+bALdvkJJGSQBNEAFjIDlCwZgA0xg+gYDMAL9MxiAFWieQQEO4PMO6m8YgDYMwRFwZu7IXmACQ+aOrAU+mP8JJqAPc0XWAh/4/ofv+Bu4A9c0NNd2AgAAAABJRU5ErkJggg==',
  error: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABsSURBVDiNxZJBDoAgDARn8f9fqifXGI3IIqIHPdgNbWcLJKUSQA1UgBGwfIEB2AATmL7BAIxA/wwGYAWaZ1CAA/i8g/obBqANQ3AEnJk7sheYwJC5I2uBD+Z/ggnowhwRtcAHvv/hO/4G/oE7AB49MA0AAAAASUVORK5CYII='
}

export function createTray(mainWindow: BrowserWindow): Tray {
  mainWindowRef = mainWindow
  const icon = nativeImage.createFromDataURL(ICONS.idle)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('FeedbackFlow')

  updateContextMenu()

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showWindow(mainWindow)
    }
  })

  return tray
}

function updateContextMenu(): void {
  if (!tray || !mainWindowRef) return

  const menuItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Record Feedback',
      click: () => {
        if (mainWindowRef) {
          showWindow(mainWindowRef)
          mainWindowRef.webContents.send('tray:startRecording')
        }
      }
    },
    { type: 'separator' }
  ]

  // Add recent sessions submenu if there are any
  if (recentSessions.length > 0) {
    const recentItems: Electron.MenuItemConstructorOptions[] = recentSessions.map((session) => {
      const filename = basename(session.reportPath)
      const durationMin = Math.floor(session.duration / 60)
      const durationSec = session.duration % 60
      const durationStr = `${durationMin}:${String(durationSec).padStart(2, '0')}`

      return {
        label: `${filename} (${durationStr})`,
        click: () => {
          clipboard.writeText(session.reportPath)
        }
      }
    })

    menuItems.push({
      label: 'Recent Sessions',
      submenu: recentItems
    })
    menuItems.push({ type: 'separator' })
  }

  menuItems.push(
    {
      label: 'Settings',
      click: () => {
        if (mainWindowRef) {
          showWindow(mainWindowRef)
          mainWindowRef.webContents.send('tray:openSettings')
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit FeedbackFlow',
      click: () => {
        app.quit()
      }
    }
  )

  const contextMenu = Menu.buildFromTemplate(menuItems)
  tray.setContextMenu(contextMenu)
}

export function updateRecentSessions(sessions: RecentSession[]): void {
  recentSessions = sessions
  updateContextMenu()
}

export function updateTrayIcon(state: SessionState): void {
  if (!tray) return

  let iconData: string
  let tooltip: string

  switch (state) {
    case SessionState.RECORDING:
      iconData = ICONS.recording
      tooltip = 'FeedbackFlow - Recording...'
      break
    case SessionState.STARTING:
    case SessionState.STOPPING:
    case SessionState.PROCESSING:
      iconData = ICONS.processing
      tooltip = 'FeedbackFlow - Processing...'
      break
    case SessionState.COMPLETE:
      iconData = ICONS.complete
      tooltip = 'FeedbackFlow - Complete!'
      break
    case SessionState.ERROR:
      iconData = ICONS.error
      tooltip = 'FeedbackFlow - Error'
      break
    default:
      iconData = ICONS.idle
      tooltip = 'FeedbackFlow'
  }

  const icon = nativeImage.createFromDataURL(iconData)
  icon.setTemplateImage(true)
  tray.setImage(icon)
  tray.setToolTip(tooltip)
}

function showWindow(window: BrowserWindow): void {
  if (!tray) return

  const trayBounds = tray.getBounds()
  const windowBounds = window.getBounds()
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
  const y = Math.round(trayBounds.y + trayBounds.height)

  const maxX = display.bounds.x + display.bounds.width - windowBounds.width
  const maxY = display.bounds.y + display.bounds.height - windowBounds.height

  window.setPosition(
    Math.min(Math.max(display.bounds.x, x), maxX),
    Math.min(Math.max(display.bounds.y, y), maxY)
  )

  window.show()
  window.focus()
}

export function getTray(): Tray | null {
  return tray
}
