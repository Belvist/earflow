import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import ArtistReleaseCard from './ArtistReleaseCard';
import useArtistDiscography from './hooks/useArtistDiscography';

const Section = styled.section`
  max-width: 980px;
  margin: 0 auto;
  padding: 16px 10px 0;
  font-family: 'Unbounded', sans-serif;

  @media (min-width: 521px) {
    padding: 40px 16px 0;
  }
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: #fff;

  @media (min-width: 521px) {
    font-size: 22px;
  }
`;

const Tabs = styled.div`
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
`;

const Tab = styled.button`
  background: ${(p) => (p.$active ? '#fff' : 'transparent')};
  color: ${(p) => (p.$active ? '#000' : 'rgba(255,255,255,0.7)')};
  border: none;
  border-radius: 999px;
  padding: 5px 10px;
  font-family: 'Unbounded', sans-serif;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  @media (min-width: 521px) {
    padding: 8px 16px;
    font-size: 12px;
  }

  &:hover:not(:disabled) {
    color: ${(p) => (p.$active ? '#000' : '#fff')};
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;

const NavArrows = styled.div`
  display: inline-flex;
  gap: 8px;

  @media (max-width: 600px) {
    display: none;
  }
`;

const NavButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
    color: #fff;
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;

const ScrollWrap = styled.div`
  position: relative;
`;

const Scroller = styled.div`
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-bottom: 4px;
  touch-action: pan-x;
  overscroll-behavior-x: contain;

  @media (min-width: 521px) {
    gap: 16px;
  }

  &::-webkit-scrollbar { display: none; }
`;

const EmptyState = styled.div`
  padding: 20px 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  font-weight: 600;
`;

const SCROLL_STEP = 220;

export default function ArtistDiscographyTabs({ tracks, onPlayRelease, onOpenRelease }) {
    const discography = useArtistDiscography(tracks);
    const [tab, setTab] = useState('all');
    const scrollerRef = useRef(null);

    const availableTabs = useMemo(() => {
        const base = [{ id: 'all', label: 'Все' }];
        if (discography.hasAlbums) base.push({ id: 'albums', label: 'Альбомы' });
        if (discography.hasSingles) base.push({ id: 'singles', label: 'Синглы и EP' });
        return base;
    }, [discography.hasAlbums, discography.hasSingles]);

    useEffect(() => {
        const isValid = availableTabs.some((t) => t.id === tab);
        if (!isValid) {
            setTab(availableTabs[0] ? availableTabs[0].id : 'all');
        }
    }, [availableTabs, tab]);

    const currentList = useMemo(() => {
        if (tab === 'albums') return discography.albums;
        if (tab === 'singles') return discography.singlesAndEps;
        return discography.all;
    }, [tab, discography]);

    const scrollBy = useCallback((dir) => {
        const el = scrollerRef.current;
        if (!el) return;
        try {
            el.scrollBy({ left: dir * SCROLL_STEP * 2, behavior: 'smooth' });
        } catch {
            el.scrollLeft += dir * SCROLL_STEP * 2;
        }
    }, []);

    if (discography.all.length === 0) return null;

    return (
        <Section>
            <HeaderRow>
                <Title>Дискография</Title>
                <NavArrows>
                    <NavButton
                        type="button"
                        onClick={() => scrollBy(-1)}
                        aria-label="Прокрутить влево"
                    >
                        <FaChevronLeft size={12} />
                    </NavButton>
                    <NavButton
                        type="button"
                        onClick={() => scrollBy(1)}
                        aria-label="Прокрутить вправо"
                    >
                        <FaChevronRight size={12} />
                    </NavButton>
                </NavArrows>
            </HeaderRow>

            <Tabs role="tablist" aria-label="Фильтр дискографии">
                {availableTabs.map((t) => (
                    <Tab
                        key={t.id}
                        id={`discography-tab-${t.id}`}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        aria-controls={`discography-panel-${t.id}`}
                        tabIndex={tab === t.id ? 0 : -1}
                        $active={tab === t.id}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </Tab>
                ))}
            </Tabs>

            <ScrollWrap
                style={{ marginTop: 16 }}
                role="tabpanel"
                id={`discography-panel-${tab}`}
                aria-labelledby={`discography-tab-${tab}`}
            >
                {currentList.length > 0 ? (
                    <Scroller ref={scrollerRef}>
                        {currentList.map((release) => (
                            <ArtistReleaseCard
                                key={release.key}
                                release={release}
                                onPlay={onPlayRelease}
                                onOpen={onOpenRelease}
                            />
                        ))}
                    </Scroller>
                ) : (
                    <EmptyState>Пока нет релизов в этой категории</EmptyState>
                )}
            </ScrollWrap>
        </Section>
    );
}
