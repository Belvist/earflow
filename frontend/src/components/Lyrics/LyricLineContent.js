import React, { memo } from 'react';
import PropTypes from 'prop-types';
import styled from 'styled-components';

const WordSpan = styled.span`
  display: inline;
  transition: opacity 0.12s ease, color 0.12s ease, font-weight 0.12s ease;
  opacity: ${props => props.$revealed ? 1 : 0.35};
  color: ${props => props.$revealed ? 'white' : 'inherit'};
  font-weight: ${props => props.$isActive ? '800' : 'inherit'};
`;

const LyricLineContent = memo(({ line, isCurrent, currentWordIndex }) => {
    if (!line) return null;
    const rawWords = Array.isArray(line.words) ? line.words : [];
    const hasWords = rawWords.length > 0;
    const text = typeof line.text === 'string' ? line.text : '';

    const words = hasWords
        ? rawWords.map((w) => ({ text: w?.text || '' })).filter((w) => w.text)
        : text.split(/\s+/g).map((w) => ({ text: w })).filter((w) => w.text);

    if (words.length === 0) return text || null;

    return words.map((word, idx) => {
        const revealed = isCurrent ? idx <= currentWordIndex : false;
        const isActive = isCurrent && idx === currentWordIndex;
        return (
            <WordSpan key={`${idx}:${word.text}`} $revealed={revealed} $isActive={isActive}>
                {word.text}{' '}
            </WordSpan>
        );
    });
});

LyricLineContent.displayName = 'LyricLineContent';

LyricLineContent.propTypes = {
    line: PropTypes.shape({
        text: PropTypes.string,
        words: PropTypes.arrayOf(PropTypes.shape({
            text: PropTypes.string,
            startTime: PropTypes.number,
            endTime: PropTypes.number,
        })),
    }),
    isCurrent: PropTypes.bool,
    currentWordIndex: PropTypes.number,
};

LyricLineContent.defaultProps = {
    line: null,
    isCurrent: false,
    currentWordIndex: -1,
};

export default LyricLineContent;
