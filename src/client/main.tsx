import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { game } from './app/game';
import { BRAND } from '@shared/brand';
import './styles/app.css';

document.title = `${BRAND.name}`;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void game.start();
