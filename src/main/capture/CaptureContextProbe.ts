import { execFile as execFileCb } from 'child_process';
import { screen } from 'electron';
import type {
  CaptureContextSnapshot,
  FocusedElementHint,
} from '../../shared/types';

interface CaptureContextProbeInput {
  trigger: 'pause' | 'manual' | 'voice-command';
  sourceId?: string;
  sourceName?: string;
  focusedElementHint?: FocusedElementHint;
}

interface MacProbeOutput {
  cursor?: { x?: number; y?: number };
  activeWindow?: { appName?: string; title?: string; pid?: number };
  focusedElement?: {
    role?: string;
    subrole?: string;
    title?: string;
    description?: string;
    value?: string;
  };
}

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
      subrole: readAttr(focused, $.kAXSubroleAttribute) || undefined,
      title: readAttr(focused, $.kAXTitleAttribute) || undefined,
      description: readAttr(focused, $.kAXDescriptionAttribute) || undefined,
      value: readAttr(focused, $.kAXValueAttribute) || undefined,
    };
  }
}

JSON.stringify(out);
`;

function runMacContextProbe(timeoutMs: number): Promise<MacProbeOutput | null> {
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
          const parsed = JSON.parse(stdout.toString().trim()) as MacProbeOutput;
          resolve(parsed);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function sanitizeText(value?: string, maxLength: number = 140): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function mergeFocusedHints(
  osHint: CaptureContextSnapshot['focusedElement'],
  rendererHint: FocusedElementHint | undefined
): CaptureContextSnapshot['focusedElement'] {
  if (!osHint && !rendererHint) return undefined;
  if (!osHint && rendererHint) return rendererHint;
  if (osHint && !rendererHint) return osHint;

  return {
    ...rendererHint,
    ...osHint,
    source: osHint?.source || rendererHint?.source || 'unknown',
  };
}

export async function probeCaptureContext(
  input: CaptureContextProbeInput
): Promise<CaptureContextSnapshot> {
  const cursorPoint = screen.getCursorScreenPoint();
  const nearestDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const sourceType = input.sourceId?.startsWith('window') ? 'window' : 'screen';

  const baseContext: CaptureContextSnapshot = {
    recordedAt: Date.now(),
    trigger: input.trigger,
    cursor: {
      x: cursorPoint.x,
      y: cursorPoint.y,
      displayId: String(nearestDisplay.id),
      displayLabel: nearestDisplay.label || undefined,
      relativeX: cursorPoint.x - nearestDisplay.bounds.x,
      relativeY: cursorPoint.y - nearestDisplay.bounds.y,
    },
    activeWindow: {
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceType,
    },
  };

  if (process.platform !== 'darwin') {
    baseContext.focusedElement = mergeFocusedHints(undefined, input.focusedElementHint);
    return baseContext;
  }

  const macProbe = await runMacContextProbe(550);
  if (macProbe?.cursor) {
    baseContext.cursor = {
      ...baseContext.cursor,
      x: Number.isFinite(macProbe.cursor.x) ? Number(macProbe.cursor.x) : baseContext.cursor?.x ?? 0,
      y: Number.isFinite(macProbe.cursor.y) ? Number(macProbe.cursor.y) : baseContext.cursor?.y ?? 0,
    };
  }

  if (macProbe?.activeWindow) {
    baseContext.activeWindow = {
      ...baseContext.activeWindow,
      appName: sanitizeText(macProbe.activeWindow.appName, 120),
      title: sanitizeText(macProbe.activeWindow.title, 160),
      pid: Number.isFinite(macProbe.activeWindow.pid) ? Number(macProbe.activeWindow.pid) : undefined,
    };
  }

  const osFocusedHint = macProbe?.focusedElement
    ? {
        source: 'os-accessibility' as const,
        role: sanitizeText(macProbe.focusedElement.role, 80),
        textPreview:
          sanitizeText(macProbe.focusedElement.value, 120)
          || sanitizeText(macProbe.focusedElement.title, 120)
          || sanitizeText(macProbe.focusedElement.description, 120),
        appName: baseContext.activeWindow?.appName,
        windowTitle: baseContext.activeWindow?.title,
      }
    : undefined;

  baseContext.focusedElement = mergeFocusedHints(osFocusedHint, input.focusedElementHint);

  if (!baseContext.focusedElement && (baseContext.activeWindow?.title || baseContext.activeWindow?.appName)) {
    baseContext.focusedElement = {
      source: 'window-title',
      textPreview: baseContext.activeWindow?.title || baseContext.activeWindow?.appName,
      appName: baseContext.activeWindow?.appName,
      windowTitle: baseContext.activeWindow?.title,
    };
  }

  return baseContext;
}

