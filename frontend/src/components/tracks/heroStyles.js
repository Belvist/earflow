import { css } from 'styled-components';
import { HOME_SURFACE_RGB } from '../../styles/homeSurface';

// Общий фон hero-оверлея. Последний стоп — фон страницы (не чистый чёрный),
// чтобы низ hero плавно переходил в серый блок без видимого «стыка».
export const heroOverlayBackground = css`
  background:
    radial-gradient(1300px 460px at 50% 12%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.70) 68%, rgba(0,0,0,0.98) 100%),
    linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.34) 58%, rgba(0,0,0,0.78) 78%, ${HOME_SURFACE_RGB} 100%),
    linear-gradient(90deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 24%, rgba(0,0,0,0) 76%, rgba(0,0,0,0.42) 100%);
`;
