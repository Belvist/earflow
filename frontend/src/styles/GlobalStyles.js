import { createGlobalStyle } from 'styled-components';

const GlobalStyles = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Unbounded', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background: #000;
    color: #fff;
    overflow-x: hidden;
    font-size: 12.5px;
    line-height: 1.4;
    letter-spacing: 0;
  }

  html {
    scroll-behavior: smooth;
    font-size: 13px;
  }
  
  @media (min-width: 1920px) {
    html {
      font-size: 13px;
    }
  }

  #root {
    min-height: 100vh;
    min-height: calc(var(--app-vh, 1vh) * 100);
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  * {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }
  
  /* Отключаем выделение для интерактивных элементов */
  button, 
  [role="button"],
  .no-select,
  .swipeable,
  .track-card,
  .control-button,
  .player-controls {
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
  }
  
  /* Разрешаем выделение только для текстовых полей */
  input, 
  textarea,
  [contenteditable="true"] {
    user-select: text;
    -webkit-user-select: text;
  }
  
  /* Touch и Mouse свайпы */
  .swipeable {
    touch-action: pan-y;
    cursor: grab;
  }
  
  .swipeable:active {
    cursor: grabbing;
  }

  /* Адаптивность для мобильных устройств */
  @media (max-width: 768px) {
    html {
      font-size: 12px;
    }
    body {
      font-size: 11.5px;
    }
  }
  
  html, body, #root {
    overflow-x: hidden;
    max-width: 100vw;
  }

  /* Стили для скроллбара */
  ::-webkit-scrollbar {
    width: 6px;
  }

  ::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
  }

  ::-webkit-scrollbar-thumb {
    background: rgba(197, 197, 197, 0.3);
    border-radius: 3px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: rgba(197, 197, 197, 0.5);
  }

  /* Анимации */
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes slideIn {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }

  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
  }

  @keyframes rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* Утилитарные классы */
  .fade-in {
    animation: fadeIn 0.6s ease-out;
  }

  .slide-in {
    animation: slideIn 0.4s ease-out;
  }

  .pulse {
    animation: pulse 2s infinite;
  }

  .rotate {
    animation: rotate 20s linear infinite;
  }

  /* Стили для кнопок */
  button {
    font-family: inherit;
    cursor: pointer;
    border: none;
    outline: none;
    transition: all 0.3s ease;
    
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  /* Стили для изображений */
  img {
    max-width: 100%;
    height: auto;
    display: block;
  }

  /* Стили для инпутов */
  input, textarea, select {
    font-family: inherit;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
  }

  /* Стили для ссылок */
  a {
    color: inherit;
    text-decoration: none;
    transition: all 0.3s ease;
  }

  /* Стили для выделения текста */
  ::selection {
    background: rgba(197, 197, 197, 0.3);
  }

  /* Стили для фокуса */
  :focus {
    outline: 2px solid rgba(197, 197, 197, 0.5);
    outline-offset: 2px;
  }

  /* Адаптивный текст */
  .responsive-text {
    font-size: clamp(12px, 2vw, 16px);
  }

  .responsive-title {
    font-size: clamp(22px, 3vw, 34px);
  }

  .responsive-subtitle {
    font-size: clamp(13px, 1.6vw, 18px);
  }

  /* Скрытие элементов для accessibility */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Центрирование */
  .center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .flex-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .text-center {
    text-align: center;
  }

  /* Отступы */
  .no-margin {
    margin: 0 !important;
  }

  .no-padding {
    padding: 0 !important;
  }

  /* Тень */
  .shadow {
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .shadow-lg {
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  }

  /* Градиенты */
  .gradient-text {
    background: linear-gradient(45deg, #fff, #c5c5c5);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .gradient-bg {
    background: linear-gradient(135deg, rgba(197, 197, 197, 0.1), rgba(255, 255, 255, 0.05));
  }

  /* Обрезка текста */
  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .truncate-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .truncate-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Анимация загрузки */
  @keyframes shimmer {
    0% {
      background-position: -1000px 0;
    }
    100% {
      background-position: 1000px 0;
    }
  }

  .shimmer {
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    background-size: 1000px 100%;
    animation: shimmer 2s infinite;
  }

  /* Темная тема по умолчанию */
  @media (prefers-color-scheme: dark) {
    body {
      background: #000;
      color: #fff;
    }
  }

  /* Режим высокой контрастности */
  @media (prefers-contrast: high) {
    * {
      border-color: #fff !important;
    }
    
    button {
      border: 2px solid #fff !important;
    }
  }

  /* Режим сниженной анимации */
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

export default GlobalStyles;
