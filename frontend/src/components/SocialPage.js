import React from 'react';
import { FaHeart, FaPaperPlane, FaPen, FaRegHeart, FaSyncAlt, FaTimes, FaTrash } from 'react-icons/fa';
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
  DeleteButton,
  ErrorPanel,
  Feed,
  HeaderActions,
  IconButton,
  LoadMore,
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

export default function SocialPage() {
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [feed, setFeed] = React.useState({ posts: [], page: { nextCursor: null, hasMore: false } });
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [actionPostId, setActionPostId] = React.useState('');
  const [error, setError] = React.useState('');
  const [composerOpen, setComposerOpen] = React.useState(false);
  const bodyInputRef = React.useRef(null);

  const loadFeed = React.useCallback(async ({ cursor = null, append = false, signal = undefined } = {}) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const data = await apiClient.getSocialFeed({ limit: FEED_LIMIT, cursor, signal });
      const payload = readPostsPayload(data);
      setFeed((current) => ({
        posts: append ? [...current.posts, ...payload.posts] : payload.posts,
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

  const replacePost = React.useCallback((post) => {
    if (!post?.id) return;
    setFeed((current) => ({
      ...current,
      posts: current.posts.map((item) => (item.id === post.id ? post : item)),
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
      await apiClient.createSocialPost({ title, body });
      setTitle('');
      setBody('');
      setComposerOpen(false);
      await loadFeed();
    } catch {
      setError('Не удалось опубликовать пост');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLikeToggle = async (post) => {
    if (!post?.id) return;
    setActionPostId(post.id);
    setError('');
    try {
      const response = post.viewer?.liked
        ? await apiClient.unlikeSocialPost(post.id)
        : await apiClient.likeSocialPost(post.id);
      replacePost(response?.post);
    } catch {
      setError('Не удалось обновить реакцию');
    } finally {
      setActionPostId('');
    }
  };

  const handleDelete = async (post) => {
    if (!post?.id) return;
    setActionPostId(post.id);
    setError('');
    try {
      await apiClient.deleteSocialPost(post.id);
      await loadFeed();
    } catch {
      setError('Не удалось удалить пост');
    } finally {
      setActionPostId('');
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
            onClick={() => loadFeed()}
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
            const busy = actionPostId === post.id;
            const fallbackMeta = [author.handle, post.createdAtLabel].filter(Boolean).join(' · ');
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

                  {viewer.canDelete ? (
                    <DeleteButton
                      type="button"
                      onClick={() => handleDelete(post)}
                      disabled={busy}
                      aria-label="Удалить пост"
                    >
                      <FaTrash size={12} />
                    </DeleteButton>
                  ) : null}
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
