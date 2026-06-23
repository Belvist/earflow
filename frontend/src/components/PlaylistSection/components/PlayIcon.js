/**
 * PlayIcon Component
 * SVG иконка воспроизведения
 */

import React from 'react';

const PlayIcon = ({ size = 24, color = 'currentColor', className }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        xmlns="http://www.w3.org/2000/svg"
        className={className}
    >
        <path d="M8 5v14l11-7z" />
    </svg>
);

export default PlayIcon;
