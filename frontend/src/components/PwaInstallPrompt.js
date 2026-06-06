import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { FaDownload, FaTimes, FaShareSquare, FaPlusSquare } from 'react-icons/fa';

const STORAGE_DISMISSED_KEY = 'earflow_pwa_install_dismissed_at';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function isIosSafariStandalone() {
    try {
        if (typeof navigator === 'undefined') return false;
        return Boolean(navigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
    } catch {
        return false;
    }
}

function isIos() {
    try {
        const ua = String(navigator.userAgent || '');
        const isAppleMobile = /iP(ad|hone|od)/.test(ua);
        const isWebKit = /AppleWebKit\//.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
        return isAppleMobile && isWebKit;
    } catch {
        return false;
    }
}

function shouldShowByCooldown() {
    try {
        const raw = localStorage.getItem(STORAGE_DISMISSED_KEY);
        if (!raw) return true;
        const dismissedAt = Number(raw);
        if (!Number.isFinite(dismissedAt)) return true;
        return Date.now() - dismissedAt > DISMISS_COOLDOWN_MS;
    } catch {
        return true;
    }
}

function markDismissed() {
    try {
        localStorage.setItem(STORAGE_DISMISSED_KEY, String(Date.now()));
    } catch { }
}

const Container = styled.div`
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
    transform: translateX(-50%);
    max-width: 360px;
    width: calc(100% - 24px);
    background: rgba(20, 20, 22, 0.96);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 14px 16px;
    color: #fff;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    z-index: 9998;
    font-family: 'Unbounded', sans-serif;
    display: flex;
    gap: 12px;
    align-items: flex-start;
`;

const IconBadge = styled.div`
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--player-accent-gradient, linear-gradient(135deg, #1db954 0%, #1ed760 100%));
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #000;
    font-size: 18px;
`;

const Content = styled.div`
    flex: 1;
    min-width: 0;
`;

const Title = styled.div`
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 4px;
`;

const Description = styled.div`
    font-size: 11px;
    color: rgba(255, 255, 255, 0.7);
    line-height: 1.4;
    margin-bottom: 10px;
`;

const Actions = styled.div`
    display: flex;
    gap: 8px;
`;

const PrimaryButton = styled.button`
    flex: 1;
    background: var(--player-accent-gradient, linear-gradient(135deg, #1db954, #1ed760));
    color: #000;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 700;
    font-family: 'Unbounded', sans-serif;
    cursor: pointer;
    transition: transform 0.1s ease;

    &:active {
        transform: scale(0.96);
    }
`;

const SecondaryButton = styled.button`
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 11px;
    font-family: 'Unbounded', sans-serif;
    cursor: pointer;

    &:hover {
        background: rgba(255, 255, 255, 0.12);
    }
`;

const CloseButton = styled.button`
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    padding: 4px;
    font-size: 12px;

    &:hover {
        color: rgba(255, 255, 255, 0.9);
    }
`;

const IosStepsList = styled.ol`
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.75);
    line-height: 1.5;
`;

const IosStep = styled.li`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;

    svg {
        flex-shrink: 0;
        color: var(--color-primary, #1db954);
    }
`;

const PwaInstallPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showIosHelper, setShowIosHelper] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (isIosSafariStandalone()) return;
        if (!shouldShowByCooldown()) return;

        const onBeforeInstall = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setVisible(true);
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstall);

        if (isIos()) {
            const t = setTimeout(() => {
                if (!isIosSafariStandalone()) {
                    setVisible(true);
                }
            }, 5000);
            return () => {
                clearTimeout(t);
                window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            };
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        };
    }, []);

    const handleInstall = useCallback(async () => {
        if (deferredPrompt && typeof deferredPrompt.prompt === 'function') {
            try {
                deferredPrompt.prompt();
                const choiceResult = await deferredPrompt.userChoice;
                if (choiceResult?.outcome === 'accepted') {
                    setVisible(false);
                    markDismissed();
                }
            } catch { }
            setDeferredPrompt(null);
            return;
        }

        if (isIos()) {
            setShowIosHelper(true);
        }
    }, [deferredPrompt]);

    const handleDismiss = useCallback(() => {
        setVisible(false);
        markDismissed();
    }, []);

    if (!visible) return null;

    if (showIosHelper) {
        return (
            <Container>
                <IconBadge>
                    <FaShareSquare />
                </IconBadge>
                <Content>
                    <Title>Добавить на экран домой</Title>
                    <Description>Установите Earflow как приложение на iPhone:</Description>
                    <IosStepsList>
                        <IosStep>
                            <FaShareSquare />
                            <span>Нажмите кнопку «Поделиться» в Safari</span>
                        </IosStep>
                        <IosStep>
                            <FaPlusSquare />
                            <span>Выберите «На экран Домой»</span>
                        </IosStep>
                    </IosStepsList>
                </Content>
                <CloseButton onClick={handleDismiss} aria-label="Закрыть">
                    <FaTimes />
                </CloseButton>
            </Container>
        );
    }

    return (
        <Container>
            <IconBadge>
                <FaDownload />
            </IconBadge>
            <Content>
                <Title>Установить приложение</Title>
                <Description>Earflow работает как приложение на домашнем экране — быстрее и без вкладок браузера.</Description>
                <Actions>
                    <PrimaryButton onClick={handleInstall}>Установить</PrimaryButton>
                    <SecondaryButton onClick={handleDismiss}>Позже</SecondaryButton>
                </Actions>
            </Content>
            <CloseButton onClick={handleDismiss} aria-label="Закрыть">
                <FaTimes />
            </CloseButton>
        </Container>
    );
};

export default PwaInstallPrompt;
