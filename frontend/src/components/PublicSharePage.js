import React, { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { buildPlaylistPathFromIdentifier } from '../utils/playlistUrls';

export default function PublicSharePage() {
    const params = useParams();

    const identifier = useMemo(() => {
        return params.token || '';
    }, [params.token]);

    if (!identifier) {
        return <Navigate to="/" replace />;
    }

    const path = buildPlaylistPathFromIdentifier(identifier);
    return <Navigate to={path || '/'} replace />;
}
