import { allSoldiers, matchState } from '../game/state';
import type { Team } from '../types';
import { $ } from '../util/dom';

function buildRows(team: Team): string {
  return allSoldiers
    .filter((s) => s.team === team)
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .map(
      (s) => `
        <tr class="${s.isPlayer ? 'bg-blue-500/20 font-bold text-white' : 'text-slate-200'}">
          <td class="py-1.5 px-2">${s.name} ${s.isPlayer ? '<span class="text-[10px] text-sky-400">(YOU)</span>' : ''}</td>
          <td class="py-1.5 px-2 text-[11px] ${s.alive ? 'text-emerald-400' : 'text-red-400'}">${s.alive ? 'ACTIVE' : 'KIA'}</td>
          <td class="py-1.5 px-2 text-right mono font-bold">${s.kills}</td>
          <td class="py-1.5 px-2 text-right mono text-slate-400">${s.deaths}</td>
        </tr>
      `,
    )
    .join('');
}

export function renderScoreboard(): void {
  $('sb-alpha-score').textContent = String(matchState.alphaScore);
  $('sb-bravo-score').textContent = String(matchState.bravoScore);
  $('sb-alpha-body').innerHTML = buildRows('ALPHA');
  $('sb-bravo-body').innerHTML = buildRows('BRAVO');
}
