import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import Button from './Button';

function safeText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function useOutsideClose({ isOpen, onClose, refs }) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handle = (e) => {
      const target = e && e.target ? e.target : null;
      if (!target) return;

      for (const r of refs) {
        const node = r && r.current ? r.current : null;
        if (node && node.contains(target)) return;
      }
      onClose();
    };

    const handleEsc = (e) => {
      if (e && e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handle, true);
    document.addEventListener('touchstart', handle, true);
    document.addEventListener('keydown', handleEsc, true);

    return () => {
      document.removeEventListener('mousedown', handle, true);
      document.removeEventListener('touchstart', handle, true);
      document.removeEventListener('keydown', handleEsc, true);
    };
  }, [isOpen, onClose, refs]);
}

export default function TrackActionsMenu({
  track,
  busy,
  onEditClick,
  onPublishToggle,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useOutsideClose({
    isOpen: open,
    onClose: () => setOpen(false),
    refs: useMemo(() => [btnRef, menuRef], []),
  });

  const id = safeText(track?.id);
  const isPublished = track?.is_available === true;
  const publishLabel = isPublished ? 'Снять с публикации' : 'Опубликовать';
  const title = safeText(track?.title).trim() || 'трек';

  const handleEdit = () => {
    setOpen(false);
    if (typeof onEditClick === 'function') onEditClick(track);
  };

  const handlePublishToggle = () => {
    setOpen(false);
    if (typeof onPublishToggle === 'function') onPublishToggle(id, !isPublished);
  };

  const handleDelete = () => {
    setOpen(false);
    if (typeof onDelete !== 'function') return;
    const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Удалить «${title}»? Действие необратимо.`)
      : true;
    if (!confirmed) return;
    onDelete(id);
  };

  return (
    <Wrap>
      <Button
        type="button"
        $size="icon"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Действия с треком"
      >
        ⋯
      </Button>

      {open ? (
        <Menu ref={menuRef} role="menu">
          {typeof onEditClick === 'function' ? (
            <MenuItem
              type="button"
              $size="sm"
              onClick={handleEdit}
              disabled={busy}
              role="menuitem"
            >
              Редактировать
            </MenuItem>
          ) : null}
          <MenuItem
            type="button"
            $size="sm"
            onClick={handlePublishToggle}
            disabled={busy}
            role="menuitem"
          >
            {publishLabel}
          </MenuItem>
          <Divider aria-hidden="true" />
          <DangerItem
            type="button"
            $size="sm"
            onClick={handleDelete}
            disabled={busy}
            role="menuitem"
          >
            Удалить
          </DangerItem>
        </Menu>
      ) : null}
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  display: inline-flex;
  justify-content: flex-end;
`;

const Menu = styled.div`
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 200px;
  padding: 8px;
  border-radius: 14px;
  border: 0;
  background: rgba(20, 20, 20, 0.94);
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 50;
  box-shadow: none;
`;

const MenuItem = styled(Button)`
  width: 100%;
  justify-content: flex-start;
`;

const DangerItem = styled(Button)`
  width: 100%;
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.10);
  border-color: transparent;
  color: rgba(255, 255, 255, 0.82);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.10);
    border-color: transparent;
    color: rgba(255, 255, 255, 0.92);
  }
`;

const Divider = styled.div`
  height: 1px;
  margin: 4px 2px;
  background: rgba(255, 255, 255, 0.08);
`;
