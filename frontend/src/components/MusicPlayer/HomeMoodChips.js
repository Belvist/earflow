import React from 'react';

import styled from 'styled-components';

import { useNavigate } from 'react-router-dom';

import { HOME_HERO_CARD_BG } from '../../styles/homeSurface';



const Section = styled.section`

  margin: 4px 0 32px;

`;



const Title = styled.h3`

  margin: 0 0 14px;

  font-family: 'Unbounded', sans-serif;

  font-size: 1.05rem;

  font-weight: 600;

  color: #fff;

`;



const ChipRow = styled.div`

  display: flex;

  flex-wrap: wrap;

  gap: 10px;

`;



const Chip = styled.button`

  border: 1px solid rgba(255, 255, 255, 0.12);

  border-radius: 14px;

  padding: 14px 20px;

  min-height: 48px;

  min-width: 132px;

  font-family: 'Unbounded', sans-serif;

  font-size: 11px;

  font-weight: 500;

  letter-spacing: 0.02em;

  text-align: center;

  cursor: pointer;

  color: rgba(255, 255, 255, 0.94);

  background: ${HOME_HERO_CARD_BG};

  box-shadow:

    0 1px 0 rgba(255, 255, 255, 0.06) inset,

    0 8px 24px rgba(0, 0, 0, 0.35);

  transition: background 0.18s ease, border-color 0.18s ease, transform 0.12s ease;



  &:hover {

    background: rgba(32, 32, 32, 1);

    border-color: rgba(255, 255, 255, 0.22);

    transform: translateY(-1px);

  }



  &:active {

    transform: translateY(0);

  }



  &:focus-visible {

    outline: 2px solid rgba(255, 255, 255, 0.35);

    outline-offset: 2px;

  }

`;



const MOODS = [

  { label: 'Мрачный вайб', mood: 'dark' },

  { label: 'Рэп', mood: 'energetic' },

  { label: 'Атмосфера', mood: 'calm' },

  { label: 'Грусть', mood: 'melancholic' },

];



export default function HomeMoodChips() {

  const navigate = useNavigate();



  return (

    <Section data-testid="home-mood-chips">

      <Title>Настроения и жанры</Title>

      <ChipRow>

        {MOODS.map((m) => (

          <Chip

            key={m.label}

            type="button"

            onClick={() => navigate(`/mood-radar?mood=${encodeURIComponent(m.mood)}`)}

          >

            {m.label}

          </Chip>

        ))}

      </ChipRow>

    </Section>

  );

}

