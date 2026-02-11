/**
 * Annotation Overlay Component
 *
 * A professional screenshot annotation tool allowing users to:
 * - Draw shapes: Circle, Arrow, Rectangle, Freehand
 * - Pick colors: Red (default), Blue, Yellow, Green, White
 * - Undo/Redo with full history support
 * - Clear all annotations
 * - Save annotated screenshot
 *
 * Keyboard shortcuts:
 * - 1: Arrow tool
 * - 2: Circle tool
 * - 3: Rectangle tool
 * - 4: Freehand tool
 * - Z / Cmd+Z: Undo
 * - Y / Cmd+Shift+Z: Redo
 * - C: Clear all
 * - Escape: Cancel
 * - Enter: Save
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import type { Screenshot } from '../../shared/types';

// =============================================================================
// Types
// =============================================================================

type Tool = 'circle' | 'arrow' | 'rectangle' | 'freehand';

interface Point {
  x: number;
  y: number;
}

interface Annotation {
  id: string;
  type: Tool;
  points: Point[];
  color: string;
  strokeWidth: number;
}

interface AnnotationOverlayProps {
  screenshot: Screenshot;
  isActive: boolean;
  onSave: (annotatedDataUrl: string) => void;
  onCancel: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const TOOLS: { id: Tool; icon: string; label: string; shortcut: string }[] = [
  { id: 'arrow', icon: '\u2197', label: 'Arrow', shortcut: '1' },
  { id: 'circle', icon: '\u25CB', label: 'Circle', shortcut: '2' },
  { id: 'rectangle', icon: '\u25A1', label: 'Rectangle', shortcut: '3' },
  { id: 'freehand', icon: '\u270E', label: 'Freehand', shortcut: '4' },
];

const COLORS = [
  { value: '#FF3B30', name: 'Red' },
  { value: '#007AFF', name: 'Blue' },
  { value: '#FFCC00', name: 'Yellow' },
  { value: '#34C759', name: 'Green' },
  { value: '#FFFFFF', name: 'White' },
];

const DEFAULT_STROKE_WIDTH = 3;
const ARROWHEAD_LENGTH = 15;

// =============================================================================
// Drawing Utilities
// =============================================================================

function generateId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  strokeWidth: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = ARROWHEAD_LENGTH;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw the line
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  // Draw the arrowhead
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLength * Math.cos(angle - Math.PI / 6),
    to.y - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLength * Math.cos(angle + Math.PI / 6),
    to.y - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.stroke();
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation
): void {
  ctx.strokeStyle = annotation.color;
  ctx.lineWidth = annotation.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (annotation.type) {
    case 'circle': {
      if (annotation.points.length < 2) return;
      const [start, end] = annotation.points;
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      ctx.beginPath();
      ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'arrow': {
      if (annotation.points.length < 2) return;
      drawArrow(
        ctx,
        annotation.points[0],
        annotation.points[1],
        annotation.color,
        annotation.strokeWidth
      );
      break;
    }

    case 'rectangle': {
      if (annotation.points.length < 2) return;
      const [p1, p2] = annotation.points;
      ctx.beginPath();
      ctx.rect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.stroke();
      break;
    }

    case 'freehand': {
      if (annotation.points.length < 2) return;
      ctx.beginPath();
      annotation.points.forEach((point, i) => {
        if (i === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      break;
    }
  }
}

// =============================================================================
// Toolbar Component
// =============================================================================

interface ToolbarProps {
  tool: Tool;
  color: string;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onSave: () => void;
  onCancel: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  color,
  onToolChange,
  onColorChange,
  onUndo,
  onRedo,
  onClear,
  onSave,
  onCancel,
  canUndo,
  canRedo,
}) => {
  return (
    <div style={toolbarStyles.container}>
      {/* Tool buttons */}
      <div style={toolbarStyles.section}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => onToolChange(t.id)}
            style={{
              ...toolbarStyles.button,
              ...(tool === t.id ? toolbarStyles.buttonActive : {}),
            }}
            title={`${t.label} (${t.shortcut})`}
          >
            <span style={toolbarStyles.buttonIcon}>{t.icon}</span>
          </button>
        ))}
      </div>

      <div style={toolbarStyles.divider} />

      {/* Color picker */}
      <div style={toolbarStyles.section}>
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => onColorChange(c.value)}
            style={{
              ...toolbarStyles.colorButton,
              backgroundColor: c.value,
              ...(color === c.value ? toolbarStyles.colorButtonActive : {}),
            }}
            title={c.name}
          />
        ))}
      </div>

      <div style={toolbarStyles.divider} />

      {/* History controls */}
      <div style={toolbarStyles.section}>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          style={{
            ...toolbarStyles.button,
            ...(canUndo ? {} : toolbarStyles.buttonDisabled),
          }}
          title="Undo (Z)"
        >
          <span style={toolbarStyles.buttonIcon}>{'\u21A9'}</span>
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          style={{
            ...toolbarStyles.button,
            ...(canRedo ? {} : toolbarStyles.buttonDisabled),
          }}
          title="Redo (Y)"
        >
          <span style={toolbarStyles.buttonIcon}>{'\u21AA'}</span>
        </button>
        <button
          onClick={onClear}
          style={{
            ...toolbarStyles.button,
            ...toolbarStyles.buttonDanger,
          }}
          title="Clear All (C)"
        >
          <span style={toolbarStyles.buttonIcon}>{'\u2715'}</span>
        </button>
      </div>

      <div style={toolbarStyles.divider} />

      {/* Action buttons */}
      <div style={toolbarStyles.section}>
        <button
          onClick={onCancel}
          style={{
            ...toolbarStyles.actionButton,
            ...toolbarStyles.cancelButton,
          }}
          title="Cancel (Escape)"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          style={{
            ...toolbarStyles.actionButton,
            ...toolbarStyles.saveButton,
          }}
          title="Save (Enter)"
        >
          Save
        </button>
      </div>
    </div>
  );
};

const toolbarStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: 12,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: `
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06),
      0 0 0 1px rgba(75, 85, 99, 0.5)
    `,
    zIndex: 10001,
    userSelect: 'none',
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(75, 85, 99, 0.5)',
    margin: '0 4px',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    padding: 0,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    color: 'var(--text-primary)',
  },
  buttonActive: {
    backgroundColor: 'var(--accent-default)',
  },
  buttonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  buttonDanger: {
    color: 'var(--status-error)',
  },
  buttonIcon: {
    fontSize: 18,
    lineHeight: 1,
  },
  colorButton: {
    width: 24,
    height: 24,
    padding: 0,
    border: '2px solid transparent',
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  colorButtonActive: {
    borderColor: 'var(--text-inverse)',
    transform: 'scale(1.1)',
  },
  actionButton: {
    padding: '6px 14px',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  cancelButton: {
    backgroundColor: 'rgba(75, 85, 99, 0.5)',
    color: 'var(--text-primary)',
  },
  saveButton: {
    backgroundColor: 'var(--status-success)',
    color: 'var(--text-inverse)',
  },
};

// =============================================================================
// Hint Overlay Component
// =============================================================================

const HintOverlay: React.FC = () => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div style={hintStyles.container}>
      <div style={hintStyles.badge}>
        <span style={hintStyles.text}>
          Draw to annotate | Press <kbd style={hintStyles.kbd}>1-4</kbd> for
          tools | <kbd style={hintStyles.kbd}>Z</kbd> to undo
        </span>
      </div>
    </div>
  );
};

const hintStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10001,
    animation: 'toolbarFadeInUp 0.3s ease-out, fadeOut 0.3s ease-in 3.7s forwards',
  },
  badge: {
    padding: '8px 16px',
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
    borderRadius: 20,
    backdropFilter: 'blur(8px)',
  },
  text: {
    color: 'var(--text-secondary)',
    fontSize: 13,
  },
  kbd: {
    display: 'inline-block',
    padding: '2px 6px',
    marginLeft: 2,
    marginRight: 2,
    backgroundColor: 'rgba(75, 85, 99, 0.5)',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: 'var(--text-primary)',
  },
};

// =============================================================================
// Main Component
// =============================================================================

export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({
  screenshot,
  isActive,
  onSave,
  onCancel,
}) => {
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Drawing state
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0].value);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(
    null
  );
  const [isDrawing, setIsDrawing] = useState(false);

  // History state (for undo/redo)
  const [history, setHistory] = useState<Annotation[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Compute derived state
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Get image source from screenshot
  const imageSrc = useMemo(() => {
    if (screenshot.base64) {
      return `data:image/png;base64,${screenshot.base64}`;
    }
    // Fallback to file path with file:// protocol
    return `file://${screenshot.imagePath}`;
  }, [screenshot]);

  // ==========================================================================
  // Canvas Rendering
  // ==========================================================================

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // Draw all annotations
    annotations.forEach((ann) => drawAnnotation(ctx, ann));

    // Draw current annotation in progress
    if (currentAnnotation) {
      drawAnnotation(ctx, currentAnnotation);
    }
  }, [annotations, currentAnnotation]);

  // Load image and set up canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        redrawCanvas();
      }
    };

    img.onerror = () => {
      console.error('Failed to load screenshot for annotation');
    };

    img.src = imageSrc;
  }, [imageSrc, redrawCanvas]);

  // Redraw when annotations change
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // ==========================================================================
  // History Management
  // ==========================================================================

  const pushToHistory = useCallback(
    (newAnnotations: Annotation[]) => {
      // Remove any redo states
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newAnnotations);

      // Limit history to prevent memory issues
      if (newHistory.length > 50) {
        newHistory.shift();
      }

      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex]
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setAnnotations(history[newIndex]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setAnnotations(history[newIndex]);
    }
  }, [history, historyIndex]);

  const clearAll = useCallback(() => {
    setAnnotations([]);
    pushToHistory([]);
  }, [pushToHistory]);

  // ==========================================================================
  // Drawing Handlers
  // ==========================================================================

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return; // Only left click

      const point = getCanvasCoordinates(e);
      setIsDrawing(true);

      const newAnnotation: Annotation = {
        id: generateId(),
        type: tool,
        points: [point],
        color,
        strokeWidth: DEFAULT_STROKE_WIDTH,
      };

      setCurrentAnnotation(newAnnotation);
    },
    [tool, color, getCanvasCoordinates]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !currentAnnotation) return;

      const point = getCanvasCoordinates(e);

      setCurrentAnnotation((prev) => {
        if (!prev) return null;

        if (prev.type === 'freehand') {
          // Freehand: add all points
          return {
            ...prev,
            points: [...prev.points, point],
          };
        } else {
          // Other tools: keep start point, update end point
          return {
            ...prev,
            points: [prev.points[0], point],
          };
        }
      });
    },
    [isDrawing, currentAnnotation, getCanvasCoordinates]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !currentAnnotation) return;

    // Only save if annotation has enough points
    if (currentAnnotation.points.length >= 2) {
      const newAnnotations = [...annotations, currentAnnotation];
      setAnnotations(newAnnotations);
      pushToHistory(newAnnotations);
    }

    setIsDrawing(false);
    setCurrentAnnotation(null);
  }, [isDrawing, currentAnnotation, annotations, pushToHistory]);

  // ==========================================================================
  // Save Handler
  // ==========================================================================

  const handleSave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Export canvas as data URL
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
  }, [onSave]);

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Tool shortcuts
      switch (e.key) {
        case '1':
          setTool('arrow');
          break;
        case '2':
          setTool('circle');
          break;
        case '3':
          setTool('rectangle');
          break;
        case '4':
          setTool('freehand');
          break;
        case 'z':
        case 'Z':
          if (e.metaKey || e.ctrlKey) {
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            e.preventDefault();
          } else if (!e.shiftKey) {
            undo();
          }
          break;
        case 'y':
        case 'Y':
          redo();
          break;
        case 'c':
        case 'C':
          if (!e.metaKey && !e.ctrlKey) {
            clearAll();
          }
          break;
        case 'Escape':
          onCancel();
          break;
        case 'Enter':
          handleSave();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, undo, redo, clearAll, onCancel, handleSave]);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (!isActive) return null;

  return (
    <>
      {/* toolbarFadeInUp, fadeOut, pageFadeIn keyframes provided by animations.css */}

      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          zIndex: 10000,
          animation: 'pageFadeIn 0.2s ease-out',
        }}
      />

      {/* Canvas container */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 60,
          zIndex: 10000,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            borderRadius: 8,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            cursor: tool === 'freehand' ? 'crosshair' : 'crosshair',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      {/* Toolbar */}
      <Toolbar
        tool={tool}
        color={color}
        onToolChange={setTool}
        onColorChange={setColor}
        onUndo={undo}
        onRedo={redo}
        onClear={clearAll}
        onSave={handleSave}
        onCancel={onCancel}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      {/* Hint overlay */}
      <HintOverlay />
    </>
  );
};

export default AnnotationOverlay;
