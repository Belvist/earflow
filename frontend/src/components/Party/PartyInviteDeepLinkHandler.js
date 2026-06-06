/**
 * Реагирует на ?partyInvite= из ссылки «Скопировать ссылку» в Party:
 * joinPartyByLink + setActivePartyId, затем убирает параметр из URL.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlayer } from '../../context/PlayerContext';
import apiClient from '../../api/client';
import { rememberPartyWsTicket } from '../../hooks/partyConnection';

const PARAM = 'partyInvite';

export default function PartyInviteDeepLinkHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setActivePartyId } = usePlayer();
  const inFlightRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get(PARAM);
    if (!raw) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const path = location.pathname;
    const token = String(raw).trim();
    if (!token) {
      inFlightRef.current = false;
      return;
    }

    let cancelled = false;

    (async () => {
      const strip = () => {
        if (cancelled) return;
        const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        sp.delete(PARAM);
        const qs = sp.toString();
        navigate({ pathname: path, search: qs ? `?${qs}` : '' }, { replace: true });
        inFlightRef.current = false;
      };

      try {
        const res = await apiClient.joinPartyByLink(token);
        if (cancelled) return;
        const id = res?.party?.id;
        if (id) {
          const pid = String(id);
          rememberPartyWsTicket(pid, res?.wsToken || res?.ticket || '');
          setActivePartyId(pid);
        }
        strip();
      } catch {
        if (!cancelled) strip();
      }
    })();

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [location.search, location.pathname, navigate, setActivePartyId]);

  return null;
}
