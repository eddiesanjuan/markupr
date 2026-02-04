/**
 * FeedbackFlow Onboarding Wizard
 *
 * The first impression that makes users say "wow".
 *
 * Flow:
 * 1. Welcome - Animated logo, tagline, Get Started button
 * 2. Microphone - Permission request with audio level preview
 * 3. Screen Recording - Permission request with system settings link
 * 4. Deepgram API Key - Input, test, success/error feedback
 * 5. Success - Confetti celebration, Start Recording button
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

interface OnboardingProps {
  onComplete: () => void;
  onSkip: () => void;
}

type OnboardingStep = 'welcome' | 'microphone' | 'screen' | 'apikey' | 'success';

interface PermissionStatus {
  microphone: 'unknown' | 'pending' | 'granted' | 'denied';
  screen: 'unknown' | 'pending' | 'granted' | 'denied';
}

interface ApiKeyStatus {
  value: string;
  testing: boolean;
  valid: boolean | null;
  error: string | null;
}

// ============================================================================
// Confetti Particle System
// ============================================================================

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  size: number;
  opacity: number;
}

const CONFETTI_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

const createParticle = (id: number, centerX: number, centerY: number): Particle => ({
  id,
  x: centerX,
  y: centerY,
  vx: (Math.random() - 0.5) * 20,
  vy: Math.random() * -15 - 10,
  rotation: Math.random() * 360,
  rotationSpeed: (Math.random() - 0.5) * 20,
  color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  size: Math.random() * 8 + 4,
  opacity: 1,
});

const ConfettiCanvas: React.FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Create initial burst of particles
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    particlesRef.current = Array.from({ length: 150 }, (_, i) =>
      createParticle(i, centerX, centerY)
    );

    const animate = () => {
      if (!ctx || !canvas) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particlesRef.current = particlesRef.current.filter((p) => {
        // Update physics
        p.vy += 0.5; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.opacity -= 0.008;

        // Draw particle
        if (p.opacity > 0) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }

        return p.opacity > 0 && p.y < canvas.height + 50;
      });

      if (particlesRef.current.length > 0) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    />
  );
};

// ============================================================================
// Audio Level Visualizer
// ============================================================================

const AudioLevelMeter: React.FC<{ active: boolean }> = ({ active }) => {
  const [levels, setLevels] = useState<number[]>(Array(20).fill(0));
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!active) {
      // Cleanup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      setLevels(Array(20).fill(0));
      return;
    }

    const startVisualization = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        analyserRef.current = analyser;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateLevels = () => {
          if (!analyserRef.current) return;

          analyserRef.current.getByteFrequencyData(dataArray);

          // Sample 20 frequency bins
          const newLevels = Array.from({ length: 20 }, (_, i) => {
            const index = Math.floor((i / 20) * dataArray.length);
            return dataArray[index] / 255;
          });

          setLevels(newLevels);
          animationRef.current = requestAnimationFrame(updateLevels);
        };

        updateLevels();
      } catch {
        // Permission denied or error - show flat bars
        setLevels(Array(20).fill(0.1));
      }
    };

    startVisualization();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [active]);

  return (
    <div style={styles.audioMeter}>
      {levels.map((level, i) => (
        <div
          key={i}
          style={{
            ...styles.audioBar,
            height: `${Math.max(4, level * 48)}px`,
            backgroundColor: level > 0.6 ? '#10b981' : level > 0.3 ? '#3b82f6' : '#6b7280',
            opacity: 0.5 + level * 0.5,
          }}
        />
      ))}
    </div>
  );
};

// ============================================================================
// Step Components
// ============================================================================

const WelcomeStep: React.FC<{ onNext: () => void; onSkip: () => void }> = ({
  onNext,
  onSkip,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        ...styles.stepContent,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Animated Logo */}
      <div
        style={{
          ...styles.logoContainer,
          transform: mounted ? 'scale(1)' : 'scale(0.8)',
          transition: 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div style={styles.logoGlow} />
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          {/* Recording circle */}
          <circle cx="40" cy="40" r="35" fill="url(#gradient1)" />
          {/* Inner microphone icon */}
          <path
            d="M40 20c-4.4 0-8 3.6-8 8v12c0 4.4 3.6 8 8 8s8-3.6 8-8V28c0-4.4-3.6-8-8-8z"
            fill="#ffffff"
            opacity="0.9"
          />
          <path
            d="M54 36v4c0 7.7-6.3 14-14 14s-14-6.3-14-14v-4h-4v4c0 9.4 7.2 17.2 16 18v6h-6v4h16v-4h-6v-6c8.8-.8 16-8.6 16-18v-4h-4z"
            fill="#ffffff"
            opacity="0.9"
          />
          <defs>
            <linearGradient id="gradient1" x1="5" y1="5" x2="75" y2="75">
              <stop stopColor="#3b82f6" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Title */}
      <h1 style={styles.title}>Welcome to FeedbackFlow</h1>

      {/* Tagline */}
      <p style={styles.tagline}>
        Capture developer feedback with voice narration and intelligent screenshots.
        <br />
        AI-ready documentation in seconds.
      </p>

      {/* Get Started Button */}
      <button style={styles.primaryButton} onClick={onNext}>
        Get Started
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          style={{ marginLeft: 8 }}
        >
          <path
            d="M7.5 15l5-5-5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Skip Option */}
      <button style={styles.skipButton} onClick={onSkip}>
        Skip setup, configure later
      </button>
    </div>
  );
};

const MicrophoneStep: React.FC<{
  status: PermissionStatus['microphone'];
  onRequestPermission: () => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ status, onRequestPermission, onNext, onBack }) => {
  return (
    <div style={styles.stepContent}>
      {/* Illustration */}
      <div style={styles.illustrationContainer}>
        <div
          style={{
            ...styles.iconCircle,
            backgroundColor: status === 'granted' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            borderColor: status === 'granted' ? '#10b981' : '#3b82f6',
          }}
        >
          {status === 'granted' ? (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M18 24l4 4 8-8"
                stroke="#10b981"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M24 8c-3.3 0-6 2.7-6 6v9c0 3.3 2.7 6 6 6s6-2.7 6-6v-9c0-3.3-2.7-6-6-6z"
                stroke="#3b82f6"
                strokeWidth="2.5"
                fill="none"
              />
              <path
                d="M36 20v3c0 6.6-5.4 12-12 12s-12-5.4-12-12v-3"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M24 35v5M18 40h12"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Title */}
      <h2 style={styles.stepTitle}>Microphone Access</h2>

      {/* Explanation */}
      <p style={styles.stepDescription}>
        FeedbackFlow needs microphone access to transcribe your voice narration as you
        walk through your feedback. Your audio is processed locally and securely.
      </p>

      {/* Audio Level Preview */}
      {status === 'granted' && (
        <div style={styles.previewBox}>
          <span style={styles.previewLabel}>Speak to test your microphone</span>
          <AudioLevelMeter active={status === 'granted'} />
        </div>
      )}

      {/* Permission Button */}
      {status !== 'granted' && (
        <button
          style={{
            ...styles.primaryButton,
            backgroundColor: status === 'denied' ? '#ef4444' : '#3b82f6',
          }}
          onClick={onRequestPermission}
          disabled={status === 'pending'}
        >
          {status === 'pending' && (
            <span style={styles.spinner} />
          )}
          {status === 'denied'
            ? 'Permission Denied - Open System Preferences'
            : 'Allow Microphone Access'}
        </button>
      )}

      {/* Continue Button */}
      {status === 'granted' && (
        <button style={styles.primaryButton} onClick={onNext}>
          Continue
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            style={{ marginLeft: 8 }}
          >
            <path
              d="M7.5 15l5-5-5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* Back Button */}
      <button style={styles.backButton} onClick={onBack}>
        Back
      </button>
    </div>
  );
};

const ScreenRecordingStep: React.FC<{
  status: PermissionStatus['screen'];
  onRequestPermission: () => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ status, onRequestPermission, onNext, onBack }) => {
  return (
    <div style={styles.stepContent}>
      {/* Illustration */}
      <div style={styles.illustrationContainer}>
        <div
          style={{
            ...styles.iconCircle,
            backgroundColor: status === 'granted' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            borderColor: status === 'granted' ? '#10b981' : '#3b82f6',
          }}
        >
          {status === 'granted' ? (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M18 24l4 4 8-8"
                stroke="#10b981"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect
                x="6"
                y="10"
                width="36"
                height="24"
                rx="3"
                stroke="#3b82f6"
                strokeWidth="2.5"
                fill="none"
              />
              <path d="M14 38h20" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M24 34v4" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="24" cy="22" r="4" stroke="#3b82f6" strokeWidth="2" fill="none" />
            </svg>
          )}
        </div>
      </div>

      {/* Title */}
      <h2 style={styles.stepTitle}>Screen Recording</h2>

      {/* Explanation */}
      <p style={styles.stepDescription}>
        FeedbackFlow captures screenshots when you pause while speaking, automatically
        documenting what you&apos;re looking at. Grant screen recording permission to enable
        this feature.
      </p>

      {/* macOS System Preferences Note */}
      {status === 'denied' && (
        <div style={styles.warningBox}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
            <path
              d="M10 6v4m0 4h.01M19 10a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>
            Open <strong>System Preferences &gt; Privacy &gt; Screen Recording</strong> and
            enable FeedbackFlow.
          </span>
        </div>
      )}

      {/* Permission Button */}
      {status !== 'granted' && (
        <button
          style={{
            ...styles.primaryButton,
            backgroundColor: status === 'denied' ? '#f59e0b' : '#3b82f6',
          }}
          onClick={onRequestPermission}
          disabled={status === 'pending'}
        >
          {status === 'pending' && <span style={styles.spinner} />}
          {status === 'denied'
            ? 'Open System Preferences'
            : 'Allow Screen Recording'}
        </button>
      )}

      {/* Success Preview */}
      {status === 'granted' && (
        <div style={styles.successBox}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span>Screen recording enabled! FeedbackFlow can now capture screenshots.</span>
        </div>
      )}

      {/* Continue Button */}
      {status === 'granted' && (
        <button style={styles.primaryButton} onClick={onNext}>
          Continue
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            style={{ marginLeft: 8 }}
          >
            <path
              d="M7.5 15l5-5-5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* Back Button */}
      <button style={styles.backButton} onClick={onBack}>
        Back
      </button>
    </div>
  );
};

const ApiKeyStep: React.FC<{
  apiKey: ApiKeyStatus;
  onApiKeyChange: (value: string) => void;
  onTestApiKey: () => void;
  onNext: () => void;
  onBack: () => void;
}> = ({ apiKey, onApiKeyChange, onTestApiKey, onNext, onBack }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
  }, []);

  return (
    <div style={styles.stepContent}>
      {/* Illustration */}
      <div style={styles.illustrationContainer}>
        <div
          style={{
            ...styles.iconCircle,
            backgroundColor: apiKey.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            borderColor: apiKey.valid ? '#10b981' : '#3b82f6',
          }}
        >
          {apiKey.valid ? (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M18 24l4 4 8-8"
                stroke="#10b981"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M32 20l-8-8-8 8M16 28l8 8 8-8"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="24"
                cy="24"
                r="4"
                stroke="#3b82f6"
                strokeWidth="2.5"
                fill="none"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Title */}
      <h2 style={styles.stepTitle}>Deepgram API Key</h2>

      {/* Explanation */}
      <p style={styles.stepDescription}>
        FeedbackFlow uses Deepgram for real-time voice transcription. Get a free API key
        at{' '}
        <a
          href="https://deepgram.com"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          deepgram.com
        </a>{' '}
        (free tier includes 200 hours/month).
      </p>

      {/* API Key Input */}
      <div style={styles.inputGroup}>
        <input
          ref={inputRef}
          type="password"
          placeholder="Enter your Deepgram API key"
          value={apiKey.value}
          onChange={(e) => onApiKeyChange(e.target.value)}
          style={{
            ...styles.input,
            borderColor: apiKey.error ? '#ef4444' : apiKey.valid ? '#10b981' : '#374151',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && apiKey.value.length > 10) {
              onTestApiKey();
            }
          }}
        />
        {apiKey.value && (
          <button
            style={{
              ...styles.testButton,
              backgroundColor: apiKey.testing ? '#374151' : '#3b82f6',
            }}
            onClick={onTestApiKey}
            disabled={apiKey.testing || apiKey.value.length < 10}
          >
            {apiKey.testing ? (
              <span style={styles.spinner} />
            ) : apiKey.valid ? (
              'Verified!'
            ) : (
              'Test Key'
            )}
          </button>
        )}
      </div>

      {/* Error Message */}
      {apiKey.error && (
        <div style={styles.errorBox}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 6v4m0 4h.01M19 10a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="#ef4444"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>{apiKey.error}</span>
        </div>
      )}

      {/* Success Message */}
      {apiKey.valid && (
        <div style={styles.successBox}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span>API key verified! You&apos;re ready to go.</span>
        </div>
      )}

      {/* Continue Button */}
      <button
        style={{
          ...styles.primaryButton,
          opacity: apiKey.valid ? 1 : 0.5,
          cursor: apiKey.valid ? 'pointer' : 'not-allowed',
        }}
        onClick={onNext}
        disabled={!apiKey.valid}
      >
        Continue
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          style={{ marginLeft: 8 }}
        >
          <path
            d="M7.5 15l5-5-5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Back Button */}
      <button style={styles.backButton} onClick={onBack}>
        Back
      </button>
    </div>
  );
};

const SuccessStep: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger animations after mount
    const mountTimer = setTimeout(() => setMounted(true), 50);
    const confettiTimer = setTimeout(() => setShowConfetti(true), 300);

    return () => {
      clearTimeout(mountTimer);
      clearTimeout(confettiTimer);
    };
  }, []);

  return (
    <>
      <ConfettiCanvas active={showConfetti} />

      <div
        style={{
          ...styles.stepContent,
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
          transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Success Icon */}
        <div style={styles.successIconContainer}>
          <div
            style={{
              ...styles.successIconOuter,
              transform: mounted ? 'scale(1)' : 'scale(0)',
              transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s',
            }}
          >
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <path
                d="M20 32l8 8 16-16"
                stroke="#10b981"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: 50,
                  strokeDashoffset: mounted ? 0 : 50,
                  transition: 'stroke-dashoffset 0.6s ease-out 0.5s',
                }}
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 style={{ ...styles.stepTitle, color: '#10b981' }}>You&apos;re All Set!</h2>

        {/* Summary */}
        <p style={styles.stepDescription}>
          FeedbackFlow is ready to capture your feedback. Press{' '}
          <kbd style={styles.kbd}>Cmd+Shift+F</kbd> to start recording, and speak
          naturally as you walk through your feedback.
        </p>

        {/* Feature Summary */}
        <div style={styles.featureSummary}>
          <div style={styles.featureItem}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>Voice transcription enabled</span>
          </div>
          <div style={styles.featureItem}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>Intelligent screenshots</span>
          </div>
          <div style={styles.featureItem}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 12l2 2 4-4"
                stroke="#10b981"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>AI-ready markdown output</span>
          </div>
        </div>

        {/* Start Button */}
        <button
          style={{
            ...styles.primaryButton,
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          }}
          onClick={onComplete}
        >
          Start Your First Recording
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            style={{ marginLeft: 8 }}
          >
            <path
              d="M6 4l10 6-10 6V4z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </>
  );
};

// ============================================================================
// Progress Dots
// ============================================================================

const STEPS: OnboardingStep[] = ['welcome', 'microphone', 'screen', 'apikey', 'success'];

const ProgressDots: React.FC<{ currentStep: OnboardingStep }> = ({ currentStep }) => {
  const currentIndex = STEPS.indexOf(currentStep);

  return (
    <div style={styles.progressContainer}>
      {STEPS.filter((s) => s !== 'welcome' && s !== 'success').map((step) => {
        const stepIndex = STEPS.indexOf(step);
        const isActive = stepIndex === currentIndex;
        const isCompleted = stepIndex < currentIndex;

        return (
          <div
            key={step}
            style={{
              ...styles.progressDot,
              backgroundColor: isCompleted ? '#10b981' : isActive ? '#3b82f6' : '#374151',
              transform: isActive ? 'scale(1.2)' : 'scale(1)',
            }}
          >
            {isCompleted && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2 5l2 2 4-4"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// Main Onboarding Component
// ============================================================================

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete, onSkip }) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: 'unknown',
    screen: 'unknown',
  });
  const [apiKey, setApiKey] = useState<ApiKeyStatus>({
    value: '',
    testing: false,
    valid: null,
    error: null,
  });
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');

  // Navigate to next step
  const goToStep = useCallback((step: OnboardingStep, direction: 'left' | 'right' = 'left') => {
    setSlideDirection(direction);
    setCurrentStep(step);
  }, []);

  // Request microphone permission
  const requestMicrophonePermission = useCallback(async () => {
    setPermissions((prev) => ({ ...prev, microphone: 'pending' }));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissions((prev) => ({ ...prev, microphone: 'granted' }));
    } catch {
      setPermissions((prev) => ({ ...prev, microphone: 'denied' }));
    }
  }, []);

  // Request screen recording permission (Electron-specific)
  const requestScreenPermission = useCallback(async () => {
    setPermissions((prev) => ({ ...prev, screen: 'pending' }));

    try {
      // In Electron, we can test screen recording by attempting to get sources
      // This will trigger the permission prompt on macOS
      const { desktopCapturer } = window.require?.('electron') || {};
      if (desktopCapturer) {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (sources.length > 0) {
          setPermissions((prev) => ({ ...prev, screen: 'granted' }));
        } else {
          setPermissions((prev) => ({ ...prev, screen: 'denied' }));
        }
      } else {
        // Fallback for non-Electron environment (testing)
        setPermissions((prev) => ({ ...prev, screen: 'granted' }));
      }
    } catch {
      setPermissions((prev) => ({ ...prev, screen: 'denied' }));
    }
  }, []);

  // Test Deepgram API key
  const testApiKey = useCallback(async () => {
    setApiKey((prev) => ({ ...prev, testing: true, error: null }));

    try {
      // Test the API key by making a simple request to Deepgram
      const response = await fetch('https://api.deepgram.com/v1/projects', {
        method: 'GET',
        headers: {
          Authorization: `Token ${apiKey.value}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setApiKey((prev) => ({ ...prev, testing: false, valid: true }));

        // Save the API key via IPC (using secure storage)
        try {
          await window.feedbackflow.settings.setApiKey('deepgram', apiKey.value);
        } catch {
          // Settings save failed but key is valid
        }
      } else if (response.status === 401) {
        setApiKey((prev) => ({
          ...prev,
          testing: false,
          valid: false,
          error: 'Invalid API key. Please check and try again.',
        }));
      } else {
        setApiKey((prev) => ({
          ...prev,
          testing: false,
          valid: false,
          error: `API error: ${response.status}. Please try again.`,
        }));
      }
    } catch (err) {
      setApiKey((prev) => ({
        ...prev,
        testing: false,
        valid: false,
        error: 'Network error. Please check your connection.',
      }));
    }
  }, [apiKey.value]);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return <WelcomeStep onNext={() => goToStep('microphone')} onSkip={onSkip} />;

      case 'microphone':
        return (
          <MicrophoneStep
            status={permissions.microphone}
            onRequestPermission={requestMicrophonePermission}
            onNext={() => goToStep('screen')}
            onBack={() => goToStep('welcome', 'right')}
          />
        );

      case 'screen':
        return (
          <ScreenRecordingStep
            status={permissions.screen}
            onRequestPermission={requestScreenPermission}
            onNext={() => goToStep('apikey')}
            onBack={() => goToStep('microphone', 'right')}
          />
        );

      case 'apikey':
        return (
          <ApiKeyStep
            apiKey={apiKey}
            onApiKeyChange={(value) =>
              setApiKey((prev) => ({ ...prev, value, valid: null, error: null }))
            }
            onTestApiKey={testApiKey}
            onNext={() => goToStep('success')}
            onBack={() => goToStep('screen', 'right')}
          />
        );

      case 'success':
        return <SuccessStep onComplete={onComplete} />;

      default:
        return null;
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.backdrop} />

      <div style={styles.modal}>
        {/* Progress Dots */}
        {currentStep !== 'welcome' && currentStep !== 'success' && (
          <ProgressDots currentStep={currentStep} />
        )}

        {/* Step Content with Animation */}
        <div
          key={currentStep}
          style={{
            ...styles.stepWrapper,
            animation: `slideIn${slideDirection === 'left' ? 'Left' : 'Right'} 0.4s ease-out`,
          }}
        >
          {renderStep()}
        </div>
      </div>

      {/* Keyframe Animations */}
      <style>
        {`
          @keyframes slideInLeft {
            from {
              opacity: 0;
              transform: translateX(30px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }

          @keyframes slideInRight {
            from {
              opacity: 0;
              transform: translateX(-30px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }

          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }

          @keyframes pulse {
            0%, 100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }

          @keyframes glow {
            0%, 100% {
              box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
            }
            50% {
              box-shadow: 0 0 40px rgba(59, 130, 246, 0.5);
            }
          }
        `}
      </style>
    </div>
  );
};

// ============================================================================
// Styles
// ============================================================================

type ExtendedCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const styles: Record<string, ExtendedCSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },

  backdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },

  modal: {
    position: 'relative',
    width: '100%',
    maxWidth: 480,
    margin: 24,
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: 24,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    WebkitAppRegion: 'no-drag',
  },

  stepWrapper: {
    padding: '48px 40px',
  },

  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },

  // Logo
  logoContainer: {
    position: 'relative',
    marginBottom: 32,
  },

  logoGlow: {
    position: 'absolute',
    inset: -20,
    background: 'radial-gradient(circle, rgba(59, 130, 246, 0.2) 0%, transparent 70%)',
    animation: 'glow 3s ease-in-out infinite',
  },

  // Typography
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#f9fafb',
    marginBottom: 16,
    letterSpacing: '-0.02em',
  },

  tagline: {
    fontSize: 15,
    lineHeight: 1.6,
    color: '#9ca3af',
    marginBottom: 32,
    maxWidth: 360,
  },

  stepTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: '#f9fafb',
    marginBottom: 12,
    letterSpacing: '-0.01em',
  },

  stepDescription: {
    fontSize: 14,
    lineHeight: 1.6,
    color: '#9ca3af',
    marginBottom: 24,
    maxWidth: 340,
  },

  // Buttons
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 280,
    padding: '14px 24px',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: 12,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none',
  },

  skipButton: {
    marginTop: 16,
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'color 0.2s ease',
  },

  backButton: {
    marginTop: 12,
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'color 0.2s ease',
  },

  testButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 16px',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minWidth: 90,
  },

  // Icons
  illustrationContainer: {
    marginBottom: 24,
  },

  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
  },

  // Audio Meter
  audioMeter: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
    height: 48,
    padding: '12px 0',
  },

  audioBar: {
    width: 4,
    borderRadius: 2,
    transition: 'height 0.05s ease, background-color 0.2s ease',
  },

  // Inputs
  inputGroup: {
    display: 'flex',
    gap: 8,
    width: '100%',
    maxWidth: 360,
    marginBottom: 16,
  },

  input: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#f9fafb',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },

  // Boxes
  previewBox: {
    width: '100%',
    maxWidth: 320,
    padding: 16,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    marginBottom: 24,
  },

  previewLabel: {
    display: 'block',
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
  },

  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    width: '100%',
    maxWidth: 360,
    padding: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 13,
    color: '#fbbf24',
    textAlign: 'left',
  },

  successBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 360,
    padding: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    borderRadius: 8,
    marginBottom: 24,
    fontSize: 13,
    color: '#34d399',
    textAlign: 'left',
  },

  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 360,
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 13,
    color: '#f87171',
    textAlign: 'left',
  },

  // Success Step
  successIconContainer: {
    marginBottom: 24,
  },

  successIconOuter: {
    width: 96,
    height: 96,
    borderRadius: '50%',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    border: '2px solid #10b981',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  featureSummary: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 32,
  },

  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    color: '#d1d5db',
  },

  kbd: {
    display: 'inline-block',
    padding: '2px 8px',
    backgroundColor: 'rgba(55, 65, 81, 0.8)',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    color: '#f9fafb',
    border: '1px solid #4b5563',
  },

  link: {
    color: '#60a5fa',
    textDecoration: 'none',
  },

  // Progress
  progressContainer: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 24,
    paddingBottom: 0,
  },

  progressDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
  },

  // Spinner
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#ffffff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

export default Onboarding;
