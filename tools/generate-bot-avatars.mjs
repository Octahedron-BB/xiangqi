import fs from 'node:fs';
import path from 'node:path';

const BOTS = [
  { id: 'bot-01', char: '童', c1: '#43a047', c2: '#1b5e20', g1: '#fffde7', g2: '#ffe082', g3: '#ffd54f' },
  { id: 'bot-02', char: '客', c1: '#00897b', c2: '#004d40', g1: '#e0f2f1', g2: '#80cbc4', g3: '#26a69a' },
  { id: 'bot-03', char: '士', c1: '#3949ab', c2: '#1a237e', g1: '#e8eaf6', g2: '#9fa8da', g3: '#5c6bc0' },
  { id: 'bot-04', char: '秀', c1: '#039be5', c2: '#01579b', g1: '#e1f5fe', g2: '#81d4fa', g3: '#29b6f6' },
  { id: 'bot-05', char: '锋', c1: '#e53935', c2: '#b71c1c', g1: '#ffebee', g2: '#ef9a9a', g3: '#e57373' },
  { id: 'bot-06', char: '策', c1: '#5e35b1', c2: '#311b92', g1: '#ede7f6', g2: '#b39ddb', g3: '#7e57c2' },
  { id: 'bot-07', char: '将', c1: '#6d4c41', c2: '#3e2723', g1: '#efebe9', g2: '#bcaaa4', g3: '#8d6e63' },
  { id: 'bot-08', char: '师', c1: '#8e24aa', c2: '#4a148c', g1: '#f3e5f5', g2: '#ce93d8', g3: '#ab47bc' },
  { id: 'bot-09', char: '宗', c1: '#d84315', c2: '#4e1806', g1: '#fbe9e7', g2: '#ffab91', g3: '#ff7043' },
  { id: 'bot-10', char: '仙', c1: '#f9a825', c2: '#e65100', g1: '#fffde7', g2: '#fff59d', g3: '#fbc02d' },
  { id: 'bot-11', char: '极', c1: '#263238', c2: '#0a0d0f', g1: '#fff8e1', g2: '#ffe082', g3: '#ffd700' },
];

const targetDir = path.resolve('assets/bots');
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

for (const b of BOTS) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <radialGradient id="bg-${b.id}" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${b.c1}"/>
      <stop offset="100%" stop-color="${b.c2}"/>
    </radialGradient>
    <linearGradient id="gold-${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${b.g1}"/>
      <stop offset="50%" stop-color="${b.g2}"/>
      <stop offset="100%" stop-color="${b.g3}"/>
    </linearGradient>
    <filter id="shadow-${b.id}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <circle cx="60" cy="60" r="56" fill="url(#bg-${b.id})"/>
  <circle cx="60" cy="60" r="51.5" fill="none" stroke="url(#gold-${b.id})" stroke-width="2" opacity="0.9"/>
  <circle cx="60" cy="60" r="47" fill="none" stroke="url(#gold-${b.id})" stroke-width="0.9" stroke-dasharray="3,3" opacity="0.65"/>
  <text x="60" y="73" text-anchor="middle" font-family="'STKaiti', 'KaiTi', 'Songti SC', 'SimSun', serif" font-size="46" font-weight="900" fill="url(#gold-${b.id})" filter="url(#shadow-${b.id})">${b.char}</text>
  <circle cx="60" cy="98" r="3.5" fill="url(#gold-${b.id})" opacity="0.95"/>
</svg>
`;
  fs.writeFileSync(path.join(targetDir, `${b.id}.svg`), svg, 'utf8');
}
console.log('Successfully generated 11 traditional Chinese Chess AI avatars.');
