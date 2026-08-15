import { css } from 'styled-components';
import { HOME_SURFACE_RGB } from '../../styles/homeSurface';

// Общий фон hero-оверлея.
// Верхний слой — непрозрачная маска цвета поверхности по самому низу hero:
// без неё радиальный слой (со стопом rgba(0,0,0,.98)) композитит нижнюю кромку
// hero в чистый чёрный rgb(0,0,0), тогда как список ниже — rgb(13,13,13),
// и между ними виден «стык чёрное/чёрное». Маска делает нижнюю кромку hero
// ровно равной фону страницы, а выше плавно растворяется.
export const heroOverlayBackground = css`
  background:
    linear-gradient(0deg, ${HOME_SURFACE_RGB} 0%, ${HOME_SURFACE_RGB} 10%, rgba(13, 13, 13, 0) 22%),
    radial-gradient(1300px 460px at 50% 12%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.70) 68%, rgba(0,0,0,0.88) 100%),
    linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.34) 58%, rgba(0,0,0,0.62) 78%, ${HOME_SURFACE_RGB} 100%),
    linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 76%, rgba(0,0,0,0.42) 100%);
`;
