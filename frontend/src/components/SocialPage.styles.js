import styled from 'styled-components';

export const Page = styled.div`
  width: 100%;
  max-width: 426px;
  margin: 0 auto;
  padding: 18px 24px 132px;
  color: rgba(255, 255, 255, 0.92);

  @media (min-width: 768px) {
    padding: 28px 24px 56px;
  }

  @media (max-width: 360px) {
    padding-left: 18px;
    padding-right: 18px;
  }
`;

export const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 22px;
`;

export const Title = styled.h1`
  margin: 0;
  font-family: 'Unbounded', sans-serif;
  font-size: 22px;
  line-height: 1.1;
  font-weight: 900;

  @media (min-width: 768px) {
    font-size: 28px;
  }
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const IconButton = styled.button`
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export const ComposeButton = styled.button`
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.88)' : '#ffffff')};
  color: #050505;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  font-family: 'Unbounded', sans-serif;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;

  &:disabled {
    opacity: 0.58;
    cursor: not-allowed;
  }

  @media (max-width: 360px) {
    width: 40px;
    padding: 0;

    span {
      display: none;
    }
  }
`;

export const Composer = styled.form`
  display: grid;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 18px;
`;

export const ComposerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

export const ComposerTitle = styled.div`
  min-width: 0;
  color: rgba(255, 255, 255, 0.88);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 900;
`;

export const CloseComposerButton = styled(IconButton)`
  width: 32px;
  height: 32px;
  color: rgba(255, 255, 255, 0.68);
  background: rgba(0, 0, 0, 0.22);
`;

export const ComposerFields = styled.div`
  display: grid;
  gap: 8px;
`;

export const TitleInput = styled.input`
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.24);
  color: rgba(255, 255, 255, 0.94);
  padding: 11px 12px;
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 700;

  &::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }
`;

export const BodyInput = styled.textarea`
  width: 100%;
  min-width: 0;
  min-height: 84px;
  resize: vertical;
  border: 0;
  outline: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.24);
  color: rgba(255, 255, 255, 0.94);
  padding: 12px;
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  line-height: 1.45;

  &::placeholder {
    color: rgba(255, 255, 255, 0.34);
  }
`;

export const ComposerActions = styled.div`
  display: flex;
  justify-content: flex-end;
`;

export const PublishButton = styled.button`
  min-height: 38px;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #050505;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;

  &:disabled {
    opacity: 0.58;
    cursor: not-allowed;
  }
`;

export const StatusPanel = styled.div`
  padding: 16px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.58);
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
`;

export const ErrorPanel = styled(StatusPanel)`
  color: rgba(255, 205, 205, 0.9);
  background: rgba(255, 68, 68, 0.08);
  border-color: rgba(255, 68, 68, 0.2);
  margin-bottom: 14px;
`;

export const Feed = styled.div`
  display: grid;
  gap: 28px;
`;

export const Post = styled.article`
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  column-gap: 12px;
  row-gap: 8px;

  @media (max-width: 360px) {
    grid-template-columns: 48px minmax(0, 1fr);
    column-gap: 10px;
  }
`;

export const PostHeader = styled.div`
  grid-column: 2;
  min-width: 0;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

export const Avatar = styled.div`
  grid-column: 1;
  grid-row: 1;
  align-self: start;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.82);
  font-family: 'Unbounded', sans-serif;
  font-size: 15px;
  font-weight: 900;
  flex-shrink: 0;

  @media (max-width: 360px) {
    width: 48px;
    height: 48px;
    font-size: 13px;
  }
`;

export const AvatarImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

export const AuthorBlock = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 4px;
`;

export const AuthorName = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Unbounded', sans-serif;
  font-size: 14px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.95);
`;

export const AuthorSubtitle = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  line-height: 1.25;
  color: rgba(255, 255, 255, 0.78);
`;

export const Meta = styled.div`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Unbounded', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.38);
`;

export const ContentBubble = styled.div`
  grid-column: 2;
  min-width: 0;
  border-radius: 8px;
  background: #2a2a2a;
  padding: 15px 20px;
  display: grid;
  gap: 8px;

  @media (max-width: 360px) {
    padding: 14px 16px;
  }
`;

export const PostBody = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.92);
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  line-height: 1.34;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

export const PostActions = styled.div`
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ActionButton = styled.button`
  min-height: 24px;
  border: 0;
  border-radius: 999px;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.13)' : 'rgba(255, 255, 255, 0.07)')};
  color: rgba(255, 255, 255, 0.82);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  font-family: 'Unbounded', sans-serif;
  font-size: 9px;
  font-weight: 800;
  cursor: pointer;

  svg {
    color: ${(p) => (p.$active ? '#ff4d5d' : 'rgba(255, 255, 255, 0.78)')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export const PostMenu = styled.div`
  position: relative;
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 2px;
`;

export const PostMenuButton = styled.button`
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.72);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const PostMenuPanel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 4;
  min-width: 132px;
  padding: 6px;
  border-radius: 8px;
  background: #171717;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
`;

export const PostMenuItem = styled.button`
  width: 100%;
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 205, 205, 0.94);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  font-family: 'Unbounded', sans-serif;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;

  svg {
    color: rgba(255, 120, 132, 0.96);
  }

  &:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export const LoadMore = styled.button`
  min-height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.84);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;
