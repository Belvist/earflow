import React from 'react';
import styled from 'styled-components';
import { FaUsers } from 'react-icons/fa';

const Page = styled.div`
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: 28px 16px 24px;
  color: rgba(255, 255, 255, 0.9);
  text-align: center;

  @media (min-width: 768px) {
    padding: 40px 24px 32px;
    max-width: 640px;
  }
`;

const IconWrap = styled.div`
  width: 72px;
  height: 72px;
  margin: 0 auto 20px;
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
`;

const Title = styled.h1`
  font-family: 'Unbounded', sans-serif;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
`;

const Lead = styled.p`
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.62);
  margin: 0;
`;

export default function SocialPage() {
  return (
    <Page data-testid="social-page-stub">
      <IconWrap aria-hidden="true">
        <FaUsers size={30} />
      </IconWrap>
      <Title>Соцсеть</Title>
      <Lead>
        Раздел в разработке. Здесь появятся друзья, активность и совместное прослушивание.
      </Lead>
    </Page>
  );
}
