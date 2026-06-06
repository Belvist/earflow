import type { IconType } from 'react-icons';
import type { FC, SVGAttributes } from 'react';

/**
 * Shared adapter для корректного использования react-icons в .tsx файлах.
 * Причина: react-icons 5.x объявляет IconType как (props) => ReactNode,
 * но React 18.3 ReactNode несовместим напрямую с JSX.Element.
 * Этот тонкий cast не добавляет runtime-оверхеда.
 */
export type IconComponent = FC<SVGAttributes<SVGElement> & { size?: number | string; color?: string; title?: string }>;

export const asIcon = (I: IconType): IconComponent => I as unknown as IconComponent;
