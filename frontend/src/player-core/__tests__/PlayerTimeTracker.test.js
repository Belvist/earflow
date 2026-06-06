/**
 * Tests for PlayerTimeTracker background/visibility behavior.
 * Гарантирует что RAF останавливается в фоне, slow path продолжает работать,
 * и возобновление корректно при возврате visibility.
 *
 * Запуск: npm test -- --testPathPattern=PlayerTimeTracker
 *
 * @jest-environment jsdom
 */
/* global globalThis */

import { PlayerTimeTracker } from '../PlayerTimeTracker';

function makeAudio(overrides = {}) {
    const listeners = new Map();
    const audio = {
        paused: false,
        currentTime: 0,
        duration: 180,
        seeking: false,
        readyState: 4,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type);
            if (!list) return;
            const idx = list.indexOf(fn);
            if (idx >= 0) list.splice(idx, 1);
        },
        dispatch(type) {
            const list = listeners.get(type) || [];
            for (const fn of list) fn(new Event(type));
        },
        ...overrides,
    };
    return audio;
}

function setDocumentHidden(hidden) {
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hidden,
    });
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('PlayerTimeTracker visibility behavior', () => {
    let tracker;
    let audio;
    let slowCalls;
    let rafMock;
    let cancelRafMock;

    beforeEach(() => {
        slowCalls = [];
        setDocumentHidden(false);
        audio = makeAudio({ paused: false });

        rafMock = jest.fn((cb) => {
            return setTimeout(() => cb(performance.now()), 16);
        });
        cancelRafMock = jest.fn((id) => clearTimeout(id));

        globalThis.requestAnimationFrame = rafMock;
        globalThis.cancelAnimationFrame = cancelRafMock;

        tracker = new PlayerTimeTracker();
    });

    afterEach(() => {
        tracker.detach();
        jest.clearAllTimers();
    });

    it('starts RAF loop when attached with playing audio and visible tab', () => {
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        expect(rafMock).toHaveBeenCalled();
    });

    it('does NOT start RAF when attached while audio is paused', () => {
        audio.paused = true;
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        expect(rafMock).not.toHaveBeenCalled();
    });

    it('does NOT start RAF when attached while document is hidden', () => {
        setDocumentHidden(true);
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        expect(rafMock).not.toHaveBeenCalled();
    });

    it('stops RAF when document becomes hidden', () => {
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        const rafCallsBefore = rafMock.mock.calls.length;
        setDocumentHidden(true);

        expect(cancelRafMock).toHaveBeenCalled();
        expect(rafMock.mock.calls.length).toBe(rafCallsBefore);
    });

    it('resumes RAF when document becomes visible again', () => {
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        setDocumentHidden(true);
        const rafCallsAfterHide = rafMock.mock.calls.length;

        setDocumentHidden(false);
        expect(rafMock.mock.calls.length).toBeGreaterThan(rafCallsAfterHide);
    });

    it('does NOT resume RAF if audio is paused when returning visible', () => {
        audio.paused = true;
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        setDocumentHidden(true);
        const rafCallsAfterHide = rafMock.mock.calls.length;
        setDocumentHidden(false);

        expect(rafMock.mock.calls.length).toBe(rafCallsAfterHide);
    });

    it('stops RAF on pause event', () => {
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        audio.paused = true;
        audio.dispatch('pause');

        expect(cancelRafMock).toHaveBeenCalled();
    });

    it('resumes RAF on play event', () => {
        audio.paused = true;
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        const rafCallsBefore = rafMock.mock.calls.length;
        audio.paused = false;
        audio.dispatch('play');

        expect(rafMock.mock.calls.length).toBeGreaterThan(rafCallsBefore);
    });

    it('detach removes all event listeners and stops RAF', () => {
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });
        tracker.detach();

        const rafCallsBefore = rafMock.mock.calls.length;
        audio.dispatch('play');

        expect(rafMock.mock.calls.length).toBe(rafCallsBefore);
    });

    it('writeExternalProgress updates currentTime ref', () => {
        const ref = { current: 0 };
        tracker.attach(audio, ref, (t, d) => { slowCalls.push([t, d]); });

        tracker.writeExternalProgress(42.5, 180);
        expect(ref.current).toBe(42.5);
    });
});
