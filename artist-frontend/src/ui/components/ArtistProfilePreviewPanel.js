import React, { useCallback, useState } from 'react';
import styled from 'styled-components';

import Button from './Button';
import DevicePreviewFrame from './DevicePreviewFrame';

export default function ArtistProfilePreviewPanel({ children }) {
  const [mode, setMode] = useState('desktop');

  const setDesktop = useCallback(() => setMode('desktop'), []);
  const setTablet = useCallback(() => setMode('tablet'), []);
  const setMobile = useCallback(() => setMode('mobile'), []);

  return (
    <Wrap>
      <TopRow>
        <Tabs>
          <Button type="button" onClick={setDesktop} disabled={mode === 'desktop'}>Desktop</Button>
          <Button type="button" onClick={setTablet} disabled={mode === 'tablet'}>Tablet</Button>
          <Button type="button" onClick={setMobile} disabled={mode === 'mobile'}>Mobile</Button>
        </Tabs>
      </TopRow>
      <DevicePreviewFrame mode={mode}>{children}</DevicePreviewFrame>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TopRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const Tabs = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

