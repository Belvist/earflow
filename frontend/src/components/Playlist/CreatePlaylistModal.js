/**
 * CreatePlaylistModal - Модальное окно создания плейлиста
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes } from 'react-icons/fa';

const Overlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  /* Учитываем плеер-бар снизу */
  padding: 20px;
  padding-bottom: calc(92px + env(safe-area-inset-bottom, 0px));
  
  @media (min-width: 768px) {
    padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px));
  }
`;

const Modal = styled(motion.div)`
  background: #1a1a1a;
  border-radius: 16px;
  width: 100%;
  max-width: 400px;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin: 0;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
  
  &:hover {
    color: white;
  }
`;

const Content = styled.div`
  padding: 20px;
`;

const FormGroup = styled.div`
  margin-bottom: 20px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 8px;
`;

const Input = styled.input`
  width: 100%;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: white;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s;
  
  &:focus {
    border-color: rgba(255, 255, 255, 0.3);
  }
  
  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: white;
  font-size: 14px;
  outline: none;
  resize: vertical;
  min-height: 80px;
  font-family: inherit;
  transition: border-color 0.2s;
  
  &:focus {
    border-color: rgba(255, 255, 255, 0.3);
  }
  
  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }
`;

const Footer = styled.div`
  display: flex;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;

const Button = styled.button`
  flex: 1;
  padding: 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  
  ${props => props.$primary ? `
    background: white;
    border: none;
    color: black;
    
    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.9);
    }
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  ` : `
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    
    &:hover {
      border-color: rgba(255, 255, 255, 0.4);
    }
  `}
`;

const ErrorMessage = styled.div`
  color: #ff6b6b;
  font-size: 13px;
  margin-top: 8px;
`;

const CharCount = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  float: right;
`;

const CreatePlaylistModal = ({
  isOpen,
  onClose,
  onSubmit,
  initialName = '',
  initialDescription = '',
  isEditing = false,
  loading = false
}) => {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState('');

  const inputRef = useRef(null);

  // Фокус на поле ввода при открытии
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Сброс при открытии/закрытии
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setDescription(initialDescription);
      setError('');
    }
  }, [isOpen, initialName, initialDescription]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      setError('Введите название плейлиста');
      return;
    }

    if (trimmedName.length > 100) {
      setError('Название не может превышать 100 символов');
      return;
    }

    if (description.length > 500) {
      setError('Описание не может превышать 500 символов');
      return;
    }

    setError('');

    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim()
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Ошибка при создании плейлиста');
    }
  }, [name, description, onSubmit, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <Overlay
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          onKeyDown={handleKeyDown}
        >
          <Modal
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSubmit}>
              <Header>
                <Title>
                  {isEditing ? 'Редактировать плейлист' : 'Новый плейлист'}
                </Title>
                <CloseButton type="button" onClick={onClose}>
                  <FaTimes />
                </CloseButton>
              </Header>

              <Content>
                <FormGroup>
                  <Label>
                    Название
                    <CharCount>{name.length}/100</CharCount>
                  </Label>
                  <Input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Мой плейлист"
                    maxLength={100}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>
                    Описание (опционально)
                    <CharCount>{description.length}/500</CharCount>
                  </Label>
                  <TextArea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Добавьте описание..."
                    maxLength={500}
                  />
                </FormGroup>

                {error && <ErrorMessage>{error}</ErrorMessage>}
              </Content>

              <Footer>
                <Button type="button" onClick={onClose}>
                  Отмена
                </Button>
                <Button
                  type="submit"
                  $primary
                  disabled={loading || !name.trim()}
                >
                  {loading ? 'Создание...' : (isEditing ? 'Сохранить' : 'Создать')}
                </Button>
              </Footer>
            </form>
          </Modal>
        </Overlay>
      )}
    </AnimatePresence>
  );
};

export default CreatePlaylistModal;
