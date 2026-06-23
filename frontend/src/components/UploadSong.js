import React, { useState, useRef } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaUpload, FaMusic, FaTimes, FaCheck } from 'react-icons/fa';

const UploadContainer = styled(motion.div)`
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  border-radius: 20px;
  padding: 30px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  
  @media (min-width: 768px) {
    padding: 40px;
  }
`;

const UploadTitle = styled.h3`
  font-size: 20px;
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: 20px;
  color: white;
  
  @media (min-width: 768px) {
    font-size: 24px;
  }
`;

const UploadArea = styled(motion.div)`
  border: 2px dashed rgba(255, 255, 255, 0.3);
  border-radius: 15px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  
  &:hover {
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.05);
  }
  
  &.dragover {
    border-color: #c5c5c5;
    background: rgba(197, 197, 197, 0.1);
  }
  
  &.uploading {
    pointer-events: none;
    opacity: 0.7;
  }
  
  @media (min-width: 768px) {
    padding: 60px 40px;
  }
`;

const UploadIcon = styled.div`
  font-size: 32px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 15px;
  
  @media (min-width: 768px) {
    font-size: 36px;
  }
`;

const UploadText = styled.p`
  color: rgba(255, 255, 255, 0.8);
  font-size: 12.5px;
  margin-bottom: 10px;
  
  @media (min-width: 768px) {
    font-size: 13.5px;
  }
`;

const UploadHint = styled.p`
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  
  @media (min-width: 768px) {
    font-size: 14px;
  }
`;

const FileInput = styled.input`
  display: none;
`;

const ProgressContainer = styled.div`
  margin-top: 20px;
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 10px;
`;

const ProgressFill = styled(motion.div)`
  height: 100%;
  background: linear-gradient(90deg, #c5c5c5, white);
  border-radius: 4px;
  transition: width 0.3s ease;
`;

const ProgressText = styled.p`
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  text-align: center;
`;

const FilePreview = styled.div`
  display: flex;
  align-items: center;
  gap: 15px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 15px;
  margin-top: 15px;
`;

const FileIcon = styled.div`
  width: 50px;
  height: 50px;
  border-radius: 10px;
  background: rgba(197, 197, 197, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: white;
  flex-shrink: 0;
`;

const FileInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const FileName = styled.p`
  color: white;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileSize = styled.p`
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
`;

const RemoveButton = styled.button`
  width: 35px;
  height: 35px;
  border-radius: 50%;
  background: rgba(255, 68, 88, 0.2);
  border: none;
  color: #ff4458;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  flex-shrink: 0;
  
  &:hover {
    background: rgba(255, 68, 88, 0.3);
    transform: scale(1.1);
  }
`;

const SuccessMessage = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(76, 217, 100, 0.2);
  border: 1px solid rgba(76, 217, 100, 0.3);
  border-radius: 12px;
  padding: 15px;
  margin-top: 15px;
  color: #4cd964;
  font-size: 14px;
`;

const ErrorMessage = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 68, 88, 0.2);
  border: 1px solid rgba(255, 68, 88, 0.3);
  border-radius: 12px;
  padding: 15px;
  margin-top: 15px;
  color: #ff4458;
  font-size: 14px;
`;

const UploadSong = ({ onUploadSuccess, onUploadError }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/flac', 'audio/mp3'];
  const maxSize = 50 * 1024 * 1024; // 50MB

  const handleFileSelect = (file) => {
    // Проверка типа
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) {
      setError('Неподдерживаемый формат. Разрешены: MP3, WAV, OGG, M4A, FLAC');
      return;
    }

    // Проверка размера
    if (file.size > maxSize) {
      setError('Файл слишком большой. Максимум 50MB');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setSuccess(false);
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setProgress(0);
    setError(null);
    setSuccess(false);

    try {
      const apiClient = (await import('../api/client')).default;

      const response = await apiClient.uploadSong(selectedFile, (percent) => {
        setProgress(percent);
      });

      setSuccess(true);
      setProgress(100);

      if (onUploadSuccess) {
        onUploadSuccess(response);
      }

      // Очистка через 3 секунды
      setTimeout(() => {
        setSelectedFile(null);
        setSuccess(false);
        setProgress(0);
      }, 3000);

    } catch (err) {
      setError(err.message || 'Ошибка загрузки файла');

      if (onUploadError) {
        onUploadError(err);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setProgress(0);
    setSuccess(false);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <UploadContainer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <UploadTitle>
        <FaUpload style={{ marginRight: '10px' }} />
        Загрузить песню
      </UploadTitle>

      <UploadArea
        className={`${dragOver ? 'dragover' : ''} ${uploading ? 'uploading' : ''}`}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <UploadIcon>
          <FaMusic />
        </UploadIcon>
        <UploadText>
          {uploading ? 'Загрузка...' : 'Нажмите или перетащите файл сюда'}
        </UploadText>
        <UploadHint>
          Поддерживаются: MP3, WAV, OGG, M4A, FLAC (до 50MB)
        </UploadHint>

        <FileInput
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,.ogg,.m4a,.flac,audio/*"
          onChange={handleFileInputChange}
          disabled={uploading}
        />
      </UploadArea>

      {selectedFile && !uploading && !success && (
        <FilePreview>
          <FileIcon>
            <FaMusic />
          </FileIcon>
          <FileInfo>
            <FileName>{selectedFile.name}</FileName>
            <FileSize>{formatFileSize(selectedFile.size)}</FileSize>
          </FileInfo>
          <RemoveButton onClick={handleRemoveFile}>
            <FaTimes />
          </RemoveButton>
        </FilePreview>
      )}

      {uploading && (
        <ProgressContainer>
          <ProgressBar>
            <ProgressFill
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
            />
          </ProgressBar>
          <ProgressText>
            Загрузка: {Math.round(progress)}%
          </ProgressText>
        </ProgressContainer>
      )}

      <AnimatePresence>
        {success && (
          <SuccessMessage
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <FaCheck />
            Песня успешно загружена!
          </SuccessMessage>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <ErrorMessage
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <FaTimes />
            {error}
          </ErrorMessage>
        )}
      </AnimatePresence>

      {selectedFile && !uploading && !success && (
        <motion.button
          onClick={handleUpload}
          style={{
            width: '100%',
            padding: '15px',
            marginTop: '15px',
            borderRadius: '12px',
            border: 'none',
            background: 'rgba(255, 255, 255, 0.9)',
            color: 'black',
            fontSize: '16px',
            fontWeight: '500',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Загрузить
        </motion.button>
      )}
    </UploadContainer>
  );
};

export default UploadSong;
