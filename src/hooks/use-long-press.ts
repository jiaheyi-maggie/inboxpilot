import { useCallback, useRef } from 'react';

const LONG_PRESS_DURATION = 300;
const MOVEMENT_THRESHOLD = 10;

/**
 * Hook that detects long-press (300ms) on touch devices and dispatches
 * a synthetic `contextmenu` event on the target element.
 *
 * This makes Radix ContextMenu work on iOS/Android where long-press
 * doesn't natively fire `contextmenu`.
 *
 * Usage: Spread the returned handlers onto the same element that has
 * the Radix ContextMenuTrigger.
 */
export function useLongPress(disabled?: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef<EventTarget | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
    targetRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      // Only activate for touch — desktop uses right-click natively
      if (e.pointerType !== 'touch') return;

      startPosRef.current = { x: e.clientX, y: e.clientY };
      targetRef.current = e.currentTarget;

      const clientX = e.clientX;
      const clientY = e.clientY;
      const target = e.currentTarget;

      timerRef.current = setTimeout(() => {
        // Dispatch synthetic contextmenu event to trigger Radix ContextMenu
        const syntheticEvent = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        });
        target.dispatchEvent(syntheticEvent);
        clear();
      }, LONG_PRESS_DURATION);
    },
    [disabled, clear]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current) return;
      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;
      if (Math.abs(dx) > MOVEMENT_THRESHOLD || Math.abs(dy) > MOVEMENT_THRESHOLD) {
        clear();
      }
    },
    [clear]
  );

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerCancel = useCallback(() => {
    clear();
  }, [clear]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
