import styled from 'styled-components';

const TextArea = styled.textarea`
  width: 100%;
  padding: 14px 16px;
  min-height: 120px;
  resize: vertical;
  background: rgba(255, 255, 255, 0.06);
  border: 0;
  border-radius: 14px;
  color: white;
  font-size: 14px;
  line-height: 1.5;
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

export default TextArea;
