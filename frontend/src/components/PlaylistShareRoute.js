import React, { useMemo } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import PlaylistPage from './PlaylistPage';

function isLikelyMixToken(value) {
    const v = String(value || '');
    return v.startsWith('v1.') && v.split('.').length === 3;
}

export default function PlaylistShareRoute() {
    const params = useParams();

    const slug = useMemo(() => {
        return params.slug || '';
    }, [params.slug]);

    if (!slug) {
        return <Navigate to="/" replace />;
    }

    if (isLikelyMixToken(slug)) {
        return <Navigate to={`/mix/${encodeURIComponent(slug)}`} replace />;
    }

    return <PlaylistPage playlistIdentifier={slug} />;
}
