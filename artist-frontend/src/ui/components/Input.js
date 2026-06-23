import styled from 'styled-components';

const Input = styled.input`
  width: 100%;
  padding: 11px 13px;
  background: rgba(255, 255, 255, 0.06);
  border: 0;
  border-radius: 14px;
  color: white;
  font-size: 12px;
  transition: all 0.2s ease;

  &::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.1);
    box-shadow: none;
  }
`;

export default Input;
