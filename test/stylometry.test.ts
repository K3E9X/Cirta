import { describe, it, expect } from 'vitest';
import { stylometry } from '../src/core/stylometry.js';

/**
 * These signals are real and individually weak, and the module's whole job is
 * to say so. What the tests protect is that shape: measurements and a count,
 * calibrated so that human prose does not trip it.
 */
const ASSISTANT = `Dans le paysage numérique en constante évolution, il est important de noter que la
transformation joue un rôle crucial. Explorons ensemble les principaux leviers de cette évolution.

**Gouvernance** — La gouvernance constitue un pilier primordial pour toute organisation moderne.
Elle permet non seulement de structurer les responsabilités, mais aussi de garantir la conformité.

**Outillage** — Que ce soit pour la détection ou pour la réponse, l'outillage doit être pensé de
manière holistique et cohérente. Il convient de souligner que les approches fragmentées produisent
des angles morts importants.

**Culture** — La sensibilisation des équipes est un témoignage de la maturité d'une organisation.
Voici quelques axes prioritaires que vous pourrez considérer dans votre feuille de route annuelle.

En conclusion, ces dimensions sont indissociables les unes des autres. N'hésitez pas à revenir vers
moi pour approfondir l'un ou l'autre de ces points essentiels.`;

// Camus, L'Étranger, 1942. Short sentences, plain words, no rhetorical scaffolding.
const HUMAN = `Aujourd'hui, maman est morte. Ou peut-être hier, je ne sais pas. J'ai reçu un télégramme
de l'asile. Cela ne veut rien dire. C'était peut-être hier. L'asile de vieillards est à Marengo, à
quatre-vingts kilomètres d'Alger. Je prendrai l'autobus à deux heures et j'arriverai dans
l'après-midi. Ainsi, je pourrai veiller et je rentrerai demain soir. J'ai demandé deux jours de congé
à mon patron et il ne pouvait pas me les refuser avec une excuse pareille. Mais il n'avait pas l'air
content. Je lui ai même dit que ce n'était pas de ma faute. Il n'a pas répondu. J'ai pensé alors que
je n'aurais pas dû lui dire cela. Je n'avais pas à m'excuser. C'était plutôt à lui de me présenter
ses condoléances. Mais il le fera sans doute après-demain, quand il me verra en deuil.`;

describe('style indicators', () => {
  it('picks up the turns of phrase an assistant reaches for', () => {
    const report = stylometry(ASSISTANT);
    const labels = report.indicators.map((i) => i.label);
    expect(labels).toContain('il est important de noter');
    expect(labels).toContain('dans le paysage…');
    expect(labels).toContain('non seulement… mais aussi');
    expect(report.band).toBe('many');
  });

  it('stays quiet on human prose', () => {
    // The control that matters. A module that flags Camus is worse than none.
    expect(stylometry(HUMAN).band).toBe('few');
  });

  it('does not count an ordinary word on a single occurrence', () => {
    // "crucial" is normal French. One means nothing; several in a page means
    // something, which is why that tell carries a rate threshold.
    const once = `${HUMAN} Ce point est crucial.`;
    expect(stylometry(once).indicators.map((i) => i.label)).not.toContain(
      'crucial / primordial / holistique',
    );
  });

  it('offers no band at all below the length where ratios mean anything', () => {
    const report = stylometry('Trois mots seulement.');
    expect(report.band).toBe('too-short');
  });

  it('measures sentence variation rather than judging it', () => {
    const uniform = Array.from({ length: 12 }, () => 'Voici une phrase de longueur parfaitement identique.').join(' ');
    const varied = 'Court. ' + 'Puis une phrase nettement plus longue qui déroule son propos sans se presser du tout. '.repeat(6);
    expect(stylometry(uniform).burstiness).toBeLessThan(stylometry(varied).burstiness);
  });

  it('counts dashes and bold lead-ins as rates, not as verdicts', () => {
    const report = stylometry(ASSISTANT);
    expect(report.dashRate).toBeGreaterThan(0);
    expect(report.boldLeadIns).toBeGreaterThan(0);
    // Nothing in the result is a probability or a label on the author.
    expect(Object.keys(report)).not.toContain('score');
    expect(Object.keys(report)).not.toContain('isAi');
  });
});
