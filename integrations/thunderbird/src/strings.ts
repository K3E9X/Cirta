/**
 * [F-P3 2.6] The add-in's own words, in the two languages Ciirta speaks. What
 * comes from a document — a field's name, a refusal — is translated by
 * src/shared/french.ts, as everywhere else.
 */

import type { Lang } from '../../../src/shared/french.js';

const FR = {
  title: 'Pièces jointes',
  held: 'Envoi retenu : une pièce jointe porte des données identifiantes. Nettoyez-la ici, ou choisissez « Envoyer tel quel », puis cliquez de nouveau sur Envoyer.',
  clear: 'Rien de confirmé dans les pièces jointes. Le message part tel quel.',
  none: 'Aucune pièce jointe.',
  clean: 'Nettoyer',
  sendAsIs: 'Envoyer tel quel',
  allowed: 'Choisi : ce message partira tel quel. Cliquez de nouveau sur Envoyer.',
  nothing: 'Rien trouvé.',
  level: { confirmed: 'confirmé', probable: 'probable', informational: 'informatif' },
  cleaned: (n: number) => `Nettoyée dans le message : ${n} élément${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''}.`,
  tooLarge: (mb: number) => `Non lue : au-delà de ${mb} Mo.`,
  unreadable: 'Non lue. Ciirta ne dit rien d’un fichier qu’il n’a pas lu.',
  readOnly: 'Inspectée seulement : ce format n’est pas réécrit.',
  unknownFormat: 'Format que Ciirta ne lit pas.',
  scope: 'Ciirta lit ce que les fichiers disent de leur fabrication : propriétés, comptes, chemins, texte caché, caractères invisibles. Il ne prétend pas détecter un filigrane statistique dans la formulation.',
};

const EN: typeof FR = {
  title: 'Attachments',
  held: 'Sending held back: an attachment carries identifying data. Clean it here, or choose « Send as is », then click Send again.',
  clear: 'Nothing confirmed in the attachments. The message goes as it is.',
  none: 'No attachment.',
  clean: 'Clean',
  sendAsIs: 'Send as is',
  allowed: 'Chosen: this message will go as it is. Click Send again.',
  nothing: 'Nothing found.',
  level: { confirmed: 'confirmed', probable: 'probable', informational: 'informational' },
  cleaned: (n: number) => `Cleaned in the message: ${n} item${n > 1 ? 's' : ''} removed.`,
  tooLarge: (mb: number) => `Not read: larger than ${mb} MB.`,
  unreadable: 'Not read. Ciirta says nothing about a file it has not read.',
  readOnly: 'Inspected only: this format is not rewritten.',
  unknownFormat: 'A format Ciirta does not read.',
  scope: 'Ciirta reads what files say about their making: properties, accounts, paths, hidden text, invisible characters. It does not claim to detect a statistical watermark in the wording.',
};

export const strings = (lang: Lang): typeof FR => (lang === 'fr' ? FR : EN);
