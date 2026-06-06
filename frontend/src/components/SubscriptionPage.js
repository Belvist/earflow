import React, { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { motion } from "framer-motion";
import apiClient from "../api/client";
import { useNavigate } from "react-router-dom";
import { FaCheck, FaCrown, FaMusic, FaArrowLeft } from "react-icons/fa";

const PageContainer = styled.div`
  min-height: 100vh;
  background: var(--color-background, #0a0a0a);
  color: var(--color-text, #fff);
  padding: 16px 12px 140px;
  max-width: 960px;
  margin: 0 auto;

  @media (min-width: 768px) {
    padding: 24px 16px;
  }
`;

const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: var(--color-text-secondary, #b3b3b3);
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 24px;
  padding: 0;

  &:hover {
    color: var(--color-text, #fff);
  }
`;

const PageTitle = styled.h1`
  font-size: 20px;
  font-weight: 800;
  font-family: "Unbounded", sans-serif;
  margin-bottom: 6px;

  @media (min-width: 768px) {
    font-size: 28px;
    margin-bottom: 8px;
  }
`;

const PageSubtitle = styled.p`
  color: var(--color-text-secondary, #b3b3b3);
  font-size: 12px;
  margin-bottom: 20px;

  @media (min-width: 768px) {
    font-size: 15px;
    margin-bottom: 32px;
  }
`;

const PlansGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
`;

const PlanCard = styled(motion.div)`
  background: var(--color-surface, #181818);
  border: 2px solid
    ${({ $active }) =>
      $active
        ? "var(--color-primary, #1db954)"
        : "var(--color-border, #282828)"};
  border-radius: 14px;
  padding: 16px;
  cursor: pointer;
  position: relative;
  overflow: hidden;

  @media (min-width: 768px) {
    border-radius: 16px;
    padding: 24px;
  }

  &:hover {
    border-color: var(--color-primary-hover, #1ed760);
    filter: brightness(1.05);
  }
`;

const PlanBadge = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  background: var(--color-primary, #1db954);
  color: var(--color-on-primary, #000);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 12px;
  text-transform: uppercase;
`;

const PlanName = styled.h3`
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;

  @media (min-width: 768px) {
    font-size: 20px;
  }
`;

const PlanPrice = styled.div`
  font-size: 24px;
  font-weight: 800;
  margin-bottom: 4px;

  @media (min-width: 768px) {
    font-size: 32px;
  }

  span {
    font-size: 12px;
    font-weight: 400;
    color: var(--color-text-secondary, #b3b3b3);

    @media (min-width: 768px) {
      font-size: 14px;
    }
  }
`;

const FeatureList = styled.ul`
  list-style: none;
  padding: 0;
  margin-top: 16px;
`;

const FeatureItem = styled.li`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary, #b3b3b3);
  padding: 3px 0;

  @media (min-width: 768px) {
    font-size: 14px;
    padding: 4px 0;
  }

  svg {
    color: var(--color-primary, #1db954);
    flex-shrink: 0;
  }
`;

const SubscribeButton = styled.button`
  width: 100%;
  margin-top: 20px;
  padding: 12px;
  border-radius: 24px;
  border: none;
  background: ${({ $active }) =>
    $active
      ? "var(--color-surface-hover, #282828)"
      : "var(--color-primary, #1db954)"};
  color: ${({ $active }) =>
    $active ? "var(--color-text, #fff)" : "var(--color-on-primary, #000)"};
  font-size: 14px;
  font-weight: 700;
  cursor: ${({ $active }) => ($active ? "default" : "pointer")};
  transition: all 0.15s;

  &:hover {
    ${({ $active }) =>
      $active ? "" : "background: var(--color-primary-hover, #1ed760);"}
  }
`;

const CurrentBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const SubscriptionPage = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [currentPlan, setCurrentPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.getSubscriptionPlans().catch(() => ({ plans: [] })),
      apiClient.getMySubscription().catch(() => ({ plan: { slug: "free" } })),
    ]).then(([plansRes, subRes]) => {
      if (cancelled) return;
      setPlans(plansRes.plans || []);
      setCurrentPlan(subRes.plan?.slug || "free");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubscribe = useCallback(
    async (slug) => {
      if (slug === currentPlan) return;
      try {
        await apiClient.subscribeToPlan(slug);
        setCurrentPlan(slug);
      } catch {}
    },
    [currentPlan],
  );

  if (loading)
    return (
      <PageContainer>
        <PageTitle>Загрузка...</PageTitle>
      </PageContainer>
    );

  return (
    <PageContainer>
      <BackButton onClick={() => navigate(-1)}>
        <FaArrowLeft /> Назад
      </BackButton>
      <PageTitle>Подписка</PageTitle>
      <PageSubtitle>Выберите план, который подходит вам</PageSubtitle>

      <PlansGrid>
        {plans.map((plan) => {
          const isActive = currentPlan === plan.slug;
          const price = plan.price_cents / 100;
          const features = plan.features || {};
          return (
            <PlanCard
              key={plan.slug}
              $active={isActive}
              whileTap={isActive ? {} : { scale: 0.98 }}
              onClick={() => !isActive && handleSubscribe(plan.slug)}
            >
              {isActive && <PlanBadge>Текущий</PlanBadge>}
              {plan.slug === "artist_pro" && !isActive && (
                <PlanBadge>
                  <FaCrown /> Pro
                </PlanBadge>
              )}
              <PlanName>{plan.name}</PlanName>
              <PlanPrice>
                {price > 0 ? `${price} ₽` : "Бесплатно"}
                {price > 0 && (
                  <span>/{plan.interval === "year" ? "год" : "мес"}</span>
                )}
              </PlanPrice>
              <FeatureList>
                {features.hq_audio && (
                  <FeatureItem>
                    <FaCheck /> Hi-Fi аудио
                  </FeatureItem>
                )}
                {features.offline && (
                  <FeatureItem>
                    <FaCheck /> Оффлайн прослушивание
                  </FeatureItem>
                )}
                {features.artist_portal && (
                  <FeatureItem>
                    <FaCheck /> Артист-портал
                  </FeatureItem>
                )}
                <FeatureItem>
                  <FaMusic /> До {features.max_uploads || 5} загрузок
                </FeatureItem>
                <FeatureItem>
                  <FaMusic /> До {features.max_playlists || 10} плейлистов
                </FeatureItem>
              </FeatureList>
              <SubscribeButton $active={isActive}>
                {isActive ? (
                  <CurrentBadge>
                    <FaCheck /> Активен
                  </CurrentBadge>
                ) : (
                  "Подписаться"
                )}
              </SubscribeButton>
            </PlanCard>
          );
        })}
      </PlansGrid>
    </PageContainer>
  );
};

export default SubscriptionPage;
