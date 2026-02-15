import { execFile as execFileCb } from 'child_process';
import type { McpCaptureContextSnapshot } from '../types.js';

const SAFE_CHILD_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME || process.env.USERPROFILE,
  USERPROFILE: process.env.USERPROFILE,
  LANG: process.env.LANG,
  TMPDIR: process.env.TMPDIR || process.env.TEMP,
  TEMP: process.env.TEMP,
};

const MAC_CONTEXT_PROBE_JXA = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');

function unwrap(v) {
  try { return ObjC.unwrap(v); } catch (_) { return null; }
}

function readAttr(el, attr) {
  var ref = Ref();
  var err = $.AXUIElementCopyAttributeValue(el, attr, ref);
  if (err !== 0) return null;
  return unwrap(ref[0]);
}

var out = {};
var event = $.CGEventCreate(null);
if (event) {
  var p = $.CGEventGetLocation(event);
  out.cursor = { x: Math.round(p.x), y: Math.round(p.y) };
}

var front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (front) {
  var pid = Number(front.processIdentifier);
  out.activeWindow = {
    appName: unwrap(front.localizedName) || undefined,
    pid: pid
  };

  var appEl = $.AXUIElementCreateApplication(pid);
  var focusedWindow = readAttr(appEl, $.kAXFocusedWindowAttribute);
  if (focusedWindow) {
    var winTitle = readAttr(focusedWindow, $.kAXTitleAttribute);
    if (winTitle) out.activeWindow.title = String(winTitle);
  }

  var focused = readAttr(appEl, $.kAXFocusedUIElementAttribute);
  if (focused) {
    out.focusedElement = {
      role: readAttr(focused, $.kAXRoleAttribute) || undefined,
      title: readAttr(focused, $.kAXTitleAttribute) || undefined,
      description: readAttr(focused, $.kAXDescriptionAttribute) || undefined,
      value: readAttr(focused, $.kAXValueAttribute) || undefined,
    };
  }
}

JSON.stringify(out);
`;

function sanitizeText(value?: string, maxLength: number = 140): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function runMacContextProbe(timeoutMs: number): Promise<{
  cursor?: { x?: number; y?: number };
  activeWindow?: { appName?: string; title?: string; pid?: number };
  focusedElement?: { role?: string; title?: string; description?: string; value?: string };
} | null> {
  return new Promise((resolve) => {
    execFileCb(
      'osascript',
      ['-l', 'JavaScript', '-e', MAC_CONTEXT_PROBE_JXA],
      { env: SAFE_CHILD_ENV, timeout: timeoutMs },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          const parsed = JSON.parse(stdout.toString().trim()) as {
            cursor?: { x?: number; y?: number };
            activeWindow?: { appName?: string; title?: string; pid?: number };
            focusedElement?: { role?: string; title?: string; description?: string; value?: string };
          };
          resolve(parsed);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export async function captureContextSnapshot(): Promise<McpCaptureContextSnapshot> {
  const snapshot: McpCaptureContextSnapshot = {
    recordedAt: Date.now(),
  };

  if (process.platform !== 'darwin') {
    return snapshot;
  }

  const context = await runMacContextProbe(550);
  if (!context) {
    return snapshot;
  }

  if (context.cursor && Number.isFinite(context.cursor.x) && Number.isFinite(context.cursor.y)) {
    snapshot.cursor = {
      x: Number(context.cursor.x),
      y: Number(context.cursor.y),
    };
  }

  if (context.activeWindow) {
    snapshot.activeWindow = {
      appName: sanitizeText(context.activeWindow.appName, 120),
      title: sanitizeText(context.activeWindow.title, 160),
      pid: Number.isFinite(context.activeWindow.pid) ? Number(context.activeWindow.pid) : undefined,
    };
  }

  if (context.focusedElement) {
    const textPreview =
      sanitizeText(context.focusedElement.value, 120)
      || sanitizeText(context.focusedElement.title, 120)
      || sanitizeText(context.focusedElement.description, 120);

    if (textPreview || context.focusedElement.role) {
      snapshot.focusedElement = {
        source: 'os-accessibility',
        role: sanitizeText(context.focusedElement.role, 80),
        textPreview,
        appName: snapshot.activeWindow?.appName,
        windowTitle: snapshot.activeWindow?.title,
      };
    }
  }

  if (!snapshot.focusedElement && (snapshot.activeWindow?.title || snapshot.activeWindow?.appName)) {
    snapshot.focusedElement = {
      source: 'window-title',
      textPreview: snapshot.activeWindow?.title || snapshot.activeWindow?.appName,
      appName: snapshot.activeWindow?.appName,
      windowTitle: snapshot.activeWindow?.title,
    };
  }

  return snapshot;
}

