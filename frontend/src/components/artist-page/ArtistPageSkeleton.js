import React from 'react';
import styled, { keyframes } from 'styled-components';

const shimmer = keyframes`
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
`;

const SkeletonBase = styled.div`
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 100%
  );
  background-size: 800px 100%;
  animation: ${shimmer} 1.4s linear infinite;
`;

const Section = styled.section`
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 16px 0;
`;

const TitleBar = styled(SkeletonBase)`
  width: 160px;
  height: 26px;
  border-radius: 8px;
  margin-bottom: 18px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 28px 48px minmax(0, 1fr) 60px 40px;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;

  @media (max-width: 520px) {
    grid-template-columns: 22px 44px minmax(0, 1fr) 40px;
    gap: 10px;
    padding: 6px 8px;
  }
`;

const NumCell = styled(SkeletonBase)`
  width: 14px;
  height: 14px;
  border-radius: 4px;
  justify-self: center;
`;

const CoverCell = styled(SkeletonBase)`
  width: 48px;
  height: 48px;
  border-radius: 8px;

  @media (max-width: 520px) {
    width: 44px;
    height: 44px;
    border-radius: 6px;
  }
`;

const TitleCell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const TitleLine = styled(SkeletonBase)`
  width: ${(p) => p.$w || '60%'};
  max-width: 320px;
  height: 14px;
  border-radius: 4px;
`;

const SubLine = styled(SkeletonBase)`
  width: ${(p) => p.$w || '40%'};
  max-width: 220px;
  height: 12px;
  border-radius: 4px;
`;

const MinorCell = styled(SkeletonBase)`
  width: 48px;
  height: 12px;
  border-radius: 4px;

  @media (max-width: 520px) {
    display: none;
  }
`;

const MinorDurCell = styled(SkeletonBase)`
  width: 32px;
  height: 12px;
  border-radius: 4px;
`;

const DiscographyRow = styled.div`
  display: flex;
  gap: 16px;
  overflow: hidden;
`;

const CardSkeleton = styled.div`
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;

  @media (min-width: 1024px) {
    width: 200px;
  }
`;

const CardCover = styled(SkeletonBase)`
  width: 100%;
  padding-top: 100%;
  border-radius: 12px;
`;

const CardTitleLine = styled(SkeletonBase)`
  width: 80%;
  height: 14px;
  border-radius: 4px;
`;

const CardSubLine = styled(SkeletonBase)`
  width: 50%;
  height: 12px;
  border-radius: 4px;
`;

const WIDTHS = ['68%', '44%', '58%', '72%', '52%'];
const SUB_WIDTHS = ['34%', '48%', '28%', '38%', '44%'];

export default function ArtistPageSkeleton() {
    return (
        <>
            <Section>
                <TitleBar />
                {WIDTHS.map((w, i) => (
                    <Row key={`pop-skl-${i}`}>
                        <NumCell />
                        <CoverCell />
                        <TitleCell>
                            <TitleLine $w={w} />
                            <SubLine $w={SUB_WIDTHS[i] || '40%'} />
                        </TitleCell>
                        <MinorCell />
                        <MinorDurCell />
                    </Row>
                ))}
            </Section>

            <Section>
                <TitleBar style={{ width: 200 }} />
                <DiscographyRow>
                    {[0, 1, 2, 3, 4].map((i) => (
                        <CardSkeleton key={`disc-skl-${i}`}>
                            <CardCover />
                            <CardTitleLine />
                            <CardSubLine />
                        </CardSkeleton>
                    ))}
                </DiscographyRow>
            </Section>
        </>
    );
}
