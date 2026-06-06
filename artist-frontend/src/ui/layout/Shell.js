import React from 'react';
import styled from 'styled-components';

export default function Shell({ children }) {
    return (
        <Root>
            <Inner>
                {children}
            </Inner>
        </Root>
    );
}

const Root = styled.div`
  width: 100%;
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  background: #000;
  color: #fff;
  overflow-x: hidden;
  padding-bottom: env(safe-area-inset-bottom, 0px);
`;

const Inner = styled.div`
  width: 100%;
`;
