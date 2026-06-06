/**
 * Определение скинов Earflow.
 * Каждый скин — полный набор цветов и стилевых параметров,
 * применяемых через CSS custom properties (см. useSkin.ts).
 *
 * Добавление нового скина: дополнить SKINS объект,
 * убедиться что все поля в colors и player присутствуют.
 */

export type ProgressBarStyle = 'rounded' | 'sharp' | 'pill';

export interface SkinColors {
    primary: string;
    primaryHover: string;
    /**
     * Цвет текста/иконок, размещённых поверх primary-фона.
     * Для светлых primary (AMOLED белый) — тёмный; для цветных primary — белый.
     * Без этого токена на тёмных скинах с белым primary получаем "белое на белом".
     */
    onPrimary: string;
    accent: string;
    background: string;
    surface: string;
    surfaceHover: string;
    border: string;
    text: string;
    textSecondary: string;
    playerBg: string;
    progressBar: string;
    progressBarFill: string;
}

export interface SkinPlayerStyles {
    accentGradient: string;
    progressBarStyle: ProgressBarStyle;
    coverShadow: string;
    progressGlow: boolean;
}

export interface Skin {
    id: string;
    name: string;
    description: string;
    colors: SkinColors;
    player: SkinPlayerStyles;
}

export const SKINS: Record<string, Skin> = {
    earflow: {
        id: 'earflow',
        name: 'Earflow',
        description: 'Фирменная монохромная тема — чистый чёрный с белым акцентом',
        colors: {
            primary: '#ffffff',
            primaryHover: '#f0f0f0',
            onPrimary: '#000000',
            accent: '#e5e5e5',
            background: '#000000',
            surface: '#121212',
            surfaceHover: '#1d1d1d',
            border: '#262626',
            text: '#ffffff',
            textSecondary: 'rgba(255, 255, 255, 0.7)',
            playerBg: '#0a0a0a',
            progressBar: 'rgba(255, 255, 255, 0.2)',
            progressBarFill: '#ffffff',
        },
        player: {
            accentGradient: 'linear-gradient(90deg, #ffffff 0%, #e0e0e0 100%)',
            progressBarStyle: 'rounded',
            coverShadow: '0 8px 32px rgba(0,0,0,0.55)',
            progressGlow: false,
        },
    },

    emerald: {
        id: 'emerald',
        name: 'Emerald',
        description: 'Насыщенный изумруд — яркий зелёный акцент',
        colors: {
            primary: '#1db954',
            primaryHover: '#1ed760',
            onPrimary: '#ffffff',
            accent: '#1ed760',
            background: '#000000',
            surface: '#181818',
            surfaceHover: '#282828',
            border: '#2a2a2a',
            text: '#ffffff',
            textSecondary: 'rgba(255, 255, 255, 0.7)',
            playerBg: '#121212',
            progressBar: '#4d4d4d',
            progressBarFill: '#1db954',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #1db954 0%, #1ed760 100%)',
            progressBarStyle: 'rounded',
            coverShadow: '0 8px 32px rgba(0,0,0,0.5)',
            progressGlow: true,
        },
    },

    midnight: {
        id: 'midnight',
        name: 'Midnight',
        description: 'Глубокий синий для ночных сессий',
        colors: {
            primary: '#4f8cff',
            primaryHover: '#6fa3ff',
            onPrimary: '#ffffff',
            accent: '#6fa3ff',
            background: '#0a0e17',
            surface: '#141b26',
            surfaceHover: '#1e2836',
            border: '#232b38',
            text: '#ffffff',
            textSecondary: 'rgba(200, 215, 240, 0.7)',
            playerBg: '#0d1117',
            progressBar: '#30363d',
            progressBarFill: '#4f8cff',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #4f8cff 0%, #6fa3ff 100%)',
            progressBarStyle: 'pill',
            coverShadow: '0 8px 32px rgba(0,0,0,0.4)',
            progressGlow: true,
        },
    },

    ocean: {
        id: 'ocean',
        name: 'Ocean',
        description: 'Океанический бирюзовый',
        colors: {
            primary: '#06b6d4',
            primaryHover: '#22d3ee',
            onPrimary: '#03222c',
            accent: '#22d3ee',
            background: '#05111a',
            surface: '#0c1e2e',
            surfaceHover: '#13293d',
            border: '#164458',
            text: '#ffffff',
            textSecondary: 'rgba(180, 220, 235, 0.7)',
            playerBg: '#0a1722',
            progressBar: '#1f3a4d',
            progressBarFill: '#06b6d4',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #06b6d4 0%, #22d3ee 50%, #67e8f9 100%)',
            progressBarStyle: 'pill',
            coverShadow: '0 8px 32px rgba(6, 182, 212, 0.25)',
            progressGlow: true,
        },
    },

    aurora: {
        id: 'aurora',
        name: 'Aurora',
        description: 'Фиолетовая магия северного сияния',
        colors: {
            primary: '#a78bfa',
            primaryHover: '#c4b5fd',
            onPrimary: '#1b0a2e',
            accent: '#c4b5fd',
            background: '#0a0514',
            surface: '#1b1430',
            surfaceHover: '#2a1f4a',
            border: '#3d2e66',
            text: '#ffffff',
            textSecondary: 'rgba(220, 200, 255, 0.7)',
            playerBg: '#0f0b1a',
            progressBar: '#3b2d5a',
            progressBarFill: '#a78bfa',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #a78bfa 0%, #c084fc 50%, #f0abfc 100%)',
            progressBarStyle: 'pill',
            coverShadow: '0 8px 32px rgba(167,139,250,0.2)',
            progressGlow: true,
        },
    },

    neon: {
        id: 'neon',
        name: 'Neon',
        description: 'Киберпанк неон — розовый + голубой',
        colors: {
            primary: '#ec4899',
            primaryHover: '#f472b6',
            onPrimary: '#ffffff',
            accent: '#22d3ee',
            background: '#0a0014',
            surface: '#1a0826',
            surfaceHover: '#2a0f3d',
            border: '#4a1a5a',
            text: '#ffffff',
            textSecondary: 'rgba(240, 210, 235, 0.7)',
            playerBg: '#0d0418',
            progressBar: '#2e0c3f',
            progressBarFill: '#ec4899',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #ec4899 0%, #a855f7 50%, #22d3ee 100%)',
            progressBarStyle: 'pill',
            coverShadow: '0 8px 48px rgba(236, 72, 153, 0.45)',
            progressGlow: true,
        },
    },

    vinyl: {
        id: 'vinyl',
        name: 'Vinyl',
        description: 'Ретро янтарный в стиле винила',
        colors: {
            primary: '#d4a057',
            primaryHover: '#e5b76b',
            onPrimary: '#1e1712',
            accent: '#e5b76b',
            background: '#1a1410',
            surface: '#2a1f18',
            surfaceHover: '#3a2d22',
            border: '#5a443a',
            text: '#f5ede0',
            textSecondary: 'rgba(245, 237, 224, 0.65)',
            playerBg: '#1e1712',
            progressBar: '#4a3a2a',
            progressBarFill: '#d4a057',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #d4a057 0%, #e5b76b 50%, #f5d491 100%)',
            progressBarStyle: 'rounded',
            coverShadow: '0 12px 40px rgba(0,0,0,0.65)',
            progressGlow: false,
        },
    },

    amoled: {
        id: 'amoled',
        name: 'AMOLED',
        description: 'Чистый чёрный — экономия батареи на OLED',
        colors: {
            primary: '#ffffff',
            primaryHover: '#e5e5e5',
            onPrimary: '#000000',
            accent: '#888888',
            background: '#000000',
            surface: '#0a0a0a',
            surfaceHover: '#1a1a1a',
            border: '#1f1f1f',
            text: '#ffffff',
            textSecondary: 'rgba(255, 255, 255, 0.6)',
            playerBg: '#000000',
            progressBar: '#1f1f1f',
            progressBarFill: '#ffffff',
        },
        player: {
            accentGradient: 'linear-gradient(135deg, #ffffff 0%, #a1a1a1 100%)',
            progressBarStyle: 'sharp',
            coverShadow: '0 0 0 1px rgba(255,255,255,0.08)',
            progressGlow: false,
        },
    },
};

export const DEFAULT_SKIN_ID = 'earflow';
