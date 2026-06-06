import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import styled from "styled-components";
import { motion, AnimatePresence } from "framer-motion";
import apiClient from "../../api/client";
import useAuth from "../../hooks/useAuth";
import { usePlayer } from "../../context/PlayerContext";
import { formatInviteCodeForDisplay } from "./PartyDrawer/inviteCodeDisplay";
import {
  buildAppPartyInviteUrl,
  extractJoinTokenFromApiPath,
} from "./PartyDrawer/partyShareUrl";
import {
  SharePillButton,
  SharePillRow,
  MutedCodeHint,
  InviteCodeMuted,
} from "./PartyDrawer/PartyDrawer.styles";

// Icons
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const PartyIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
  </svg>
);

// Styled Components - Modern Spotify-inspired design
const Overlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;

  @media (min-width: 768px) {
    padding: 24px;
  }
`;

const Modal = styled(motion.div)`
  background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  width: 100%;
  max-width: 400px;
  max-height: 85vh;
  overflow: hidden;
  position: relative;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.8),
    0 0 0 1px rgba(255, 255, 255, 0.05);

  @media (min-width: 768px) {
    border-radius: 24px;
    max-width: 440px;
  }

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }
`;

const ModalContent = styled.div`
  overflow-y: auto;
  max-height: calc(85vh - 70px);

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  position: sticky;
  top: 0;
  z-index: 10;
`;

const Title = styled.h2`
  font-size: 15px;
  font-weight: 700;
  color: white;
  margin: 0;
  font-family: "Unbounded", sans-serif;

  @media (min-width: 768px) {
    font-size: 17px;
  }
`;

const CloseButton = styled.button`
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
    color: white;
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }

  svg {
    width: 18px;
    height: 18px;
  }
`;

const Content = styled.div`
  padding: 24px;

  @media (min-width: 768px) {
    padding: 28px;
  }
`;

const TabsContainer = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 28px;
  background: rgba(255, 255, 255, 0.04);
  padding: 4px;
  border-radius: 14px;
`;

const Tab = styled.button`
  flex: 1;
  padding: 12px 16px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  transition: all 0.25s ease;
  background: ${(props) => (props.$active ? "white" : "transparent")};
  color: ${(props) => (props.$active ? "black" : "rgba(255, 255, 255, 0.6)")};

  &:hover {
    background: ${(props) =>
      props.$active ? "white" : "rgba(255, 255, 255, 0.08)"};
    color: ${(props) => (props.$active ? "black" : "white")};
  }

  &:active {
    transform: scale(0.98);
  }
`;

const IconContainer = styled.div`
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
  color: rgba(255, 255, 255, 0.3);
`;

const Description = styled.p`
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  line-height: 1.6;
  margin: 0 0 24px 0;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 8px;
`;

const Input = styled.input`
  width: 100%;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: white;
  font-size: 15px;
  font-family: inherit;
  transition: all 0.2s;

  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.08);
  }
`;

const CodeInput = styled(Input)`
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-family:
    "Unbounded",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
`;

const SubmitButton = styled.button`
  width: 100%;
  padding: 16px;
  border-radius: 14px;
  border: none;
  background: white;
  color: black;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 8px;

  &:hover:not(:disabled) {
    filter: brightness(1.05);
    box-shadow: 0 8px 24px rgba(255, 255, 255, 0.2);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorMessage = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 12px 16px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  margin-bottom: 16px;
  font-family:
    "Unbounded",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  line-height: 1.45;
`;

const Spinner = styled.div`
  width: 20px;
  height: 20px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-top-color: black;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  margin-right: 8px;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

// Active Party View Components
const PartyInfo = styled.div`
  text-align: center;
  padding: 20px 0;
`;

const PartyTitle = styled.h3`
  font-size: 18px;
  font-weight: 700;
  color: white;
  margin: 0 0 8px 0;
`;

const PartyStatus = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #4caf50;
  font-size: 14px;
  margin-bottom: 16px;
`;

const StatusDot = styled.span`
  width: 8px;
  height: 8px;
  background: #4caf50;
  border-radius: 50%;
  animation: pulse 2s infinite;

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.h4`
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.4);
  margin: 0 0 14px 0;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-family: "Unbounded", sans-serif;
`;

const ParticipantsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Participant = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.08);
  }
`;

const ParticipantAvatar = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${(props) =>
    props.$isHost
      ? "linear-gradient(135deg, #1DB954, #169c46)"
      : "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))"};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  color: ${(props) => (props.$isHost ? "white" : "rgba(255, 255, 255, 0.8)")};
  box-shadow: ${(props) =>
    props.$isHost ? "0 4px 15px rgba(29, 185, 84, 0.3)" : "none"};
`;

const ParticipantInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ParticipantName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: white;
  font-family: "Unbounded", sans-serif;
`;

const ParticipantRole = styled.div`
  font-size: 12px;
  margin-top: 2px;
  color: ${(props) => (props.$isHost ? "#1DB954" : "rgba(255, 255, 255, 0.4)")};
  font-weight: 500;
`;

const QueueSection = styled.div`
  max-height: 200px;
  overflow-y: auto;
`;

const QueueItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
`;

const QueueCover = styled.img`
  width: 40px;
  height: 50px;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.1);
`;

const QueueInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const QueueTitle = styled.div`
  font-size: 14px;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const QueueArtist = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
`;

const QueueAddedBy = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
`;

// eslint-disable-next-line no-unused-vars
const EmptyQueue = styled.div`
  text-align: center;
  padding: 20px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 14px;
`;

const LeaveButton = styled.button`
  width: 100%;
  padding: 14px 20px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 16px;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.92);
    filter: brightness(1.05);
  }

  &:active {
    transform: translateY(0);
  }
`;

const RoleBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  background: ${(props) =>
    props.$isHost
      ? "linear-gradient(135deg, #1DB954, #169c46)"
      : "rgba(255, 255, 255, 0.1)"};
  color: ${(props) => (props.$isHost ? "white" : "rgba(255, 255, 255, 0.7)")};
  box-shadow: ${(props) =>
    props.$isHost ? "0 4px 15px rgba(29, 185, 84, 0.3)" : "none"};
`;

export default function PartyModal({ isOpen, onClose }) {
  const player = usePlayer();
  const {
    partyMode,
    partyInfo,
    exitPartyMode,
    activePartyId,
    setActivePartyId,
    party,
  } = player;
  const { user } = useAuth();
  const username =
    user?.username || user?.firstName || user?.first_name || "Участник";

  const [activeTab, setActiveTab] = useState("create"); // 'create' | 'join'
  const [view, setView] = useState("menu"); // 'menu' | 'active'

  // Create party state
  const [partyTitle, setPartyTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Join party state
  const [inputCode, setInputCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const [error, setError] = useState(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLinkPath, setInviteLinkPath] = useState("");
  const [copyFlash, setCopyFlash] = useState(null);
  const inviteRequestInFlight = useRef(false);

  const displayInvite = useMemo(
    () => formatInviteCodeForDisplay(inviteCode),
    [inviteCode],
  );
  const appShareUrl = useMemo(() => {
    const tok = extractJoinTokenFromApiPath(inviteLinkPath);
    if (!tok) return "";
    return buildAppPartyInviteUrl(tok);
  }, [inviteLinkPath]);

  useEffect(() => {
    inviteRequestInFlight.current = false;
  }, [activePartyId]);

  // Switch to active view when party connects; ensure invite link path for share URL (code alone from createParty is not enough)
  useEffect(() => {
    if (party?.isConnected && activePartyId) {
      setView("active");

      const needInvite = party?.isHost && (!inviteCode || !inviteLinkPath);
      if (needInvite && !inviteRequestInFlight.current) {
        inviteRequestInFlight.current = true;
        apiClient
          .createPartyInvite(activePartyId)
          .then((res) => {
            const code = res?.invite?.code || res?.code;
            if (code) {
              setInviteCode(String(code));
            }
            const linkP = res?.invite?.link;
            if (typeof linkP === "string" && linkP.trim()) {
              setInviteLinkPath(String(linkP).trim());
            }
          })
          .catch(() => {})
          .finally(() => {
            inviteRequestInFlight.current = false;
          });
      }
    }
  }, [
    party?.isConnected,
    activePartyId,
    party?.isHost,
    inviteCode,
    inviteLinkPath,
  ]);

  // Reset UI when party ends
  useEffect(() => {
    if (!partyMode && view === "active") {
      setInviteCode("");
      setInviteLinkPath("");
      setView("menu");
    }
  }, [partyMode, view]);

  // Show party errors
  useEffect(() => {
    if (party?.error) {
      setError(party.error.message || "Ошибка соединения");
    }
  }, [party?.error]);

  // Create party handler
  const handleCreateParty = useCallback(
    async (e) => {
      e.preventDefault();
      setIsCreating(true);
      setError(null);

      try {
        const response = await apiClient.createParty({
          title: partyTitle.trim() || undefined,
        });

        if (response.success && response.party) {
          setActivePartyId(response.party.id);
          setView("active");
          if (response.invite?.link) {
            setInviteLinkPath(String(response.invite.link).trim());
          }
          if (response.inviteCode) {
            setInviteCode(response.inviteCode);
          }
        }
      } catch (err) {
        setError(err.message || "Не удалось создать party");
      } finally {
        setIsCreating(false);
      }
    },
    [partyTitle, setActivePartyId],
  );

  // Join party handler
  const handleJoinParty = useCallback(
    async (e) => {
      e.preventDefault();

      const code = inputCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (code.length < 8) {
        setError("Введите полный код приглашения");
        return;
      }

      setIsJoining(true);
      setError(null);

      try {
        const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
        const response = await apiClient.joinPartyByCode(
          formattedCode,
          username,
        );

        if (response.success && response.party) {
          setActivePartyId(response.party.id);
          setView("active");
        }
      } catch (err) {
        setError(err.message || "Неверный код приглашения");
      } finally {
        setIsJoining(false);
      }
    },
    [inputCode, setActivePartyId, username],
  );

  // Leave party handler
  const handleLeaveParty = useCallback(async () => {
    if (activePartyId) {
      try {
        if (party?.isHost) {
          await apiClient.endParty(activePartyId);
        } else {
          await apiClient.leaveParty(activePartyId);
        }
      } catch (err) {
        void err;
      }
    }

    party?.disconnect?.();
    exitPartyMode();
    setActivePartyId(null);
    setInviteCode("");
    setInviteLinkPath("");
    setView("menu");
  }, [activePartyId, party, exitPartyMode, setActivePartyId]);

  const copyPayload = useMemo(
    () =>
      formatInviteCodeForDisplay(inviteCode) ||
      String(inviteCode || "").replace(/\s+/g, ""),
    [inviteCode],
  );

  const writeClipboard = useCallback((text, onDone) => {
    if (!text) return;
    const done = onDone || (() => undefined);
    Promise.resolve(navigator.clipboard.writeText(text))
      .then(() => {
        done();
      })
      .catch(() => {
        try {
          const el = document.createElement("textarea");
          el.value = text;
          el.setAttribute("readonly", "");
          el.style.position = "fixed";
          el.style.left = "-9999px";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
          done();
        } catch {
          /* ignore */
        }
      });
  }, []);

  const handleCopyCode = useCallback(() => {
    if (!copyPayload) return;
    writeClipboard(copyPayload, () => {
      setCopyFlash("code");
      setTimeout(() => setCopyFlash((f) => (f === "code" ? null : f)), 2000);
    });
  }, [copyPayload, writeClipboard]);

  const handleCopyLink = useCallback(() => {
    if (!appShareUrl) return;
    writeClipboard(appShareUrl, () => {
      setCopyFlash("link");
      setTimeout(() => setCopyFlash((f) => (f === "link" ? null : f)), 2000);
    });
  }, [appShareUrl, writeClipboard]);

  // Format code input
  const handleCodeChange = useCallback((e) => {
    const value = e.target.value
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 8);
    setInputCode(value);
    setError(null);
  }, []);

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    setPartyTitle("");
    setInputCode("");
    setError(null);
    // Don't disconnect if party is active
    onClose();
  }, [onClose]);

  // Check if already in party on open
  useEffect(() => {
    if (isOpen && partyMode && partyInfo?.partyId) {
      setActivePartyId(partyInfo.partyId);
      setView("active");
    }
  }, [isOpen, partyMode, partyInfo, setActivePartyId]);

  // Active Party View
  const renderActiveParty = () => (
    <>
      <PartyInfo>
        <PartyTitle>{party?.party?.title || "Listening Party"}</PartyTitle>
        <PartyStatus>
          <StatusDot />
          {party?.isConnected ? "Подключено" : "Подключение..."}
        </PartyStatus>
        <RoleBadge $isHost={party?.isHost}>
          {party?.isHost ? "👑 Хост" : "🎧 Участник"}
        </RoleBadge>
      </PartyInfo>

      {party?.isHost && (
        <>
          <SharePillRow>
            <SharePillButton
              type="button"
              disabled={!appShareUrl}
              onClick={handleCopyLink}
            >
              {copyFlash === "link" ? "Скопировано" : "скопировать ссылку"}
            </SharePillButton>
            <SharePillButton
              type="button"
              disabled={!displayInvite}
              onClick={handleCopyCode}
            >
              {copyFlash === "code" ? "Скопировано" : "скопировать код"}
            </SharePillButton>
          </SharePillRow>
          {displayInvite ? (
            <MutedCodeHint id="party-modal-invite-code">
              {displayInvite}
            </MutedCodeHint>
          ) : (
            <InviteCodeMuted style={{ textAlign: "center", marginBottom: 12 }}>
              Загрузка кода…
            </InviteCodeMuted>
          )}
        </>
      )}

      <Section>
        <SectionTitle>
          Участники (
          {party?.participants?.length || party?.participantCount || 0})
        </SectionTitle>
        <ParticipantsList>
          {party?.participants?.map((p, i) => (
            <Participant key={p.id || i}>
              <ParticipantAvatar $isHost={p.isHost}>
                {(p.username || "U")[0].toUpperCase()}
              </ParticipantAvatar>
              <ParticipantInfo>
                <ParticipantName>{p.username || "Участник"}</ParticipantName>
                <ParticipantRole $isHost={p.isHost}>
                  {p.isHost ? "Хост" : "Участник"}
                </ParticipantRole>
              </ParticipantInfo>
            </Participant>
          ))}
          {!party?.participants?.length && (
            <Participant>
              <ParticipantAvatar $isHost={party?.isHost}>
                {party?.isHost ? "👑" : "🎧"}
              </ParticipantAvatar>
              <ParticipantInfo>
                <ParticipantName>Вы</ParticipantName>
                <ParticipantRole $isHost={party?.isHost}>
                  {party?.isHost ? "Хост" : "Участник"}
                </ParticipantRole>
              </ParticipantInfo>
            </Participant>
          )}
        </ParticipantsList>
      </Section>

      {party?.queue?.length > 0 && (
        <Section>
          <SectionTitle>Очередь ({party.queue.length})</SectionTitle>
          <QueueSection>
            {party.queue.map((item, i) => (
              <QueueItem key={i}>
                <QueueCover src={item.cover || "/default-cover.png"} alt="" />
                <QueueInfo>
                  <QueueTitle>{item.title}</QueueTitle>
                  <QueueArtist>{item.artist}</QueueArtist>
                  <QueueAddedBy>
                    Добавил: {item.addedByName || "Участник"}
                  </QueueAddedBy>
                </QueueInfo>
              </QueueItem>
            ))}
          </QueueSection>
        </Section>
      )}

      <LeaveButton onClick={handleLeaveParty}>
        {party?.isHost ? "Завершить Party" : "Покинуть Party"}
      </LeaveButton>
    </>
  );

  // Create/Join Menu View
  const renderMenu = () => (
    <>
      <TabsContainer>
        <Tab
          $active={activeTab === "create"}
          onClick={() => {
            setActiveTab("create");
            setError(null);
          }}
        >
          Создать
        </Tab>
        <Tab
          $active={activeTab === "join"}
          onClick={() => {
            setActiveTab("join");
            setError(null);
          }}
        >
          Присоединиться
        </Tab>
      </TabsContainer>

      <IconContainer>
        <PartyIcon />
      </IconContainer>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {activeTab === "create" ? (
        <form onSubmit={handleCreateParty}>
          <Description>
            Создайте party и слушайте музыку вместе с друзьями. Управляйте
            плеером как обычно — все участники услышат.
          </Description>

          <FormGroup>
            <Label>Название (необязательно)</Label>
            <Input
              type="text"
              value={partyTitle}
              onChange={(e) => setPartyTitle(e.target.value)}
              placeholder="Моя вечеринка"
              maxLength={100}
              disabled={isCreating}
            />
          </FormGroup>

          <SubmitButton type="submit" disabled={isCreating}>
            {isCreating && <Spinner />}
            {isCreating ? "Создание..." : "Создать Party"}
          </SubmitButton>
        </form>
      ) : (
        <form onSubmit={handleJoinParty}>
          <Description>
            Введите код от друга чтобы слушать музыку вместе в реальном времени.
          </Description>

          <FormGroup>
            <Label>Код приглашения</Label>
            <CodeInput
              type="text"
              value={
                inputCode.length > 4
                  ? `${inputCode.slice(0, 4)}-${inputCode.slice(4)}`
                  : inputCode
              }
              onChange={handleCodeChange}
              placeholder="XXXX-XXXX"
              disabled={isJoining}
            />
          </FormGroup>

          <SubmitButton
            type="submit"
            disabled={isJoining || inputCode.length < 8}
          >
            {isJoining && <Spinner />}
            {isJoining ? "Подключение..." : "Присоединиться"}
          </SubmitButton>
        </form>
      )}
    </>
  );

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <Overlay
          key="party-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleClose}
        >
          <Modal
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 30,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Header>
              <Title>
                {view === "active" ? "Время пати" : "Слушаем вместе"}
              </Title>
              <CloseButton onClick={handleClose} aria-label="Close">
                <CloseIcon />
              </CloseButton>
            </Header>

            <ModalContent>
              <Content>
                {view === "active" ? renderActiveParty() : renderMenu()}
              </Content>
            </ModalContent>
          </Modal>
        </Overlay>
      )}
    </AnimatePresence>
  );
}
