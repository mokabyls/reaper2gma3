import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

class ResizeObserverMock implements ResizeObserver {
    readonly observed = new Set<Element>();

    observe(target: Element) {
        this.observed.add(target);
    }

    unobserve(target: Element) {
        this.observed.delete(target);
    }

    disconnect() {
        this.observed.clear();
    }
}

Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverMock,
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
});

Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
    hasPointerCapture: { configurable: true, value: () => false },
});

Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => undefined,
});
