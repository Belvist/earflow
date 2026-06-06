// Медиа запросы для адаптивного дизайна
import styled from 'styled-components';

const breakpoints = {
  mobile: '480px',
  tablet: '768px',
  laptop: '1024px',
  desktop: '1440px',
  large: '1920px',
};

// Адаптивный контейнер
export const ResponsiveContainer = styled.div`
  width: 100%;
  max-width: 1450px;
  margin: 0 auto;
  padding: 0 20px;

  @media (max-width: ${breakpoints.mobile}) {
    padding: 0 12px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    padding: 0 14px;
  }
`;

// Адаптивная сетка
export const ResponsiveGrid = styled.div`
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));

  @media (max-width: ${breakpoints.mobile}) {
    grid-template-columns: 1fr;
    gap: 15px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 18px;
  }

  @media (max-width: ${breakpoints.laptop}) {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }
`;

// Адаптивный текст
export const ResponsiveText = styled.span`
  font-size: 13px;

  @media (max-width: ${breakpoints.mobile}) {
    font-size: 11.5px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    font-size: 12px;
  }

  @media (max-width: ${breakpoints.laptop}) {
    font-size: 12.5px;
  }

  @media (max-width: ${breakpoints.desktop}) {
    font-size: 13px;
  }
`;

export const ResponsiveTitle = styled.h1`
  font-size: 34px;
  font-weight: 700;

  @media (max-width: ${breakpoints.mobile}) {
    font-size: 20px;
    font-weight: 600;
  }

  @media (max-width: ${breakpoints.tablet}) {
    font-size: 24px;
    font-weight: 650;
  }

  @media (max-width: ${breakpoints.laptop}) {
    font-size: 30px;
  }

  @media (max-width: ${breakpoints.desktop}) {
    font-size: 34px;
  }
`;

export const ResponsiveSubtitle = styled.h2`
  font-size: 18px;
  font-weight: 500;

  @media (max-width: ${breakpoints.mobile}) {
    font-size: 15px;
    font-weight: 400;
  }

  @media (max-width: ${breakpoints.tablet}) {
    font-size: 17px;
    font-weight: 450;
  }

  @media (max-width: ${breakpoints.laptop}) {
    font-size: 17px;
  }

  @media (max-width: ${breakpoints.desktop}) {
    font-size: 18px;
  }
`;

// Адаптивные отступы
export const ResponsivePadding = styled.div`
  padding: 40px;

  @media (max-width: ${breakpoints.mobile}) {
    padding: 14px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    padding: 22px;
  }

  @media (max-width: ${breakpoints.laptop}) {
    padding: 35px;
  }
`;

export const ResponsiveMargin = styled.div`
  margin: 40px;

  @media (max-width: ${breakpoints.mobile}) {
    margin: 14px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    margin: 22px;
  }

  @media (max-width: ${breakpoints.laptop}) {
    margin: 35px;
  }
`;

// Адаптивные кнопки
// Note: min-height 44px сохраняется для touch target (Apple HIG).
export const ResponsiveButton = styled.button`
  padding: 15px 30px;
  font-size: 16px;
  border-radius: 12px;
  min-height: 44px;

  @media (max-width: ${breakpoints.mobile}) {
    padding: 10px 18px;
    font-size: 13px;
    border-radius: 10px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    padding: 12px 22px;
    font-size: 14px;
    border-radius: 11px;
  }
`;

// Адаптивные карточки
export const ResponsiveCard = styled.div`
  padding: 30px;
  border-radius: 20px;

  @media (max-width: ${breakpoints.mobile}) {
    padding: 14px;
    border-radius: 14px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    padding: 20px;
    border-radius: 16px;
  }
`;

// Адаптивный плеер
export const ResponsivePlayer = styled.div`
  width: 100%;
  max-width: 500px;
  padding: 40px;

  @media (max-width: ${breakpoints.mobile}) {
    padding: 16px;
    max-width: 100%;
  }

  @media (max-width: ${breakpoints.tablet}) {
    padding: 26px;
    max-width: 450px;
  }
`;

// Адаптивная обложка альбома
export const ResponsiveAlbumArt = styled.div`
  width: 300px;
  height: 300px;

  @media (max-width: ${breakpoints.mobile}) {
    width: 250px;
    height: 250px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    width: 280px;
    height: 280px;
  }

  @media (max-width: ${breakpoints.laptop}) {
    width: 290px;
    height: 290px;
  }
`;

// Адаптивная сетка треков
export const ResponsiveTrackGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;

  @media (max-width: ${breakpoints.mobile}) {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 14px;
  }

  @media (max-width: ${breakpoints.laptop}) {
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  }
`;

// Адаптивный плейлист
export const ResponsivePlaylist = styled.div`
  min-width: 350px;

  @media (max-width: ${breakpoints.mobile}) {
    min-width: 100%;
  }

  @media (max-width: ${breakpoints.tablet}) {
    min-width: 300px;
  }
`;

// Адаптивные контролы
export const ResponsiveControls = styled.div`
  display: flex;
  gap: 20px;

  @media (max-width: ${breakpoints.mobile}) {
    gap: 10px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    gap: 14px;
  }
`;

// Скрытие элементов на разных экранах
export const HideOnMobile = styled.div`
  display: block;

  @media (max-width: ${breakpoints.mobile}) {
    display: none;
  }
`;

export const HideOnTablet = styled.div`
  display: block;

  @media (max-width: ${breakpoints.tablet}) {
    display: none;
  }
`;

export const HideOnDesktop = styled.div`
  display: none;

  @media (max-width: ${breakpoints.desktop}) {
    display: block;
  }
`;

export const ShowOnlyMobile = styled.div`
  display: none;

  @media (max-width: ${breakpoints.mobile}) {
    display: block;
  }
`;

export const ShowOnlyTablet = styled.div`
  display: none;

  @media (max-width: ${breakpoints.tablet}) {
    display: block;
  }
`;

// Адаптивная навигация
export const ResponsiveNav = styled.nav`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;

  @media (max-width: ${breakpoints.mobile}) {
    flex-direction: column;
    gap: 15px;
    padding: 15px;
  }
`;

// Адаптивный футер
export const ResponsiveFooter = styled.footer`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 30px;
  padding: 40px;

  @media (max-width: ${breakpoints.mobile}) {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 20px;
  }

  @media (max-width: ${breakpoints.tablet}) {
    grid-template-columns: repeat(2, 1fr);
    gap: 25px;
    padding: 30px;
  }
`;

export default {
  breakpoints,
  ResponsiveContainer,
  ResponsiveGrid,
  ResponsiveText,
  ResponsiveTitle,
  ResponsiveSubtitle,
  ResponsivePadding,
  ResponsiveMargin,
  ResponsiveButton,
  ResponsiveCard,
  ResponsivePlayer,
  ResponsiveAlbumArt,
  ResponsiveTrackGrid,
  ResponsivePlaylist,
  ResponsiveControls,
  HideOnMobile,
  HideOnTablet,
  HideOnDesktop,
  ShowOnlyMobile,
  ShowOnlyTablet,
  ResponsiveNav,
  ResponsiveFooter,
};
