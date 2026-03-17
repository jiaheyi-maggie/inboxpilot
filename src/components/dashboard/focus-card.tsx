'use client';

import { useCallback, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Paperclip,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from './category-badge';
import type { EmailWithCategory } from '@/types';

// ── Swipe direction detection ──

type SwipeDirection = 'right' | 'left' | 'up' | null;

interface PointerState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  pointerId: number;
  active: boolean;
}

const SWIPE_THRESHOLD = 100;
const MAX_ROTATION_DEG = 12;
const DISMISS_TRANSLATE = 600;

// ── Props ──

interface FocusCardProps {
  email: EmailWithCategory;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  onSwipeUp: () => void;
  onTap: () => void;
  /** Account color for multi-inbox dot indicator */
  accountColor?: string;
  /** Whether this card is the "peek" card behind the active one */
  isPeek?: boolean;
}

export function FocusCard({
  email,
  onSwipeRight,
  onSwipeLeft,
  onSwipeUp,
  onTap,
  accountColor,
  isPeek = false,
}: FocusCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const [deltaX, setDeltaX] = useState(0);
  const [deltaY, setDeltaY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dismissing, setDismissing] = useState<SwipeDirection>(null);
  const didDragRef = useRef(false);

  const relativeTime = email.received_at
    ? formatDistanceToNow(new Date(email.received_at), { addSuffix: true })
    : '';

  // ── Pointer event handlers ──

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return; // left click only
    pointerRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      pointerId: e.pointerId,
      active: true,
    };
    didDragRef.current = false;
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const p = pointerRef.current;
    if (!p || !p.active) return;

    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    p.currentX = e.clientX;
    p.currentY = e.clientY;

    // Only count as drag if moved at least 5px (prevents accidental drags on tap)
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      didDragRef.current = true;
    }

    setDeltaX(dx);
    // Only track upward movement for swipe-up
    setDeltaY(Math.min(0, dy));
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const p = pointerRef.current;
      if (!p || !p.active) return;
      p.active = false;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;

      // Determine if any threshold was reached
      let direction: SwipeDirection = null;
      if (Math.abs(dy) > SWIPE_THRESHOLD && dy < 0 && Math.abs(dy) > Math.abs(dx)) {
        direction = 'up';
      } else if (dx > SWIPE_THRESHOLD) {
        direction = 'right';
      } else if (dx < -SWIPE_THRESHOLD) {
        direction = 'left';
      }

      if (direction) {
        // Animate card out, then fire callback
        setDismissing(direction);
        setTimeout(() => {
          switch (direction) {
            case 'right':
              onSwipeRight();
              break;
            case 'left':
              onSwipeLeft();
              break;
            case 'up':
              onSwipeUp();
              break;
          }
          // Reset state after callback (parent will re-render with next card)
          setDismissing(null);
          setDeltaX(0);
          setDeltaY(0);
          setIsDragging(false);
        }, 250);
      } else {
        // Snap back
        setDeltaX(0);
        setDeltaY(0);
        setIsDragging(false);

        // If the user didn't drag significantly, treat it as a tap
        if (!didDragRef.current) {
          onTap();
        }
      }

      pointerRef.current = null;
    },
    [onSwipeRight, onSwipeLeft, onSwipeUp, onTap]
  );

  // ── Compute card transform ──

  const getTransformStyle = (): React.CSSProperties => {
    if (isPeek) {
      return {
        transform: 'scale(0.95) translateY(16px)',
        opacity: 0.5,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        pointerEvents: 'none' as const,
      };
    }

    if (dismissing) {
      const tx =
        dismissing === 'right'
          ? DISMISS_TRANSLATE
          : dismissing === 'left'
            ? -DISMISS_TRANSLATE
            : 0;
      const ty = dismissing === 'up' ? -DISMISS_TRANSLATE : 0;
      const rotate =
        dismissing === 'right'
          ? MAX_ROTATION_DEG
          : dismissing === 'left'
            ? -MAX_ROTATION_DEG
            : 0;
      return {
        transform: `translateX(${tx}px) translateY(${ty}px) rotate(${rotate}deg)`,
        opacity: 0,
        transition: 'transform 0.25s ease-out, opacity 0.25s ease-out',
        pointerEvents: 'none' as const,
      };
    }

    if (isDragging) {
      const rotation = (deltaX / SWIPE_THRESHOLD) * MAX_ROTATION_DEG;
      const clampedRotation = Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, rotation));
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const opacity = Math.max(0.3, 1 - distance / (SWIPE_THRESHOLD * 4));
      return {
        transform: `translateX(${deltaX}px) translateY(${deltaY}px) rotate(${clampedRotation}deg)`,
        opacity,
        transition: 'none',
        cursor: 'grabbing',
      };
    }

    return {
      transform: 'translateX(0) translateY(0) rotate(0deg)',
      opacity: 1,
      transition: 'transform 0.3s ease, opacity 0.3s ease',
      cursor: 'grab',
    };
  };

  // ── Swipe direction indicator labels ──

  const swipeIndicator = (): React.ReactNode => {
    if (!isDragging || dismissing) return null;

    const absDx = Math.abs(deltaX);
    const absDy = Math.abs(deltaY);

    if (absDy > 30 && deltaY < 0 && absDy > absDx) {
      const progress = Math.min(1, absDy / SWIPE_THRESHOLD);
      return (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-700 bg-amber-100 border border-amber-300"
          style={{ opacity: progress }}
        >
          Star
        </div>
      );
    }
    if (deltaX > 30) {
      const progress = Math.min(1, deltaX / SWIPE_THRESHOLD);
      return (
        <div
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-sm font-semibold text-green-700 bg-green-100 border border-green-300"
          style={{ opacity: progress }}
        >
          Archive
        </div>
      );
    }
    if (deltaX < -30) {
      const progress = Math.min(1, absDx / SWIPE_THRESHOLD);
      return (
        <div
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground bg-muted border border-border"
          style={{ opacity: progress }}
        >
          Skip
        </div>
      );
    }

    return null;
  };

  // ── Importance badge ──

  const importanceBadge = (): React.ReactNode => {
    switch (email.importance_label) {
      case 'critical':
        return (
          <Badge variant="critical">
            <ChevronsUp className="h-3 w-3" /> Critical
          </Badge>
        );
      case 'high':
        return (
          <Badge variant="high">
            <ChevronUp className="h-3 w-3" /> High
          </Badge>
        );
      case 'medium':
        return (
          <Badge variant="secondary">
            Medium
          </Badge>
        );
      case 'low':
        return (
          <Badge variant="low">
            <ChevronDown className="h-3 w-3" /> Low
          </Badge>
        );
      case 'noise':
        return (
          <Badge variant="noise">
            <ChevronsDown className="h-3 w-3" /> Noise
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={cardRef}
      className="absolute inset-0 select-none"
      style={{
        touchAction: 'none',
        ...getTransformStyle(),
        willChange: isDragging ? 'transform, opacity' : 'auto',
      }}
      onPointerDown={isPeek ? undefined : handlePointerDown}
      onPointerMove={isPeek ? undefined : handlePointerMove}
      onPointerUp={isPeek ? undefined : handlePointerUp}
    >
      <div className="h-full rounded-2xl border border-border bg-card shadow-lg p-6 sm:p-8 flex flex-col relative overflow-hidden">
        {/* Swipe indicator overlays */}
        {swipeIndicator()}

        {/* Top row: sender + time */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Sender avatar */}
            <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-base font-semibold text-primary flex-shrink-0">
              {(email.sender_name ?? email.sender_email ?? '?')[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {accountColor && (
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: accountColor }}
                    aria-hidden="true"
                  />
                )}
                <span className="text-base font-semibold text-foreground truncate">
                  {email.sender_name || email.sender_email || 'Unknown'}
                </span>
              </div>
              {email.sender_name && email.sender_email && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {email.sender_email}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {email.is_starred && (
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            )}
            {email.has_attachment && (
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {relativeTime}
            </span>
          </div>
        </div>

        {/* Subject */}
        <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-tight mt-5">
          {email.subject || '(no subject)'}
        </h2>

        {/* Snippet */}
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mt-3 line-clamp-3 flex-1">
          {email.snippet || 'No preview available'}
        </p>

        {/* Badges row */}
        <div className="flex items-center flex-wrap gap-2 mt-5">
          {importanceBadge()}
          {email.category && <CategoryBadge category={email.category} />}
          {email.topic && (
            <span className="text-xs text-muted-foreground">
              {email.topic}
            </span>
          )}
        </div>

        {/* Unread indicator */}
        {!email.is_read && (
          <div className="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-2xl" />
        )}
      </div>
    </div>
  );
}
