import {
  canSheetDragDismissFromTarget,
  getScrollTopFromGestureTarget,
  isQueueScrollBlockingSheetDismiss,
} from './sheetScrollHandoff';

describe('sheetScrollHandoff', () => {
  it('returns 0 when target is outside scroll area', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(getScrollTopFromGestureTarget(div)).toBe(0);
    document.body.removeChild(div);
  });

  it('reads scrollTop from nearest queue scroll area', () => {
    const root = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.setAttribute('data-queue-scrollarea', 'true');
    Object.defineProperty(scroll, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(scroll, 'clientHeight', { value: 200, configurable: true });
    scroll.scrollTop = 48;
    const row = document.createElement('button');
    scroll.appendChild(row);
    root.appendChild(scroll);
    document.body.appendChild(root);

    expect(getScrollTopFromGestureTarget(row)).toBe(48);
    expect(canSheetDragDismissFromTarget(row)).toBe(false);

    scroll.scrollTop = 0;
    expect(canSheetDragDismissFromTarget(row)).toBe(true);

    document.body.removeChild(root);
  });

  it('blocks sheet dismiss when queue scroll area is scrolled', () => {
    const scroll = document.createElement('div');
    scroll.setAttribute('data-queue-scrollarea', 'true');
    Object.defineProperty(scroll, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(scroll, 'clientHeight', { value: 200, configurable: true });
    scroll.scrollTop = 40;
    document.body.appendChild(scroll);

    expect(isQueueScrollBlockingSheetDismiss()).toBe(true);

    scroll.scrollTop = 0;
    expect(isQueueScrollBlockingSheetDismiss()).toBe(false);

    document.body.removeChild(scroll);
  });
});
