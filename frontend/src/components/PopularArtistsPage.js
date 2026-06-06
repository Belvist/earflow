import React, { useMemo } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { FaChevronLeft } from "react-icons/fa";
import apiClient from "../api/client";
import CachedCoverImage from "./CachedCoverImage";
import { buildArtistPath, resolveArtistPath } from "../utils/artistRoute";
import usePopularArtists from "../hooks/usePopularArtists";

const Page = styled.div`
  min-height: 0;
  background: var(--ef-surface-main, #0d0d0d);
  color: #fff;
  font-family: "Unbounded", sans-serif;
  padding-bottom: 28px;

  @media (min-width: 768px) {
    padding-bottom: 36px;
  }
`;

const Header = styled.div`
  padding: 18px 16px 12px;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const BackButton = styled.button`
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

const Title = styled.h1`
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0;
`;

const Content = styled.div`
  padding: 10px 16px 0;
  max-width: 980px;
  margin: 0 auto;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 14px;
  margin-top: 12px;

  @media (min-width: 520px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (min-width: 768px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  @media (min-width: 1024px) {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  @media (min-width: 1280px) {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
`;

const Card = styled.button`
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-family: "Unbounded", sans-serif;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.2s ease;

  &:hover {
    opacity: 0.9;
  }

  &:active {
    transform: scale(0.99);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.32);
    outline-offset: 4px;
    border-radius: 999px;
  }
`;

const Cover = styled.div`
  width: 100%;
  max-width: 156px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.25s ease;
  }

  ${Card}:hover & img {
    transform: scale(1.045);
  }
`;

const Info = styled.div`
  width: 100%;
  min-width: 0;
  padding: 2px 4px 0;
  text-align: center;
`;

const Name = styled.div`
  font-size: 10px;
  font-weight: 500;
  line-height: 1.25;
  min-height: 25px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: center;

  @media (min-width: 768px) {
    font-size: 11px;
    min-height: 28px;
  }
`;

const LoadMore = styled.button`
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.8);
  font-family: "Unbounded", sans-serif;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

function getArtistPath(item) {
  const pid = item && item.artistPublicId ? String(item.artistPublicId) : "";
  const name = item && item.artistName ? String(item.artistName) : "";
  if (pid) {
    const path = buildArtistPath({ artistPublicId: pid, artistName: name });
    if (path) return path;
  }
  return "";
}

export default function PopularArtistsPage() {
  const navigate = useNavigate();
  const { items, loading, canLoadMore, loadMore } = usePopularArtists({
    limit: 24,
    autoLoad: true,
  });

  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  return (
    <Page>
      <Header>
        <BackButton
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Назад"
        >
          <FaChevronLeft />
        </BackButton>
        <Title>Популярные артисты</Title>
      </Header>

      <Content>
        <Grid>
          {list.map((a) => {
            const cover = a && a.coverUrl ? String(a.coverUrl) : null;
            const path = getArtistPath(a);
            const name = a && a.artistName ? String(a.artistName) : "";
            const pid = a && a.artistPublicId ? String(a.artistPublicId) : "";
            return (
              <Card
                key={`${a.artistPublicId || a.artistName}`}
                type="button"
                onClick={() => {
                  if (pid && path) {
                    navigate(path);
                    return;
                  }
                  if (!name) return;
                  void resolveArtistPath(apiClient, name)
                    .then((resolved) => {
                      if (resolved) {
                        navigate(resolved);
                        return;
                      }
                      if (path) navigate(path);
                    })
                    .catch(() => {
                      if (path) navigate(path);
                    });
                }}
              >
                <Cover>
                  <CachedCoverImage
                    src={cover}
                    fallbackSrc="/logo192.svg"
                    alt=""
                  />
                </Cover>
                <Info>
                  <Name title={a.artistName}>{a.artistName}</Name>
                </Info>
              </Card>
            );
          })}
        </Grid>

        {list.length > 0 ? (
          <LoadMore
            type="button"
            onClick={() => {
              void loadMore();
            }}
            disabled={loading || !canLoadMore}
          >
            {loading ? "Загрузка..." : "Загрузить ещё"}
          </LoadMore>
        ) : null}
      </Content>
    </Page>
  );
}
