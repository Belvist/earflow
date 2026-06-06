import styled from 'styled-components';

export { CategoryTabs, CategoryTab, HomeSectionTitle } from './HomeDesktopShell.styles';

export const MobileHomeRoot = styled.div`
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 4px 12px 24px;
  box-sizing: border-box;

  @media (min-width: 480px) {
    padding: 8px 14px 28px;
  }
`;
