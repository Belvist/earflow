import React, { useCallback, useEffect, useRef } from "react";
import { FaCheck } from "react-icons/fa";
import { useSkin } from "./useSkin";
import styled from "styled-components";
import { asIcon } from "../utils/tsxIcons";

/**
 * SkinPicker — горизонтальная snap-карусель скинов.
 *
 * Принципы:
 *   - CSS scroll-snap + нативный horizontal overflow (touch/wheel работают из коробки);
 *   - колесо мыши без Shift автоматически конвертируется в горизонтальный scroll,
 *     чтобы на десктопе без горизонтального колеса карусель всё равно листалась;
 *   - НИКАКОГО pointer-capture drag — он ломает click на вложенных <button> в разных
 *     браузерах. Лучше потерять drag-to-scroll мышью, но гарантировать клик на выбор.
 *
 * Минимальная поверхность, без внешних carousel-библиотек.
 */

const Scroller = styled.div`
  display: flex;
  gap: 10px;
  padding: 4px 2px 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: 2px;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const SkinCard = styled.button<{
  $active: boolean;
  $bg: string;
  $border: string;
}>`
  flex: 0 0 auto;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px;
  border-radius: 12px;
  border: 0;
  background: ${({ $bg }) => $bg};
  cursor: pointer;
  transition:
    transform 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
  min-width: 88px;
  touch-action: pan-x;
  box-shadow: ${({ $active, $border }) =>
    $active ? `0 6px 18px -12px ${$border}` : "none"};

  &:hover {
    filter: brightness(1.05);
  }

  &:focus-visible {
    outline: 2px solid ${({ $border }) => $border};
    outline-offset: 2px;
  }
`;

const MiniPlayer = styled.div<{ $bg: string; $radius: string }>`
  width: 62px;
  height: 42px;
  border-radius: 7px;
  background: ${({ $bg }) => $bg};
  position: relative;
  overflow: hidden;

  &::after {
    content: "";
    position: absolute;
    bottom: 7px;
    left: 5px;
    right: 5px;
    height: 3px;
    border-radius: ${({ $radius }) => $radius};
    background: rgba(255, 255, 255, 0.12);
  }
`;

const MiniProgress = styled.div<{ $fill: string; $radius: string }>`
  position: absolute;
  bottom: 7px;
  left: 5px;
  width: 62%;
  height: 3px;
  border-radius: ${({ $radius }) => $radius};
  background: ${({ $fill }) => $fill};
  z-index: 1;
`;

const SkinName = styled.span<{ $active: boolean }>`
  font-size: 11px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  color: ${({ $active }) => ($active ? "#fff" : "rgba(255,255,255,0.72)")};
  letter-spacing: 0.02em;
  font-family: "Unbounded", sans-serif;
`;

const ActiveCheck = styled.span<{ $border: string }>`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: ${({ $border }) => $border};
  color: #000;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
`;

const CheckIcon = asIcon(FaCheck);

const SkinPicker: React.FC = () => {
  const { skinId, setSkinId, availableSkins } = useSkin();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const handleCardClick = useCallback(
    (id: string) => {
      setSkinId(id);
    },
    [setSkinId],
  );

  // Desktop UX: конвертируем vertical wheel в horizontal scroll, если нет Shift.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (e.shiftKey) return;
    const absY = Math.abs(e.deltaY);
    const absX = Math.abs(e.deltaX);
    if (absY <= absX) return;
    el.scrollLeft += e.deltaY;
  }, []);

  // Центрируем активную карточку только если она за пределами viewport.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-skin-id="${skinId}"]`);
    if (!target) return;
    const parentRect = el.getBoundingClientRect();
    const childRect = target.getBoundingClientRect();
    const outOfView =
      childRect.left < parentRect.left - 1 ||
      childRect.right > parentRect.right + 1;
    if (!outOfView) return;
    target.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [skinId]);

  return (
    <Scroller
      ref={scrollerRef}
      onWheel={handleWheel}
      role="radiogroup"
      aria-label="Выбор темы"
    >
      {availableSkins.map((s) => {
        const isActive = skinId === s.id;
        const radius =
          s.player.progressBarStyle === "pill"
            ? "999px"
            : s.player.progressBarStyle === "sharp"
              ? "0px"
              : "3px";
        return (
          <SkinCard
            key={s.id}
            type="button"
            data-skin-id={s.id}
            role="radio"
            aria-checked={isActive}
            aria-label={s.name}
            $active={isActive}
            $bg={s.colors.surface}
            $border={s.colors.primary}
            onClick={() => handleCardClick(s.id)}
            style={{ position: "relative" }}
          >
            <MiniPlayer $bg={s.colors.playerBg} $radius={radius}>
              <MiniProgress $fill={s.player.accentGradient} $radius={radius} />
            </MiniPlayer>
            <SkinName $active={isActive}>{s.name}</SkinName>
            {isActive && (
              <ActiveCheck $border={s.colors.primary} aria-hidden="true">
                <CheckIcon />
              </ActiveCheck>
            )}
          </SkinCard>
        );
      })}
    </Scroller>
  );
};

export default SkinPicker;
