import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SocialPage from './SocialPage';
import apiClient from '../api/client';

jest.mock('../api/client', () => ({
  getSocialFeed: jest.fn(),
  createSocialPost: jest.fn(),
  likeSocialPost: jest.fn(),
  unlikeSocialPost: jest.fn(),
  deleteSocialPost: jest.fn(),
}));

const makePost = (overrides = {}) => ({
  id: '11',
  title: 'Oil-backed narrative',
  body: 'Limited supply\nTransparent on-chain metrics',
  createdAtLabel: '5 минут назад',
  author: {
    displayName: '$Maduro',
    avatarUrl: null,
    initials: 'MA',
  },
  metrics: {
    likes: 3,
  },
  viewer: {
    liked: false,
    canManage: true,
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders social feed from backend DTO', async () => {
  apiClient.getSocialFeed.mockResolvedValue({
    posts: [makePost()],
    page: { nextCursor: null, hasMore: false },
  });

  render(<SocialPage />);

  expect(await screen.findByText('$Maduro')).toBeTruthy();
  expect(screen.queryByTestId('social-composer')).toBeNull();
  expect(screen.getByText('Oil-backed narrative')).toBeTruthy();
  expect(screen.queryByText('@maduro · 5 минут назад')).toBeNull();
  expect(screen.getByText(/Transparent on-chain metrics/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Поставить лайк' }).textContent).toContain('3');
});

test('replaces post with backend response after like intent', async () => {
  apiClient.getSocialFeed.mockResolvedValue({
    posts: [makePost()],
    page: { nextCursor: null, hasMore: false },
  });
  apiClient.likeSocialPost.mockResolvedValue({ reaction: { postId: '11', liked: true, likes: 4 } });

  render(<SocialPage />);

  const likeButton = await screen.findByRole('button', { name: 'Поставить лайк' });
  fireEvent.click(likeButton);

  await waitFor(() => expect(apiClient.likeSocialPost).toHaveBeenCalledWith('11'));
  expect((await screen.findByRole('button', { name: 'Убрать лайк' })).textContent).toContain('4');
});

test('load more appends older posts after current feed', async () => {
  apiClient.getSocialFeed
    .mockResolvedValueOnce({
      posts: [makePost({ id: '11' })],
      page: { nextCursor: 'cursor-1', hasMore: true },
    })
    .mockResolvedValueOnce({
      posts: [makePost({ id: '10', body: 'Older post' })],
      page: { nextCursor: null, hasMore: false },
    });

  render(<SocialPage />);

  await screen.findByText('$Maduro');
  fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));

  await screen.findByText('Older post');
  expect(apiClient.getSocialFeed).toHaveBeenCalledTimes(2);
  expect(apiClient.getSocialFeed.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-1' });
});

test('creates post from backend response without reloading feed', async () => {
  apiClient.getSocialFeed.mockResolvedValueOnce({ posts: [], page: { nextCursor: null, hasMore: false } });
  apiClient.createSocialPost.mockResolvedValue({ post: makePost({ id: '12', body: 'Fresh post' }) });

  render(<SocialPage />);

  await screen.findByText('Постов пока нет');
  fireEvent.click(screen.getByRole('button', { name: 'Написать пост' }));
  expect(await screen.findByTestId('social-composer')).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText('Заголовок'), { target: { value: 'Launch' } });
  fireEvent.change(screen.getByPlaceholderText('Что слушаешь?'), { target: { value: 'Fresh post' } });
  fireEvent.click(screen.getByRole('button', { name: /Опубликовать/i }));

  await waitFor(() => expect(apiClient.createSocialPost).toHaveBeenCalledWith({
    title: 'Launch',
    body: 'Fresh post',
  }));
  expect(await screen.findByText('Fresh post')).toBeTruthy();
  expect(apiClient.getSocialFeed).toHaveBeenCalledTimes(1);
});
