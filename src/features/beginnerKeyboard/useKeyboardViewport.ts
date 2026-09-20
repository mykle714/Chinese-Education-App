/**
 * useKeyboardViewport — where the OS keyboard is, and how tall ours should be.
 *
 * LAYER: client feature hook. The ONE place that knows whether the app is
 * running as a web page or inside a native shell; everything above it consumes a
 * height and a boolean.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 7a (host surface, and the Capacitor decision).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ WHY THIS IS AN ADAPTER AND NOT A `visualViewport` READ
 *
 * § 7a settled that the keyboard is app-wide: any focused field raises the OS
 * keyboard, and a bar above it offers the swap. On the web that bar is a DOM
 * element positioned over the page, and the only way to know where the OS
 * keyboard is is to watch `window.visualViewport` shrink — an inference, not a
 * fact, and one that reports nothing on a desktop browser with a hardware
 * keyboard.
 *
 * Under Capacitor the same question has a real answer: `keyboardWillShow`
 * carries `keyboardHeight` before the animation runs. The two paths are
 * genuinely different sources of truth, so they are two implementations behind
 * one shape rather than one function full of branches.
 *
 * ⚠️ CAPACITOR IS NOT INSTALLED YET. The native path is written against the
 * documented `@capacitor/keyboard` events but is reached through a runtime probe
 * rather than an import, so this file compiles and runs today on the web path.
 * When Capacitor is adopted, replace `readNativeKeyboard` with the real plugin
 * import — the rest of the hook does not change.
 */
import { useEffect, useState } from 'react';

/** Fallback keyboard height when nothing can be measured (desktop, or first paint). */
const DEFAULT_HEIGHT = 320;

/** Below this, a viewport shrink is a URL bar or a scroll, not a keyboard. */
const MIN_KEYBOARD_HEIGHT = 120;

export interface KeyboardViewport {
  /** How tall our keyboard should be — the OS keyboard's height when known. */
  height: number;
  /** True when the OS keyboard is (or would be) up. */
  osKeyboardVisible: boolean;
  /** True when running inside a native shell that reports keyboard geometry. */
  native: boolean;
}

/**
 * Probe for a Capacitor keyboard plugin without importing it.
 *
 * A static import would fail the build until the dependency is added, and an
 * optional dependency would still have to be resolved at bundle time. The plugin
 * registers itself on `window.Capacitor.Plugins`, so a property read is enough
 * and costs nothing on the web.
 */
function readNativeKeyboard(): {
  addListener: (event: string, handler: (info: { keyboardHeight?: number }) => void) => Promise<{ remove: () => void }>;
} | null {
  const capacitor = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
  }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  const plugin = capacitor.Plugins?.Keyboard;
  if (!plugin || typeof (plugin as { addListener?: unknown }).addListener !== 'function') return null;
  return plugin as ReturnType<typeof readNativeKeyboard>;
}

export function useKeyboardViewport(): KeyboardViewport {
  const [state, setState] = useState<KeyboardViewport>(() => ({
    height: DEFAULT_HEIGHT,
    osKeyboardVisible: false,
    native: false,
  }));

  useEffect(() => {
    const native = readNativeKeyboard();

    if (native) {
      // ── Native path: the shell tells us, before the animation.
      let disposers: (() => void)[] = [];
      let live = true;

      const attach = async () => {
        const show = await native.addListener('keyboardWillShow', (info) => {
          setState({
            // The plugin reports 0 on some hardware-keyboard configurations;
            // falling back keeps our surface from collapsing to nothing.
            height: info.keyboardHeight && info.keyboardHeight > 0 ? info.keyboardHeight : DEFAULT_HEIGHT,
            osKeyboardVisible: true,
            native: true,
          });
        });
        const hide = await native.addListener('keyboardWillHide', () => {
          setState((current) => ({ ...current, osKeyboardVisible: false }));
        });
        if (!live) {
          // The effect was torn down while the listeners were still resolving.
          show.remove();
          hide.remove();
          return;
        }
        disposers = [show.remove.bind(show), hide.remove.bind(hide)];
      };
      void attach();

      return () => {
        live = false;
        disposers.forEach((remove) => remove());
      };
    }

    // ── Web path: infer from how much of the visual viewport went missing.
    const viewport = window.visualViewport;
    if (!viewport) {
      setState({ height: DEFAULT_HEIGHT, osKeyboardVisible: false, native: false });
      return;
    }

    const measure = () => {
      // `innerHeight` is the layout viewport, which the OS keyboard does NOT
      // shrink; `visualViewport.height` is what remains visible. The difference
      // is the keyboard, plus whatever the browser chrome is doing — hence the
      // threshold, which keeps a collapsing URL bar from reading as a keyboard.
      const occluded = window.innerHeight - viewport.height - viewport.offsetTop;
      const visible = occluded > MIN_KEYBOARD_HEIGHT;
      setState({
        height: visible ? occluded : DEFAULT_HEIGHT,
        osKeyboardVisible: visible,
        native: false,
      });
    };

    measure();
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);

  return state;
}
