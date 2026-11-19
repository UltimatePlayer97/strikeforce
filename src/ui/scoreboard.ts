import type { Soldier, Team } from '../types';

export function showScoreboard(): void {
  document.getElementById('scoreboard-overlay')!.classList.remove('hidden');
}

export function hideScoreboard(): void {
  document.getElementById('scoreboard-overlay')!.classList.add('hidden');
}

export function updateScoreboard(
  alphaSoldiers: Soldier[],
  bravoSoldiers: Soldier[],
  alphaScore: number,
  bravoScore: number
): void {
  const alphaBody = document.getElementById('sb-alpha-body')!;
  const bravoBody = document.getElementById('sb-bravo-body')!;
  const alphaScoreEl = document.getElementById('sb-alpha-score')!;
  const bravoScoreEl = document.getElementById('sb-bravo-score')!;

  alphaScoreEl.textContent = alphaScore.toString();
  bravoScoreEl.textContent = bravoScore.toString();

  alphaBody.innerHTML = alphaSoldiers.map(s => `
    <tr class="${!s.isAlive ? 'opacity-40' : ''} ${s.isHuman ? 'font-bold' : ''}">
      <td class="py-1.5 px-2">${s.name}${s.isHuman ? ' <span class="text-[9px] text-sky-400">(YOU)</span>' : ''}</td>
      <td class="py-1.5 px-2">
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${s.isAlive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
          ${s.isAlive ? 'ALIVE' : 'KIA'}
        </span>
      </td>
      <td class="py-1.5 px-2 text-right mono">${s.kills}</td>
      <td class="py-1.5 px-2 text-right mono">${s.deaths}</td>
    </tr>
  `).join('');

  bravoBody.innerHTML = bravoSoldiers.map(s => `
    <tr class="${!s.isAlive ? 'opacity-40' : ''} ${s.isHuman ? 'font-bold' : ''}">
      <td class="py-1.5 px-2">${s.name}${s.isHuman ? ' <span class="text-[9px] text-sky-400">(YOU)</span>' : ''}</td>
      <td class="py-1.5 px-2">
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${s.isAlive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
          ${s.isAlive ? 'ALIVE' : 'KIA'}
        </span>
      </td>
      <td class="py-1.5 px-2 text-right mono">${s.kills}</td>
      <td class="py-1.5 px-2 text-right mono">${s.deaths}</td>
    </tr>
  `).join('');
}