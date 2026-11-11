import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { projectEndBeat } from '../music/project';
import { LABEL_WIDTH, useClockStore, useViewStore } from '../state/clock';
import { useAppStore } from '../state/store';
import { MAX_ZOOM, MIN_ZOOM } from '../storage/preferences';
import { clamp } from '../util';

/** Extra width drawn beyond each side of the viewport, and how far scrolling goes before redrawing it. */
export const OVERSCAN = 900;
export const WINDOW_STEP = 300;
const USER_SCROLL_HOLD_MS = 2500;

/**
 * Everything about where the timeline is looking: its measured size, the stretch of it
 * that is drawn, zooming around the pointer, and keeping the cursor in view. `dragRef`
 * holds a gesture while one is under way, so the view does not move beneath the pointer.
 */
export function useTimelineView(
  scrollRef: RefObject<HTMLDivElement | null>,
  px: number,
  dragRef: RefObject<unknown>,
) {
  const [viewHeight, setViewHeight] = useState(0);
  const [viewWidth, setViewWidth] = useState(800);
  const [windowStart, setWindowStart] = useState(0);
  const zoomAnchorRef = useRef<{ beat: number; offset: number } | null>(null);
  const followHoldRef = useRef(0);

  // Scroll and size tracking.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = () => {
      setViewHeight(scroll.clientHeight);
      const width = Math.max(120, scroll.clientWidth - LABEL_WIDTH);
      setViewWidth(width);
      useViewStore.setState({ viewWidth: width });
    };
    const onScroll = () => {
      useViewStore.setState({ scrollLeft: scroll.scrollLeft });
      setWindowStart(Math.floor(scroll.scrollLeft / WINDOW_STEP) * WINDOW_STEP);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    measure();
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef]);

  // Ctrl+wheel and pinch zoom around the pointer; a plain wheel scrolls sideways when nothing overflows vertically.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      followHoldRef.current = performance.now() + USER_SCROLL_HOLD_MS;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const { zoom } = useAppStore.getState().preferences;
        useViewStore.getState().navigation?.zoomTo(zoom * Math.exp(-event.deltaY * 0.0022), event.clientX);
      } else if (!event.shiftKey && scroll.scrollHeight <= scroll.clientHeight) {
        event.preventDefault();
        scroll.scrollLeft += event.deltaY;
      }
    };
    scroll.addEventListener('wheel', onWheel, { passive: false });
    return () => scroll.removeEventListener('wheel', onWheel);
  }, [scrollRef]);

  // Keeps the beat under the pointer in place across a zoom.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!scroll || !anchor) return;
    zoomAnchorRef.current = null;
    scroll.scrollLeft = Math.max(0, anchor.beat * px - anchor.offset);
  }, [px, scrollRef]);

  useEffect(() => {
    useViewStore.setState({
      navigation: {
        zoomTo: (next, anchorClientX) => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          const current = useAppStore.getState().preferences.zoom;
          const value = clamp(Math.round(next * 100) / 100, MIN_ZOOM, MAX_ZOOM);
          if (value === current) return;
          const left = scroll.getBoundingClientRect().left + LABEL_WIDTH;
          const offset = anchorClientX !== undefined ? Math.max(0, anchorClientX - left) : scroll.clientWidth / 3;
          zoomAnchorRef.current = { beat: (scroll.scrollLeft + offset) / current, offset };
          useAppStore.getState().setPreferences({ zoom: value });
        },
        zoomToFit: () => {
          const { project: song } = useAppStore.getState();
          const scroll = scrollRef.current;
          if (!scroll) return;
          const width = scroll.clientWidth - LABEL_WIDTH - 24;
          const value = clamp(Math.floor((width / projectEndBeat(song)) * 100) / 100, MIN_ZOOM, MAX_ZOOM);
          zoomAnchorRef.current = { beat: 0, offset: 0 };
          useAppStore.getState().setPreferences({ zoom: value });
          scroll.scrollLeft = 0;
        },
        scrollToBeat: (beat) => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          followHoldRef.current = performance.now() + USER_SCROLL_HOLD_MS;
          scroll.scrollLeft = Math.max(0, beat * useAppStore.getState().preferences.zoom);
        },
      },
    });
  }, [scrollRef]);

  // Keeps the cursor in view. During playback it glides, holding about two thirds across.
  useEffect(() => {
    return useClockStore.subscribe((state) => {
      const scroll = scrollRef.current;
      if (!scroll || dragRef.current || performance.now() < followHoldRef.current) return;
      const width = scroll.clientWidth - LABEL_WIDTH;
      const x = state.playhead * px;
      const left = scroll.scrollLeft;
      if (x < left) scroll.scrollLeft = Math.max(0, x - width * 0.1);
      else if (x > left + width * 0.68) {
        if (useAppStore.getState().isPlaying) scroll.scrollLeft = x - width * 0.68;
        else if (x > left + width) scroll.scrollLeft = x - width * 0.5;
      }
    });
  }, [px, scrollRef, dragRef]);

  return { viewHeight, viewWidth, windowStart };
}
