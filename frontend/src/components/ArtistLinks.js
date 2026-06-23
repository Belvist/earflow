import React, { useMemo } from 'react';
import styled from 'styled-components';
import { parseArtistNames } from '../utils/artist';

const Container = styled.span`
  display: inline;
  min-width: 0;
`;

const ArtistButton = styled.button`
  display: inline;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    text-decoration: underline;
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 6px;
  }

  &:disabled {
    cursor: default;
  }
`;

const Separator = styled.span`
  color: rgba(255, 255, 255, 0.55);
`;

export default function ArtistLinks({ value, onNavigate, className }) {
    const artists = useMemo(() => parseArtistNames(value), [value]);

    if (!artists.length) {
        return <Container className={className}>{value || ''}</Container>;
    }

    const handleClick = (name) => (e) => {
        e.stopPropagation();
        if (typeof onNavigate === 'function') {
            onNavigate(name);
        }
    };

    return (
        <Container className={className} aria-label={value || ''}>
            {artists.map((name, index) => (
                <React.Fragment key={`${name}-${index}`}>
                    {index > 0 && <Separator>, </Separator>}
                    <ArtistButton type="button" onClick={handleClick(name)} disabled={typeof onNavigate !== 'function'}>
                        {name}
                    </ArtistButton>
                </React.Fragment>
            ))}
        </Container>
    );
}
