import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaCircleNotch } from 'react-icons/fa';

import Shell from '../layout/Shell';
import ArtistTopBar from '../components/ArtistTopBar';
import {
  StreamChart,
  TopTracksTable,
  EngagementPanel,
  InteractionBreakdown,
  AnalyticsSummaryStrip,
} from '../components/analytics';
import { useAuth } from '../../state/auth/AuthContext';
import { analyticsUsecase } from '../../usecases/analyticsUsecase';
import { artistPortalUsecase } from '../../usecases/artistPortalUsecase';

const PERIOD_OPTIONS = [
  { value: 7, label: '7 дней' },
  { value: 14, label: '14 дней' },
  { value: 30, label: '30 дней' },
  { value: 60, label: '60 дней' },
  { value: 90, label: '90 дней' },
];

export default function AnalyticsPage() {
  const { portal, logout } = useAuth();
  const nav = useNavigate();

  const [analytics, setAnalytics] = useState(null);
  const [dashMeta, setDashMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const loadData = useCallback(async (periodDays) => {
    setLoading(true);
    setError('');

    const [analyticsRes, dashRes] = await Promise.all([
      analyticsUsecase.loadAnalytics({ days: periodDays, topTracks: 20 }),
      artistPortalUsecase.loadDashboard(),
    ]);

    if (!analyticsRes.ok) {
      if (analyticsRes.error?.type === 'forbidden') {
        nav('/onboarding', { replace: true });
        return;
      }
      if (analyticsRes.error?.type === 'mfa_required') {
        nav('/security/2fa', { replace: true });
        return;
      }
      setError('Не удалось загрузить аналитику');
      setLoading(false);
      return;
    }

    setAnalytics(analyticsRes.data);

    if (dashRes.ok && dashRes.data?.meta) {
      setDashMeta(dashRes.data.meta);
    }

    setLoading(false);
  }, [nav]);

  useEffect(() => {
    void loadData(days);
  }, [days, loadData]);

  const handlePeriodChange = useCallback((e) => {
    const val = parseInt(e.target.value, 10);
    if (PERIOD_OPTIONS.some((o) => o.value === val)) {
      setDays(val);
    }
  }, []);

  const periodLabel = useMemo(() => {
    const opt = PERIOD_OPTIONS.find((o) => o.value === days);
    return opt ? opt.label : `${days} дней`;
  }, [days]);

  return (
    <Shell>
      <ArtistTopBar portal={portal} onLogout={logout} />

      <Main>
        <Wrap>
          <PageHeader>
            <HeaderCopy>
              <BackButton type="button" onClick={() => nav('/')} aria-label="На главную">
                <FaArrowLeft size={12} aria-hidden="true" />
              </BackButton>
              <TitleBlock>
                <Eyebrow>Artist intelligence</Eyebrow>
                <PageTitle>Аналитика</PageTitle>
                <PageSub>Прослушивания, аудитория и вовлечённость в одном рабочем экране</PageSub>
              </TitleBlock>
            </HeaderCopy>

            <PeriodSelector value={days} onChange={handlePeriodChange} aria-label="Период аналитики">
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </PeriodSelector>
          </PageHeader>

          {loading ? (
            <LoadingState>
              <SpinIcon><FaCircleNotch size={20} /></SpinIcon>
              <span>Загрузка аналитики…</span>
            </LoadingState>
          ) : error ? (
            <ErrorState>{error}</ErrorState>
          ) : (
            <ContentGrid>
              <AnalyticsSummaryStrip
                meta={dashMeta}
                dailyTrend={analytics?.dailyTrend}
              />

              <StreamChart
                data={analytics?.dailyTrend}
                periodLabel={periodLabel}
              />

              <BottomGrid>
                <TopTracksTable tracks={analytics?.topTracks} />
                <SideColumn>
                  <EngagementPanel engagement={analytics?.engagement} />
                  <InteractionBreakdown data={analytics?.sourceBreakdown} />
                </SideColumn>
              </BottomGrid>
            </ContentGrid>
          )}
        </Wrap>
      </Main>
    </Shell>
  );
}

const spinAnim = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const Main = styled.main`
  min-height: 100vh;
  padding: 30px 18px 96px;
  background: #000;

  @media (max-width: 720px) {
    padding: 22px 14px 80px;
  }
`;

const Wrap = styled.div`
  width: min(1180px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const PageHeader = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;

  @media (max-width: 720px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const HeaderCopy = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
`;

const BackButton = styled.button`
  appearance: none;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: #111;
  border: 0;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.16s ease;
  flex-shrink: 0;

  &:hover {
    background: #181818;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.55);
    outline-offset: 3px;
  }
`;

const TitleBlock = styled.div`
  min-width: 0;
`;

const Eyebrow = styled.div`
  margin-bottom: 5px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
  line-height: 1;
  text-transform: uppercase;
`;

const PageTitle = styled.h1`
  margin: 0;
  color: #fff;
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 950;
  letter-spacing: -0.065em;
  line-height: 0.92;
`;

const PageSub = styled.div`
  max-width: 560px;
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.52);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.45;
`;

const PeriodSelector = styled.select`
  appearance: none;
  min-width: 120px;
  padding: 11px 16px;
  border-radius: 999px;
  background: #111;
  border: 0;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
  outline: none;
  transition: background-color 0.16s ease;

  &:hover,
  &:focus {
    background-color: #181818;
  }

  option {
    background: #101010;
    color: #fff;
  }
`;

const ContentGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const BottomGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.85fr);
  gap: 18px;
  align-items: start;

  @media (max-width: 1040px) {
    grid-template-columns: 1fr;
  }
`;

const SideColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
`;

const LoadingState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 360px;
  border-radius: 28px;
  background: #080808;
  color: rgba(255, 255, 255, 0.62);
  font-size: 14px;
  font-weight: 750;
`;

const SpinIcon = styled.span`
  display: inline-flex;

  svg {
    animation: ${spinAnim} 0.9s linear infinite;
  }
`;

const ErrorState = styled.div`
  padding: 46px 22px;
  border-radius: 24px;
  background: #080808;
  color: rgba(255, 255, 255, 0.86);
  font-size: 14px;
  font-weight: 700;
  text-align: center;
`;