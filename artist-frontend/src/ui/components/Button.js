import styled from 'styled-components';

const Button = styled.button`
  border: 0;
  background: ${p => (p.$variant === 'primary'
    ? '#fff'
    : 'rgba(255, 255, 255, 0.06)')};
  color: ${p => (p.$variant === 'primary' ? '#000' : 'rgba(255,255,255,0.9)')};
  border-radius: 14px;
  padding: ${p => (p.$size === 'sm' ? '8px 10px' : (p.$size === 'icon' ? '9px' : '11px 15px'))};
  min-height: ${p => (p.$size === 'sm' || p.$size === 'icon' ? '32px' : '38px')};
  min-width: ${p => (p.$size === 'icon' ? '32px' : 'auto')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: ${p => (p.$size === 'sm' || p.$size === 'icon' ? '11px' : '12px')};
  font-weight: 700;
  letter-spacing: 0.4px;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &:active {
    transform: translateY(1px);
  }
`;

export default Button;
