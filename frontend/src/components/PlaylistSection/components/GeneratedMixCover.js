import React, { useMemo } from 'react';
import styled from 'styled-components';
import { isSafeImgSrcUrl } from '../../../utils/safeImgUrl';

const Wrapper = styled.div`
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    background: #181818;
`;

const CoverImg = styled.img`
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.35s ease;

    &[data-loaded="true"] {
        opacity: 1;
    }
`;

const FallbackBg = styled.div`
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
    color: rgba(255, 255, 255, 0.25);
    font-size: 32px;
`;

function handleImgLoad(e) {
    e.currentTarget.setAttribute('data-loaded', 'true');
}

function handleImgError(e) {
    e.currentTarget.style.display = 'none';
}

const GeneratedMixCover = React.memo(function GeneratedMixCover({
    coverUrls,
    title,
}) {
    const primaryUrl = useMemo(() => {
        if (!Array.isArray(coverUrls)) return null;
        const valid = coverUrls.find(
            (u) => typeof u === 'string' && u.length > 0 && isSafeImgSrcUrl(u)
        );
        return valid || null;
    }, [coverUrls]);

    return (
        <Wrapper>
            {primaryUrl ? (
                <CoverImg
                    src={primaryUrl}
                    alt={title || ''}
                    loading="lazy"
                    data-loaded="false"
                    onLoad={handleImgLoad}
                    onError={handleImgError}
                />
            ) : (
                <FallbackBg>🎵</FallbackBg>
            )}
        </Wrapper>
    );
});

export default GeneratedMixCover;
