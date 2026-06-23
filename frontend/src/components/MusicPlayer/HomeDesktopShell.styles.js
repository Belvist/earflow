import styled from 'styled-components';

export const DesktopHomeRoot = styled.div`
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 8px 24px 32px;

  @media (min-width: 1024px) {
    padding: 12px 40px 40px;
  }

  @media (min-width: 1440px) {
    max-width: 1360px;
  }
`;

/** Shared home rail heading — same width/typography as playlist rails */
export const HomeSectionTitle = styled.h2`
  margin: 0;
  font-family: 'Unbounded', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  letter-spacing: -0.02em;

  @media (min-width: 1024px) {
    font-size: 14px;
  }
`;

export const HomeRailSection = styled.section`
  width: 100%;
  margin: 8px 0 28px;
  box-sizing: border-box;
`;

export const CategoryTabs = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 22px;
`;

export const CategoryTab = styled.button`
  border: none;
  border-radius: 999px;
  padding: 10px 18px;
  font-family: 'Unbounded', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
  color: ${(p) => (p.$active ? '#0a0a0a' : 'rgba(255, 255, 255, 0.72)')};
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.06)')};

  &:hover {
    background: ${(p) => (p.$active ? '#fff' : 'rgba(255, 255, 255, 0.1)')};
  }
`;
