import React, { useMemo } from 'react';
import { useLocation, useParams, Navigate } from 'react-router-dom';
import PlaylistPage from './PlaylistPage';

function isLikelyMixToken(value) {
    const v = String(value || '');
    return v.startsWith('v1.') && v.split('.').length === 3;
}

function isNumericId(value) {
    const v = String(value || '').trim();
    return /^\d+$/.test(v);
}

function isShareSlug(value) {
    const v = String(value || '').trim();
    return /^[A-Za-z0-9]{32}$/.test(v);
}

export default function PlaylistRoute() {
    const params = useParams();
    const location = useLocation();

    const idOrToken = useMemo(() => {
        return params.idOrToken || params.slug || '';
    }, [params.idOrToken, params.slug]);

    const shouldCanonicalizeToP = useMemo(() => {
        const pathname = String(location?.pathname || '');
        if (!pathname.startsWith('/playlist/')) return false;
        if (!idOrToken) return false;
        if (isLikelyMixToken(idOrToken)) return false;
        if (isNumericId(idOrToken)) return false;
        return true;
    }, [idOrToken, location?.pathname]);

    if (!idOrToken) {
        return <Navigate to="/" replace />;
    }

    if (shouldCanonicalizeToP) {
        return <Navigate to={`/p/${encodeURIComponent(idOrToken)}`} replace />;
    }

    if (isLikelyMixToken(idOrToken)) {
        return <PlaylistPage playlistIdentifier={idOrToken} />;
    }

    if (isNumericId(idOrToken)) {
        return <PlaylistPage playlistIdentifier={idOrToken} />;
    }

    if (isShareSlug(idOrToken)) {
        return <PlaylistPage playlistIdentifier={idOrToken} />;
    }

    return <PlaylistPage playlistIdentifier={idOrToken} />;
}
