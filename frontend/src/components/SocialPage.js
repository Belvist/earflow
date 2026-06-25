import React from 'react';
import { FaEllipsisH, FaHeart, FaPaperPlane, FaPen, FaRegHeart, FaSyncAlt, FaTimes, FaTrash } from 'react-icons/fa';
import apiClient from '../api/client';
import {
  ActionButton,
  AuthorBlock,
  AuthorName,
  AuthorSubtitle,
  Avatar,
  AvatarImage,
  BodyInput,
  CloseComposerButton,
  ComposeButton,
  Composer,
  ComposerActions,
  ComposerFields,
  ComposerHeader,
  ComposerTitle,
  ContentBubble,
  ErrorPanel,
  Feed,
  HeaderActions,
  IconButton,
  LoadMore,
  PostMenu,
  PostMenuButton,
  PostMenuItem,
  PostMenuPanel,
  Meta,
  Page,
  Post,
  PostActions,
  PostBody,
  PostHeader,
  PublishButton,
  StatusPanel,
  TopBar,
  Title,
  TitleInput,
} from './SocialPage.styles';

const FEED_LIMIT = 20;

function readPostsPayload(data) {
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  const page = data?.page && typeof data.page === 'object' ? data.page : {};
  return {
    posts,
    page: {
      nextCursor: page.nextCursor || null,
      hasMore: page.hasMore === true,
    },
  };
}

function mergePrependPosts(incoming, current) {
  const next = [];
  const seen = new Set();
  for (const post of Array.isArray(incoming) ? incoming : []) {
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    next.push(post);
  }
  for (const post of Array.isArray(current) ? current : []) {
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    next.push(post);
  }
  return next;
}

function applyReaction(post, reaction) {
  if (!post?.id || !reaction || String(post.id) !== String(reaction.postId || '')) return post;
  return {
    ...post,
    metrics: {
      ...(post.metrics || {}),
      likes: Number.isFinite(Number(reaction.likes)) && Number(reaction.likes) >= 0 ? Math.floor(Number(reaction.likes)) : 0,
    },
    viewer: {
      ...(post.viewer || {}),
      liked: reaction.liked === true,
    },
  };
}

export default function SocialPage() {
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [feed, setFeed] = React.useState({ posts: [], page: { nextCursor: null, hasMore: false } });
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [busyPostIds, setBusyPostIds] = React.useState(() => new Set());
  const [error, setError] = React.useState('');
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [openMenuPostId, setOpenMenuPostId] = React.useState('');
  const bodyInputRef = React.useRef(null);
  const feedRef = React.useRef(feed);
  const lastAutoRefreshAtRef = React.useRef(0);

  React.useEffect(() => {
    feedRef.current = feed;
  }, [feed]);

  const setPostBusy = React.useCallback((postId, busy) => {
    const id = String(postId || '');
    if (!id) return;
    setBusyPostIds((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const loadFeed = React.useCallback(async ({ cursor = null, append = false, signal = undefined, cache = true } = {}) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const data = await apiClient.getSocialFeed({ limit: FEED_LIMIT, cursor, signal, cache });
      const payload = readPostsPayload(data);
      setFeed((current) => ({
        posts: append ? mergePrependPosts(current.posts, payload.posts) : payload.posts,
        page: payload.page,
      }));
    } catch (e) {
      if (e?.name !== 'AbortError') {
        setError('Не удалось загрузить ленту');
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadFeed({ signal: controller.signal });
    return () => controller.abort();
  }, [loadFeed]);

  React.useEffect(() => {
    if (!composerOpen) return;
    const schedule = typeof window !== 'undefined' && window.requestAnimationFrame
      ? window.requestAnimationFrame
      : (fn) => window.setTimeout(fn, 0);
    const cancel = typeof window !== 'undefined' && window.cancelAnimationFrame
      ? window.cancelAnimationFrame
      : (id) => window.clearTimeout(id);
    const raf = schedule(() => {
      bodyInputRef.current?.focus();
    });
    return () => cancel(raf);
  }, [composerOpen]);

  const refreshNewPosts = React.useCallback(async ({ signal = undefined, silent = false } = {}) => {
    const current = feedRef.current;
    const topPostId = current.posts[0]?.id || '';
    if (!topPostId) {
      await loadFeed({ signal, cache: false });
      return;
    }

    if (!silent) setError('');
    try {
      const data = await apiClient.getSocialFeed({ limit: FEED_LIMIT, after: topPostId, signal, cache: false });
      const payload = readPostsPayload(data);
      if (payload.posts.length > 0) {
        setFeed((latest) => ({
          ...latest,
          posts: mergePrependPosts(payload.posts, latest.posts),
        }));
      }
    } catch (e) {
      if (!silent && e?.name !== 'AbortError') {
        setError('РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ Р»РµРЅС‚Сѓ');
      }
    }
  }, [loadFeed]);

  React.useEffect(() => {
    const maybeRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAutoRefreshAtRef.current < 45000) return;
      lastAutoRefreshAtRef.current = now;
      void refreshNewPosts({ silent: true });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', maybeRefresh);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', maybeRefresh);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', maybeRefresh);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', maybeRefresh);
      }
    };
  }, [refreshNewPosts]);

  const prependPost = React.useCallback((post) => {
    if (!post?.id) return;
    setFeed((current) => ({
      ...current,
      posts: mergePrependPosts([post], current.posts),
    }));
  }, []);

  const updatePostReaction = React.useCallback((reaction) => {
    if (!reaction?.postId) return;
    setFeed((current) => ({
      ...current,
      posts: current.posts.map((item) => applyReaction(item, reaction)),
    }));
  }, []);

  const removePost = React.useCallback((postId) => {
    const id = String(postId || '');
    if (!id) return;
    setFeed((current) => ({
      ...current,
      posts: current.posts.filter((item) => String(item.id) !== id),
    }));
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!body.trim()) {
      setComposerOpen(true);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const response = await apiClient.createSocialPost({ title, body });
      setTitle('');
      setBody('');
      setComposerOpen(false);
      prependPost(response?.post);
    } catch {
      setError('Не удалось опубликовать пост');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLikeToggle = async (post) => {
    if (!post?.id) return;
    setPostBusy(post.id, true);
    setError('');
    try {
      const response = post.viewer?.liked
        ? await apiClient.unlikeSocialPost(post.id)
        : await apiClient.likeSocialPost(post.id);
      updatePostReaction(response?.reaction);
    } catch {
      setError('Не удалось обновить реакцию');
    } finally {
      setPostBusy(post.id, false);
    }
  };

  const handleDelete = async (post) => {
    const canManage = post?.viewer?.canManage === true || post?.viewer?.canDelete === true;
    if (!post?.id || !canManage) return;
    setPostBusy(post.id, true);
    setError('');
    setOpenMenuPostId('');
    try {
      const response = await apiClient.deleteSocialPost(post.id);
      removePost(response?.id || post.id);
    } catch {
      setError('Не удалось удалить пост');
    } finally {
      setPostBusy(post.id, false);
    }
  };

  const posts = feed.posts;
  const initialLoading = loading && posts.length === 0;
  const canPublish = body.trim().length > 0 && !submitting;

  return (
    <Page data-testid="social-page">
      <TopBar>
        <Title>Соцсеть</Title>
        <HeaderActions>
          <IconButton
            type="button"
            aria-label="Обновить ленту"
            title="Обновить"
            onClick={() => refreshNewPosts()}
            disabled={loading || submitting}
          >
            <FaSyncAlt size={14} />
          </IconButton>
          <ComposeButton
            type="button"
            aria-label="Написать пост"
            onClick={() => setComposerOpen(true)}
            disabled={submitting}
            $active={composerOpen}
          >
            <FaPen size={12} />
            <span>Написать</span>
          </ComposeButton>
        </HeaderActions>
      </TopBar>

      {composerOpen ? (
        <Composer onSubmit={handleSubmit} data-testid="social-composer">
          <ComposerHeader>
            <ComposerTitle>Новый пост</ComposerTitle>
            <CloseComposerButton
              type="button"
              aria-label="Закрыть редактор"
              title="Закрыть"
              onClick={() => setComposerOpen(false)}
              disabled={submitting}
            >
              <FaTimes size={13} />
            </CloseComposerButton>
          </ComposerHeader>
          <ComposerFields>
            <TitleInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Заголовок"
              maxLength={120}
            />
            <BodyInput
              ref={bodyInputRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Что слушаешь?"
              maxLength={2000}
            />
          </ComposerFields>
          <ComposerActions>
            <PublishButton type="submit" disabled={!canPublish}>
              <FaPaperPlane size={12} />
              {submitting ? 'Публикуем' : 'Опубликовать'}
            </PublishButton>
          </ComposerActions>
        </Composer>
      ) : null}

      {error ? <ErrorPanel>{error}</ErrorPanel> : null}

      {initialLoading ? <StatusPanel>Загрузка ленты...</StatusPanel> : null}

      {!initialLoading && posts.length === 0 ? (
        <StatusPanel>Постов пока нет</StatusPanel>
      ) : null}

      {posts.length > 0 ? (
        <Feed>
          {posts.map((post) => {
            const author = post.author || {};
            const viewer = post.viewer || {};
            const metrics = post.metrics || {};
            const busy = busyPostIds.has(String(post.id));
            const canManage = viewer.canManage === true || viewer.canDelete === true;
            const menuOpen = openMenuPostId === post.id;
            const fallbackMeta = [post.createdAtLabel].filter(Boolean).join(' · ');
            return (
              <Post key={post.id}>
                <Avatar aria-hidden="true">
                  {author.avatarUrl ? (
                    <AvatarImage src={author.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    author.initials || 'EF'
                  )}
                </Avatar>
                <PostHeader>
                  <AuthorBlock>
                    <AuthorName>{author.displayName || 'Слушатель'}</AuthorName>
                    {post.title ? (
                      <AuthorSubtitle>{post.title}</AuthorSubtitle>
                    ) : fallbackMeta ? (
                      <Meta>{fallbackMeta}</Meta>
                    ) : null}
                  </AuthorBlock>

                  {canManage ? (
                    <PostMenu>
                      <PostMenuButton
                        type="button"
                        aria-label="РЈРїСЂР°РІР»РµРЅРёРµ РїРѕСЃС‚РѕРј"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setOpenMenuPostId(menuOpen ? '' : post.id)}
                        disabled={busy}
                      >
                        <FaEllipsisH size={13} />
                      </PostMenuButton>
                      {menuOpen ? (
                        <PostMenuPanel role="menu">
                          <PostMenuItem
                            type="button"
                            role="menuitem"
                            onClick={() => handleDelete(post)}
                            disabled={busy}
                          >
                            <FaTrash size={12} />
                            <span>РЈРґР°Р»РёС‚СЊ</span>
                          </PostMenuItem>
                        </PostMenuPanel>
                      ) : null}
                    </PostMenu>
                  ) : null}
                </PostHeader>

                <ContentBubble>
                  <PostBody>{post.body}</PostBody>
                </ContentBubble>

                <PostActions>
                  <ActionButton
                    type="button"
                    $active={viewer.liked === true}
                    onClick={() => handleLikeToggle(post)}
                    disabled={busy}
                    aria-label={viewer.liked ? 'Убрать лайк' : 'Поставить лайк'}
                  >
                    {viewer.liked ? <FaHeart size={13} /> : <FaRegHeart size={13} />}
                    {metrics.likes || 0}
                  </ActionButton>

                </PostActions>
              </Post>
            );
          })}

          {feed.page.hasMore ? (
            <LoadMore
              type="button"
              onClick={() => loadFeed({ cursor: feed.page.nextCursor, append: true })}
              disabled={loadingMore}
            >
              {loadingMore ? 'Загрузка...' : 'Показать ещё'}
            </LoadMore>
          ) : null}
        </Feed>
      ) : null}
    </Page>
  );
}
