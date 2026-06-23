import { useEffect, useState } from 'react';

export default function useTrackReason(trackId, hasReason) {
    const [showReason, setShowReason] = useState(false);

    useEffect(() => {
        if (!trackId || !hasReason) {
            setShowReason(false);
            return;
        }

        setShowReason(true);

        const timer = setTimeout(() => {
            setShowReason(false);
        }, 12000);

        return () => clearTimeout(timer);
    }, [trackId, hasReason]);

    return showReason;
}
