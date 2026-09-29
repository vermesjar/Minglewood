/** The Design Lab (dev only: studio.html is not a build input, and /api/dev/lab answers localhost alone). */
import { createRoot } from 'react-dom/client';
import { Lab } from './Lab';
import './studio.css';

createRoot(document.getElementById('root')!).render(<Lab />);
