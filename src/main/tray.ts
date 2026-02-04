import { Tray, Menu, nativeImage, BrowserWindow, screen, app } from 'electron'

let tray: Tray | null = null

const TRAY_ICON_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADFSURBVDiNpZMxDsIwDEV/Km7A2JWJiYkzwBG4AneAE3AHVlbYmBhZGDlBRAdQQEg4Q5o4sWpLTvL87B+7QW4BngGgAJ4q9vcS/QKdgB7wDdRAA7S5qEKXyJt2BsYELIE3sAAagDjXAfaBY2ALWAHvCVgHjsLZrYFHYAk8JPqOQJfJw7G9BywTe+CMYMlnMQH+JqDPgX8LQZcJwC9RkAPVHxuokoIUeJiCX3Xrh5cJeIVwDVCFMRfwqfkL/D0BO+CaEL4BPBk9eGrTnzgAAAAASUVORK5CYII='

export function createTray(mainWindow: BrowserWindow): Tray {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA)

  tray = new Tray(icon)
  tray.setToolTip('FeedbackFlow')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Record Feedback',
      click: () => {
        showWindow(mainWindow)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showWindow(mainWindow)
    }
  })

  return tray
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
