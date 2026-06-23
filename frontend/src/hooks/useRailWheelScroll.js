import { useWheelScrollPassthrough } from './useWheelScrollPassthrough';

/** @deprecated alias — use useWheelScrollPassthrough */
export default function useRailWheelScroll(scrollRef) {
  useWheelScrollPassthrough(scrollRef);
}

export { useWheelScrollPassthrough };
